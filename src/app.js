import { COPY, GAME_CONFIG, REWARD_MILESTONES } from "./config.js";
import { MonoBrickGame } from "./game.js";
import { SfxEngine } from "./audio.js";
import {
  CLAIM_STATUS,
  MINT_STATUS,
  addRun,
  getCampaignProgress,
  getBestScore,
  getDailyBest,
  getMilestoneClaimsByWallet,
  getProfile,
  getSoundMuted,
  getTopRuns,
  setBestScore,
  setCampaignProgress,
  setDailyBest,
  setProfile,
  setSoundMuted
} from "./storage.js?v=20260325c";
import {
  authenticateWithSiwe,
  claimMilestoneReward,
  connectWallet,
  ensureBaseNetwork,
  fetchDailyChallengeSeed,
  fetchLeaderboard,
  getRuntimeCapabilities,
  getConnectedWallet,
  promptSaveInstall,
  resolveWalletName,
  shareScore,
  submitScore,
  watchWallet
} from "./base-hooks.js?v=20260325c";

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function getDailySeed(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function getDailyTarget(seed) {
  return 900 + (hash(seed) % 1800);
}

function formatScore(value) {
  return Math.max(0, Math.floor(value || 0)).toLocaleString();
}

function formatCompactScore(value) {
  const safe = Math.max(0, Math.floor(value || 0));
  const tinyPhone = window.matchMedia("(max-width: 420px)").matches;
  if (!tinyPhone || safe < 10000) return safe.toLocaleString();
  const compact = safe >= 100000 ? `${Math.round(safe / 1000)}k` : `${(safe / 1000).toFixed(1)}k`;
  return compact.replace(".0k", "k");
}

function dateShort(isoText) {
  try {
    return new Date(isoText).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    });
  } catch {
    return "Recent";
  }
}

function shortAddress(address = "") {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function withTrailingSlash(value = "") {
  if (!value) return "";
  return value.endsWith("/") ? value : `${value}/`;
}

function getRewardContractHint() {
  const address = typeof state?.runtime?.rewardContractAddress === "string"
    ? state.runtime.rewardContractAddress.trim()
    : "";
  if (!address) return "";
  return ` Live contract: ${shortAddress(address)} on Base.`;
}

function getCurrentResultClaimContext() {
  const bestCleared = Math.max(0, Math.min(CAMPAIGN_TOTAL, Number(state.campaignProgress?.bestClearedStage || 0)));
  return getMilestoneClaimContext(bestCleared);
}

function getMintTxUrlForClaim(claim) {
  const direct = typeof claim?.mintTxExplorerUrl === "string" ? claim.mintTxExplorerUrl.trim() : "";
  if (direct) return direct;
  const txHash = typeof claim?.mintTxHash === "string" ? claim.mintTxHash.trim() : "";
  if (!txHash) return "";
  return `https://basescan.org/tx/${txHash}`;
}

function getNftMetadataUrlForClaim(claim) {
  const tokenId = typeof claim?.mintedTokenId === "string" ? claim.mintedTokenId.trim() : "";
  const base = withTrailingSlash(
    typeof state?.runtime?.rewardMetadataBaseUri === "string" ? state.runtime.rewardMetadataBaseUri.trim() : ""
  );
  if (!base || !tokenId) return "";
  return `${base}${tokenId}.json`;
}

function updateProofButton() {
  const claim = getCurrentResultClaimContext()?.claim || null;
  const txUrl = claim ? getMintTxUrlForClaim(claim) : "";
  const metadataUrl = claim ? getNftMetadataUrlForClaim(claim) : "";

  if (txUrl) {
    els.buttons.viewProof.textContent = "View Mint Tx";
    els.buttons.viewProof.disabled = false;
    return;
  }
  if (metadataUrl) {
    els.buttons.viewProof.textContent = "View NFT Metadata";
    els.buttons.viewProof.disabled = false;
    return;
  }
  if (state.lastSubmissionSignature) {
    els.buttons.viewProof.textContent = "Copy Local Proof";
    els.buttons.viewProof.disabled = false;
    return;
  }
  els.buttons.viewProof.textContent = "No Proof Yet";
  els.buttons.viewProof.disabled = true;
}

function syncThemeColorMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const lightMode = window.matchMedia("(prefers-color-scheme: light)").matches;
  meta.setAttribute("content", lightMode ? "#d4e2c2" : "#1a2511");
}

function normalizeName(name) {
  const clean = (name || "").trim();
  return clean.slice(0, 32);
}

function isBaseChain(chainId) {
  return chainId === "0x2105";
}

function getDisplayName(profile) {
  return normalizeName(profile.customName) || normalizeName(profile.resolvedName) || shortAddress(profile.address) || "Guest";
}

function formatFailureReason(reason = "") {
  if (!reason) return "unknown-error";
  return String(reason).trim().replace(/_/g, "-").replace(/[^a-z0-9-]/gi, "").toLowerCase();
}

function getFailureMessage(result, fallback) {
  const apiMessage = typeof result?.message === "string" ? result.message.trim() : "";
  if (apiMessage) return apiMessage;
  const reason = formatFailureReason(result?.reason || "");
  if (!reason) return fallback;
  return `${fallback} (${reason}).`;
}

function getWalletReasonMessage(reason = "", fallback = "Wallet action failed.") {
  const key = formatFailureReason(reason);
  if (key === "wallet-adapter-required") {
    return "Wallet adapter missing. Deploy wallet-adapter.js and reload.";
  }
  if (key === "wallet-connect-failed") return "Wallet connection was not completed.";
  if (key === "wallet-missing") return "No wallet was detected on this device.";
  if (key === "switch-rejected") return "Network switch was rejected.";
  if (key === "account-missing") return "No wallet account is available.";
  return key && key !== "unknown-error" ? `${fallback} (${key}).` : fallback;
}

function isPracticeCheckpointRun(result) {
  return Number(result?.startStage || 1) > 1;
}

function getNextMilestone(bestClearedStage) {
  const safeCleared = Math.max(0, Math.floor(bestClearedStage || 0));
  return REWARD_MILESTONES.find((milestone) => milestone.stage > safeCleared) || null;
}

const els = {
  screens: {
    home: document.getElementById("screen-home"),
    game: document.getElementById("screen-game"),
    result: document.getElementById("screen-result"),
    leaderboard: document.getElementById("screen-leaderboard")
  },
  homeBest: document.getElementById("home-best"),
  homeDailyTarget: document.getElementById("home-daily-target"),
  homeDailyBest: document.getElementById("home-daily-best"),
  homeDailyHook: document.getElementById("home-daily-hook"),
  homeCampaignNote: document.getElementById("home-campaign-note"),
  homeTrustNote: document.getElementById("home-trust-note"),
  walletChip: document.getElementById("wallet-chip"),
  profileStatus: document.getElementById("profile-status"),
  profileDisplay: document.getElementById("profile-display"),
  authStatus: document.getElementById("auth-status"),
  inputCustomName: document.getElementById("input-custom-name"),
  hudScore: document.getElementById("hud-score"),
  hudBest: document.getElementById("hud-best"),
  hudLives: document.getElementById("hud-lives"),
  hudStage: document.getElementById("hud-stage"),
  hudSpeed: document.getElementById("hud-speed"),
  hudCombo: document.getElementById("hud-combo"),
  resultScore: document.getElementById("result-score"),
  resultBest: document.getElementById("result-best"),
  resultStage: document.getElementById("result-stage"),
  resultCombo: document.getElementById("result-combo"),
  resultSubtitle: document.getElementById("result-subtitle"),
  resultChallenge: document.getElementById("result-challenge"),
  resultSubmitStatus: document.getElementById("result-submit-status"),
  resultCampaignStatus: document.getElementById("result-campaign-status"),
  claimOgWrap: document.getElementById("claim-og-wrap"),
  claimOgStatus: document.getElementById("claim-og-status"),
  leaderboardList: document.getElementById("leaderboard-list"),
  leaderboardModeNote: document.getElementById("leaderboard-mode-note"),
  toastStack: document.getElementById("toast-stack"),
  canvas: document.getElementById("game-canvas"),
  buttons: {
    playNow: document.getElementById("btn-play-now"),
    continueCampaign: document.getElementById("btn-continue-campaign"),
    homeLeaderboard: document.getElementById("btn-home-leaderboard"),
    homeShare: document.getElementById("btn-home-share"),
    homeSave: document.getElementById("btn-home-save"),
    viewContract: document.getElementById("btn-view-contract"),
    connectWallet: document.getElementById("btn-connect-wallet"),
    switchBase: document.getElementById("btn-switch-base"),
    authenticate: document.getElementById("btn-authenticate"),
    saveCustomName: document.getElementById("btn-save-custom-name"),
    quickRestart: document.getElementById("btn-quick-restart"),
    backHome: document.getElementById("btn-back-home"),
    playAgain: document.getElementById("btn-play-again"),
    shareScore: document.getElementById("btn-share-score"),
    submitScore: document.getElementById("btn-submit-score"),
    claimOg: document.getElementById("btn-claim-og"),
    viewProof: document.getElementById("btn-view-proof"),
    resultLeaderboard: document.getElementById("btn-result-leaderboard"),
    resultSave: document.getElementById("btn-result-save"),
    leaderboardPlay: document.getElementById("btn-leaderboard-play"),
    leaderboardHome: document.getElementById("btn-leaderboard-home"),
    soundToggle: document.getElementById("btn-sound-toggle")
  },
  controlButtons: Array.from(document.querySelectorAll("[data-control]"))
};

const state = {
  screen: "home",
  bestScore: getBestScore(),
  dailySeed: getDailySeed(),
  dailyTarget: 0,
  dailyBest: 0,
  currentRunNotifiedBest: false,
  controls: {
    left: false,
    right: false
  },
  lastResult: null,
  lastSubmissionSignature: "",
  milestoneClaims: {},
  trustModes: {
    daily: "local",
    leaderboard: "local",
    submit: "local",
    reward: "local"
  },
  runtime: getRuntimeCapabilities(),
  campaignProgress: getCampaignProgress(),
  auth: {
    mode: "none",
    verified: false,
    address: "",
    chainId: "",
    token: "",
    expiresAt: "",
    issuedAt: "",
    message: "",
    signature: ""
  },
  profile: getProfile(),
  unsubWalletWatcher: null,
  soundMuted: getSoundMuted()
};

const CAMPAIGN_TOTAL = 20;
const isMobileGameplay = window.matchMedia("(max-width: 760px)").matches;
const shouldAutoPlay = new URLSearchParams(window.location.search).get("play") === "1";

if (isMobileGameplay) {
  const viewportRatio = window.innerHeight / Math.max(window.innerWidth, 1);
  const tallPhone = viewportRatio >= 2;
  const narrowPhone = window.innerWidth <= 390;
  const desiredHeight = tallPhone ? 700 : 640;
  const maxHeightFromViewport = Math.max(580, Math.floor(window.innerHeight - 260));
  GAME_CONFIG.width = 360;
  GAME_CONFIG.height = Math.min(desiredHeight, maxHeightFromViewport);
  GAME_CONFIG.bricks.cols = narrowPhone ? 16 : 18;
  GAME_CONFIG.bricks.topOffset = tallPhone ? 74 : 62;
  GAME_CONFIG.bricks.colGap = narrowPhone ? 5 : 4;
  GAME_CONFIG.bricks.rowGap = narrowPhone ? 5 : 4;
  GAME_CONFIG.bricks.brickHeight = narrowPhone ? 19 : 18;
  GAME_CONFIG.paddle.width = tallPhone ? 86 : 80;
  GAME_CONFIG.paddle.yOffset = tallPhone ? 44 : 34;
  GAME_CONFIG.ball.baseSpeed = tallPhone ? 228 : 235;
  GAME_CONFIG.ball.maxSpeed = 430;
}

state.dailyTarget = getDailyTarget(state.dailySeed);
state.dailyBest = getDailyBest(state.dailySeed);

const audio = new SfxEngine();
audio.setEnabled(!state.soundMuted);

els.canvas.width = GAME_CONFIG.width;
els.canvas.height = GAME_CONFIG.height;

function setScreen(screen) {
  state.screen = screen;
  Object.entries(els.screens).forEach(([name, node]) => {
    node.classList.toggle("is-active", name === screen);
  });
  document.body.classList.toggle("game-mode", screen === "game");
}

function toast(message, tone = "normal") {
  const item = document.createElement("div");
  item.className = tone === "blue" ? "toast blue" : "toast";
  item.textContent = message;
  els.toastStack.append(item);
  window.setTimeout(() => item.remove(), 1500);
}

function setActionBusy(button, isBusy, busyLabel) {
  if (!button) return;
  if (isBusy) {
    if (!button.dataset.prevLabel) button.dataset.prevLabel = button.textContent || "";
    if (!button.dataset.prevDisabled) button.dataset.prevDisabled = button.disabled ? "1" : "0";
    button.disabled = true;
    if (busyLabel) button.textContent = busyLabel;
    return;
  }
  const prevLabel = button.dataset.prevLabel || "";
  const prevDisabled = button.dataset.prevDisabled === "1";
  if (prevLabel) button.textContent = prevLabel;
  button.disabled = prevDisabled;
  delete button.dataset.prevLabel;
  delete button.dataset.prevDisabled;
}

function pulse(pattern) {
  if (!isMobileGameplay) return;
  if (!navigator.vibrate) return;
  navigator.vibrate(pattern);
}

function refreshSoundButton() {
  els.buttons.soundToggle.textContent = state.soundMuted ? "SFX OFF" : "SFX ON";
}

function isAuthSessionValid() {
  if (!state.auth.verified) return false;
  if (!state.profile.address || state.auth.address.toLowerCase() !== state.profile.address.toLowerCase()) return false;
  if (!state.auth.expiresAt) return true;
  const expiresAt = Date.parse(state.auth.expiresAt);
  if (!Number.isFinite(expiresAt)) return true;
  return Date.now() < expiresAt;
}

function applyAuthSession(session, mode) {
  state.auth = {
    mode: mode || "none",
    verified: Boolean(session?.verified),
    address: session?.address || "",
    chainId: session?.chainId || "",
    token: session?.token || "",
    expiresAt: session?.expiresAt || "",
    issuedAt: session?.issuedAt || "",
    message: session?.message || "",
    signature: session?.signature || ""
  };
}

function clearAuthSession() {
  applyAuthSession(null, "none");
}

function updateHome() {
  els.homeBest.textContent = formatCompactScore(state.bestScore);
  els.homeDailyTarget.textContent = formatCompactScore(state.dailyTarget);
  els.homeDailyBest.textContent = formatCompactScore(state.dailyBest);
  const unlockedStage = Math.max(1, Math.min(CAMPAIGN_TOTAL, Number(state.campaignProgress?.unlockedStage || 1)));
  const bestCleared = Math.max(0, Math.min(CAMPAIGN_TOTAL, Number(state.campaignProgress?.bestClearedStage || 0)));
  const nextMilestone = getNextMilestone(bestCleared);
  const claimedCount = Object.values(state.milestoneClaims || {}).filter(
    (claim) => Boolean(claim?.tokenId)
  ).length;
  const continueAvailable = unlockedStage > 1;
  if (nextMilestone) {
    const left = Math.max(0, nextMilestone.stage - bestCleared);
    els.homeCampaignNote.textContent = `${left} stage${left === 1 ? "" : "s"} left to claim ${nextMilestone.label} NFT proof (${claimedCount}/4 claimed).`;
  } else {
    els.homeCampaignNote.textContent = `All milestone claims unlocked. ${claimedCount}/4 claims created on this device.`;
  }
  els.buttons.continueCampaign.classList.toggle("is-hidden", !continueAvailable);
  if (continueAvailable) {
    els.buttons.continueCampaign.textContent = `Continue Stage ${unlockedStage} (Practice)`;
  }
  const left = Math.max(0, state.dailyTarget - state.dailyBest);
  els.homeDailyHook.textContent =
    left === 0
      ? "Daily target cleared. Post your score."
      : `${formatScore(left)} points to clear today's target.`;
  const hasRemoteConfig =
    state.runtime.hasDailySeed || state.runtime.hasSubmitScore || state.runtime.hasLeaderboard || state.runtime.hasClaimReward;
  if (state.trustModes.daily === "remote") {
    els.homeTrustNote.textContent = `Daily challenge synced from live service. Guest mode still starts instantly.${getRewardContractHint()}`;
  } else if (hasRemoteConfig) {
    els.homeTrustNote.textContent = `Remote services are configured. Current run data stays local until verified sync succeeds.${getRewardContractHint()}`;
  } else {
    els.homeTrustNote.textContent =
      `Local challenge mode active. Wallet is optional for milestone claim proofs. Best cleared stage: ${bestCleared}.`;
  }

  const contractUrl = typeof state.runtime.rewardContractExplorerUrl === "string"
    ? state.runtime.rewardContractExplorerUrl.trim()
    : "";
  if (contractUrl) {
    els.buttons.viewContract.classList.remove("is-hidden");
    els.buttons.viewContract.disabled = false;
  } else {
    els.buttons.viewContract.classList.add("is-hidden");
    els.buttons.viewContract.disabled = true;
  }
}

function updateProfileUI() {
  const displayName = getDisplayName(state.profile);
  const connected = Boolean(state.profile.address);
  const chainText = connected ? (isBaseChain(state.profile.chainId) ? "Base" : `Chain ${state.profile.chainId || "?"}`) : "No wallet";
  const walletModeTag = state.runtime.walletMode ? ` via ${state.runtime.walletMode}` : "";
  if (connected) {
    els.profileStatus.textContent = `Connected: ${shortAddress(state.profile.address)} (${chainText}${walletModeTag})`;
  } else if (state.runtime.walletMode === "adapter-required") {
    els.profileStatus.textContent = "Guest mode active. Wallet adapter is required for connect/auth actions.";
  } else {
    els.profileStatus.textContent = "Guest mode active";
  }
  els.walletChip.textContent = connected ? shortAddress(state.profile.address) : "Guest";
  els.profileDisplay.textContent = `Current: ${displayName}`;
  if (!connected) {
    clearAuthSession();
  } else if (state.auth.address && state.auth.address.toLowerCase() !== state.profile.address.toLowerCase()) {
    clearAuthSession();
  }

  const remoteActionsEnabled = state.runtime.hasSubmitScore || state.runtime.hasClaimReward;
  const needsVerifiedAuth = remoteActionsEnabled && state.runtime.hasAuthVerify && state.runtime.hasAuthNonce;
  if (state.runtime.walletMode === "adapter-required") {
    els.authStatus.textContent = "Auth: wallet adapter missing";
    els.buttons.authenticate.textContent = "Wallet Adapter Required";
    els.buttons.authenticate.disabled = true;
  } else if (!connected) {
    els.authStatus.textContent = "Auth: connect wallet first";
    els.buttons.authenticate.textContent = "Authenticate (SIWE)";
    els.buttons.authenticate.disabled = true;
  } else if (remoteActionsEnabled && !needsVerifiedAuth) {
    els.authStatus.textContent = "Auth: backend auth endpoints missing";
    els.buttons.authenticate.textContent = "Auth Config Missing";
    els.buttons.authenticate.disabled = true;
  } else if (!needsVerifiedAuth) {
    els.authStatus.textContent = "Auth: optional (local mode)";
    els.buttons.authenticate.textContent = "Authenticate (Optional)";
    els.buttons.authenticate.disabled = false;
  } else if (isAuthSessionValid()) {
    els.authStatus.textContent = "Auth: verified session active";
    els.buttons.authenticate.textContent = "Re-Authenticate";
    els.buttons.authenticate.disabled = false;
  } else {
    els.authStatus.textContent = "Auth: verification required for remote actions";
    els.buttons.authenticate.textContent = "Authenticate (Required)";
    els.buttons.authenticate.disabled = false;
  }

  if (document.activeElement !== els.inputCustomName) {
    els.inputCustomName.value = state.profile.customName || "";
  }
}

function syncClaimRecord() {
  state.milestoneClaims = state.profile.address ? getMilestoneClaimsByWallet(state.profile.address) : {};
  const claimList = Object.values(state.milestoneClaims || {});
  if (!claimList.length) {
    state.trustModes.reward = "local";
    return;
  }
  state.trustModes.reward = claimList.some((claim) => claim.status === CLAIM_STATUS.synced)
    ? "remote"
    : "local";
}

function isMintedClaim(claim) {
  return claim?.status === CLAIM_STATUS.synced && claim?.mintStatus === MINT_STATUS.minted;
}

function getMilestoneClaimContext(bestClearedStage) {
  const safeBest = Math.max(0, Math.min(CAMPAIGN_TOTAL, Math.floor(bestClearedStage || 0)));
  const claims = state.milestoneClaims || {};
  const eligible = REWARD_MILESTONES.filter((milestone) => milestone.stage <= safeBest);
  const nextMilestone = getNextMilestone(safeBest);

  if (!eligible.length) {
    const first = REWARD_MILESTONES[0] || null;
    return {
      unlocked: false,
      bestClearedStage: safeBest,
      milestone: first,
      claim: first ? claims[first.id] || null : null,
      nextMilestone
    };
  }

  for (const milestone of eligible) {
    const claim = claims[milestone.id] || null;
    if (!claim || !isMintedClaim(claim)) {
      return {
        unlocked: true,
        bestClearedStage: safeBest,
        milestone,
        claim,
        nextMilestone
      };
    }
  }

  const latest = eligible[eligible.length - 1] || null;
  return {
    unlocked: true,
    bestClearedStage: safeBest,
    milestone: latest,
    claim: latest ? claims[latest.id] || null : null,
    nextMilestone
  };
}

function getClaimUiState(context) {
  const milestone = context?.milestone || null;
  const claim = context?.claim || null;
  if (!milestone) {
    return {
      message: "Milestone metadata unavailable.",
      buttonText: "Claim Unavailable",
      disabled: true
    };
  }

  if (!context?.unlocked) {
    const left = Math.max(0, milestone.stage - Number(context?.bestClearedStage || 0));
    return {
      message: `${left} stage${left === 1 ? "" : "s"} left to unlock ${milestone.label} (stage ${milestone.stage}).`,
      buttonText: `Locked Until Stage ${milestone.stage}`,
      disabled: true
    };
  }

  if (!claim) {
    return {
      message: `${milestone.label} unlocked. Create your milestone claim proof now.`,
      buttonText: `Claim ${milestone.label}`,
      disabled: false
    };
  }

  if (claim.status === CLAIM_STATUS.synced) {
    if (claim.mintStatus === MINT_STATUS.minted) {
      const mintedToken = claim.mintedTokenId || claim.tokenId;
      const txSnippet = claim.mintTxHash ? ` Tx ${claim.mintTxHash.slice(0, 10)}...` : "";
      const mintedSuffix = claim.mintTxHash
        ? ""
        : " Already minted onchain earlier for this wallet (no new tx).";
      if (context?.nextMilestone) {
        return {
          message: `${milestone.label} minted (#${mintedToken}). ${context.nextMilestone.label} unlocks at stage ${context.nextMilestone.stage}.${txSnippet}${mintedSuffix}`,
          buttonText: "Milestone Minted",
          disabled: true
        };
      }
      return {
        message: `${milestone.label} minted (#${mintedToken}).${txSnippet}${mintedSuffix}`,
        buttonText: "Milestone Minted",
        disabled: true
      };
    }

    if (claim.mintStatus === MINT_STATUS.failed) {
      const reason = typeof claim.mintError === "string" && claim.mintError.trim()
        ? ` Reason: ${claim.mintError.trim()}.`
        : "";
      return {
        message: `${milestone.label} synced but mint failed.${reason} Retry sync to refresh mint state.`,
        buttonText: "Retry Mint Sync",
        disabled: false
      };
    }

    if (claim.mintStatus === MINT_STATUS.pending) {
      return {
        message: `${milestone.label} synced. Onchain mint is pending.${getRewardContractHint()}`,
        buttonText: "Refresh Mint Status",
        disabled: false
      };
    }

    return {
      message: `${milestone.label} synced. Waiting for mint orchestration.${getRewardContractHint()}`,
      buttonText: state.runtime.hasClaimReward ? "Refresh Reward Status" : "Milestone Synced",
      disabled: !state.runtime.hasClaimReward
    };
  }

  if (claim.status === CLAIM_STATUS.failedSync) {
    const reason = typeof claim.lastSyncError === "string" && claim.lastSyncError.trim()
      ? ` (${claim.lastSyncError.trim()})`
      : "";
    return {
      message: `${milestone.label} saved locally. Sync failed${reason}, tap to retry.`,
      buttonText: "Retry Milestone Sync",
      disabled: false
    };
  }

  if (claim.status === CLAIM_STATUS.pending) {
    return {
      message: `${milestone.label} pending verification. Tap to retry sync.`,
      buttonText: "Retry Milestone Sync",
      disabled: false
    };
  }

  if (state.runtime.hasClaimReward) {
    return {
      message: `${milestone.label} is local-only on this device. Tap to sync with reward service.`,
      buttonText: "Sync Milestone Claim",
      disabled: false
    };
  }

  return {
    message: `Local ${milestone.label} claim saved on this device. Verified reward sync not configured.`,
    buttonText: "Local Claim Saved",
    disabled: true
  };
}

function updateHud(hud) {
  els.hudScore.textContent = formatScore(hud.score);
  els.hudBest.textContent = formatScore(hud.bestScore);
  els.hudLives.textContent = String(hud.lives);
  const stageTag = hud.stageName ? ` ${hud.stageName.split(" ")[0]}` : "";
  const total = Number(hud.stageTotal || CAMPAIGN_TOTAL);
  els.hudStage.textContent = `${hud.stage}/${total}${stageTag}`;
  els.hudSpeed.textContent = `${hud.speedMultiplier.toFixed(1)}x`;
  const comboValue = hud.multiplier > 1 ? `x${hud.combo} | M${hud.multiplier}` : `x${hud.combo}`;
  els.hudCombo.textContent = comboValue;
}

function getShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("play", "1");
  url.hash = "";
  return url.toString();
}

function composeShareText(payload, isDaily = false) {
  const template = isDaily ? COPY.dailyShareTemplate : COPY.shareTemplate;
  const message = template
    .replace("{score}", formatScore(payload.score))
    .replace("{best}", formatScore(payload.best))
    .replace("{stage}", String(payload.stage));
  return `${message} ${getShareUrl()}`;
}

async function sharePayload(payload, isDaily = false) {
  try {
    const res = await shareScore({
      ...payload,
      text: composeShareText(payload, isDaily),
      url: getShareUrl()
    });
    if (res.ok && res.method === "clipboard") {
      toast("Share text copied", "blue");
      return;
    }
    if (res.ok) {
      toast("Shared", "blue");
      return;
    }
    toast("Share unavailable on this device");
  } catch {
    toast("Share was cancelled");
  }
}

function updateControlState() {
  game.setControlState(state.controls);
}

function persistCampaignCheckpoint({ clearedStage = 0, lastPlayedStage = 1 } = {}) {
  const safeCleared = Math.max(0, Math.min(CAMPAIGN_TOTAL, Math.floor(clearedStage || 0)));
  const safeLastPlayed = Math.max(1, Math.min(CAMPAIGN_TOTAL, Math.floor(lastPlayedStage || 1)));
  const currentUnlocked = Number(state.campaignProgress?.unlockedStage || 1);
  const currentBestCleared = Number(state.campaignProgress?.bestClearedStage || 0);
  const nextBestCleared = Math.max(currentBestCleared, safeCleared);
  const nextUnlocked = Math.min(
    CAMPAIGN_TOTAL,
    Math.max(currentUnlocked, Math.max(1, nextBestCleared + 1))
  );

  state.campaignProgress = setCampaignProgress({
    unlockedStage: nextUnlocked,
    bestClearedStage: nextBestCleared,
    lastPlayedStage: safeLastPlayed,
    updatedAt: new Date().toISOString()
  });
}

function persistProfile(patch) {
  state.profile = setProfile({ ...state.profile, ...patch });
  syncClaimRecord();
  updateHome();
  updateProfileUI();
}

async function applyWalletState(profileLike) {
  if (!profileLike.address) {
    persistProfile({ address: "", chainId: "", resolvedName: "" });
    return;
  }

  const resolvedName = await resolveWalletName(profileLike.address);
  persistProfile({
    address: profileLike.address,
    chainId: profileLike.chainId || state.profile.chainId,
    resolvedName
  });
}

async function connectWalletFlow() {
  setActionBusy(els.buttons.connectWallet, true, "Connecting...");
  try {
    const connected = await connectWallet();
    if (!connected.ok) {
      toast(getWalletReasonMessage(connected.reason, "Wallet connection failed"));
      return;
    }
    await applyWalletState(connected);
    toast("Wallet connected", "blue");
  } catch {
    toast("Wallet connection rejected");
  } finally {
    setActionBusy(els.buttons.connectWallet, false);
  }
}

async function switchBaseFlow() {
  setActionBusy(els.buttons.switchBase, true, "Switching...");
  try {
    const switched = await ensureBaseNetwork();
    if (!switched.ok) {
      toast(getWalletReasonMessage(switched.reason, "Could not switch to Base"));
      return;
    }
    persistProfile({ chainId: switched.chainId });
    toast("Switched to Base", "blue");
  } catch {
    toast("Network switch cancelled");
  } finally {
    setActionBusy(els.buttons.switchBase, false);
  }
}

async function authenticateFlow(reason = "verify your profile") {
  if (!state.profile.address) {
    toast("Connect wallet first");
    return { ok: false, reason: "wallet-missing" };
  }

  setActionBusy(els.buttons.authenticate, true, "Authenticating...");
  try {
    const authResult = await authenticateWithSiwe({
      statement: `Authorize BaseBrick to ${reason}.`
    });
    if (!authResult.ok) {
      const message = getFailureMessage(authResult, "Authentication failed");
      toast(message);
      return {
        ok: false,
        reason: authResult.reason || "auth-failed",
        message
      };
    }
    applyAuthSession(authResult.session, authResult.mode);
    updateProfileUI();
    toast(authResult.mode === "siwe-verified" ? "Wallet authenticated" : "Local auth proof saved", "blue");
    return { ok: true };
  } catch {
    toast("Authentication cancelled");
    return { ok: false, reason: "auth-cancelled" };
  } finally {
    setActionBusy(els.buttons.authenticate, false);
    updateProfileUI();
  }
}

async function ensureRemoteActionAuth(reason, requiresRemote) {
  if (!requiresRemote) return { ok: true, auth: null };
  if (!state.runtime.hasAuthVerify || !state.runtime.hasAuthNonce) {
    return { ok: false, reason: "auth-config-missing" };
  }
  if (isAuthSessionValid()) return { ok: true, auth: state.auth };
  const authResult = await authenticateFlow(reason);
  if (!authResult.ok) return { ok: false, reason: authResult.reason || "auth-required", message: authResult.message || "" };
  return isAuthSessionValid() ? { ok: true, auth: state.auth } : { ok: false };
}

function saveCustomNameFlow() {
  const customName = normalizeName(els.inputCustomName.value);
  persistProfile({ customName });
  toast(customName ? "Custom name saved" : "Custom name cleared", "blue");
}

function startRun(options = {}) {
  const requestedStage = Number.isFinite(options?.startStage) ? Math.floor(options.startStage) : 1;
  const safeStage = Math.max(1, Math.min(CAMPAIGN_TOTAL, requestedStage));
  state.currentRunNotifiedBest = false;
  setScreen("game");
  els.toastStack.innerHTML = "";
  game.restart({
    bestScore: state.bestScore,
    dailySeed: state.dailySeed,
    startStage: safeStage
  });
  if (safeStage > 1) {
    toast(`${getDisplayName(state.profile)} resumed at stage ${safeStage} (practice)`, "blue");
  } else {
    toast(`${getDisplayName(state.profile)} is live`, "blue");
  }
}

function toHome() {
  if (state.screen === "game" && game?.run) {
    const currentStage = Math.max(1, Math.min(CAMPAIGN_TOTAL, Number(game.run.stage || 1)));
    persistCampaignCheckpoint({
      clearedStage: Math.max(0, currentStage - 1),
      lastPlayedStage: currentStage
    });
  }
  game.stop();
  setScreen("home");
  updateHome();
}

function openRewardContract() {
  const contractUrl = typeof state.runtime.rewardContractExplorerUrl === "string"
    ? state.runtime.rewardContractExplorerUrl.trim()
    : "";
  if (!contractUrl) {
    toast("Reward contract link unavailable");
    return;
  }
  window.open(contractUrl, "_blank", "noopener,noreferrer");
}

function fillResult(result) {
  const checkpointRun = isPracticeCheckpointRun(result);
  const verifiedSubmitAvailable = state.runtime.hasSubmitScore;
  const bestCleared = Math.max(0, Math.min(CAMPAIGN_TOTAL, Number(state.campaignProgress?.bestClearedStage || 0)));
  const claimContext = getMilestoneClaimContext(bestCleared);
  const claimState = getClaimUiState(claimContext);
  const nextMilestone = getNextMilestone(bestCleared);
  els.resultScore.textContent = formatScore(result.score);
  els.resultBest.textContent = formatScore(result.bestScore);
  els.resultStage.textContent = String(result.stage);
  els.resultCombo.textContent = `x${result.maxCombo}`;
  if (result.campaignComplete && !checkpointRun) {
    els.resultSubtitle.textContent = "20/20 clear complete. Omega BaseBrick NFT claim unlocked.";
  } else if (result.newBest) {
    els.resultSubtitle.textContent = "New best signal. Submit, share, and push for the next NFT milestone.";
  } else if (claimContext.unlocked && !claimContext.claim) {
    els.resultSubtitle.textContent = `${claimContext.milestone?.label || "Milestone"} NFT unlocked. Claim now.`;
  } else {
    els.resultSubtitle.textContent = "Beat this score and push toward your next Base NFT milestone.";
  }
  els.resultChallenge.textContent = `Beat ${formatScore(result.score)} in BaseBrick.`;
  const totalStages = Number(result.totalStages || CAMPAIGN_TOTAL);
  els.resultCampaignStatus.textContent = nextMilestone
    ? `Campaign progress: ${bestCleared} / ${totalStages}. Next claim at stage ${nextMilestone.stage} (${nextMilestone.label}).`
    : `Campaign progress: ${bestCleared} / ${totalStages}. All milestone claims unlocked.`;
  if (checkpointRun) {
    els.buttons.submitScore.textContent = "Practice Run (No Submit)";
    els.buttons.submitScore.disabled = true;
    els.resultSubmitStatus.textContent =
      "Run mode: Checkpoint Practice. Verified submit is disabled for trust fairness.";
  } else {
    els.buttons.submitScore.disabled = false;
    if (verifiedSubmitAvailable) {
      els.buttons.submitScore.textContent = "Submit Verified Score";
      els.resultSubmitStatus.textContent = state.profile.address
        ? state.trustModes.submit === "remote"
          ? `Run mode: Stage 1 campaign. Verified submit ready as ${getDisplayName(state.profile)}.`
          : `Run mode: Stage 1 campaign. Verified submit available for ${getDisplayName(state.profile)}.`
        : "Run mode: Stage 1 campaign. Connect wallet to submit verified score.";
    } else {
      els.buttons.submitScore.textContent = "Sign Local Run";
      els.resultSubmitStatus.textContent =
        "Run mode: Stage 1 campaign. Verified submit endpoint not detected; local signed proof only.";
    }
  }

  els.claimOgWrap.classList.remove("is-hidden");
  els.claimOgStatus.textContent = claimState.message;
  els.buttons.claimOg.textContent = claimState.buttonText;
  els.buttons.claimOg.disabled = claimState.disabled;
  updateProofButton();
}

function renderLeaderboard(entries, heading = "") {
  els.leaderboardList.innerHTML = "";
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "leader-empty";
    empty.textContent = "No signed runs saved yet on this device. Sign a run to set rank #1.";
    els.leaderboardList.append(empty);
    return;
  }

  if (heading) {
    const title = document.createElement("div");
    title.className = "leader-empty";
    title.textContent = heading;
    els.leaderboardList.append(title);
  }

  entries.forEach((entry, index) => {
    const row = document.createElement("article");
    row.className = "leader-item";

    const rank = document.createElement("p");
    rank.className = "leader-rank";
    rank.textContent = String(index + 1);

    const name = normalizeName(entry.playerName) || shortAddress(entry.wallet) || "Anonymous";
    const body = document.createElement("div");
    body.className = "leader-body";

    const nameLine = document.createElement("p");
    nameLine.className = "leader-name";
    nameLine.textContent = name;

    const detailLine = document.createElement("p");
    detailLine.className = "leader-meta";
    const compactMobile = window.matchMedia("(max-width: 420px)").matches;
    detailLine.textContent = compactMobile
      ? `S${entry.stage}  Cx${entry.maxCombo}  ${dateShort(entry.when)}`
      : `Stage ${entry.stage} | Combo x${entry.maxCombo} | ${dateShort(entry.when)}`;

    const scoreWrap = document.createElement("div");
    scoreWrap.className = "leader-score-wrap";
    const score = document.createElement("p");
    score.className = "leader-score";
    score.textContent = formatScore(entry.score);
    const scoreLabel = document.createElement("p");
    scoreLabel.className = "leader-score-label";
    scoreLabel.textContent = "PTS";

    body.append(nameLine, detailLine);
    scoreWrap.append(score, scoreLabel);
    row.append(rank, body, scoreWrap);
    els.leaderboardList.append(row);
  });
}

async function openLeaderboard() {
  game.stop();
  setScreen("leaderboard");
  els.leaderboardModeNote.textContent = "Loading leaderboard...";

  const fallbackLocal = getTopRuns().slice(0, 8);
  renderLeaderboard(fallbackLocal, "Top runs on this device");
  state.trustModes.leaderboard = "local";

  try {
    const remote = await fetchLeaderboard();
    if (remote.ok) {
      const entries = remote.entries.slice(0, 8);
      if (remote.mode === "verified-remote" && entries.length) {
        renderLeaderboard(entries, "Verified leaderboard");
        state.trustModes.leaderboard = "remote";
        els.leaderboardModeNote.textContent = "Verified leaderboard sync is live.";
        return;
      }
      if (entries.length) renderLeaderboard(entries, "Signed runs on this device");
    }
  } catch {
    // Keep local fallback.
  }

  els.leaderboardModeNote.textContent = state.runtime.hasLeaderboard
    ? "Verified leaderboard endpoint is configured, but sync is currently unavailable. Showing device data."
    : "Runs are stored on this device. Global verified leaderboard is not live yet.";
}

async function askInstall() {
  const result = await promptSaveInstall();
  if (!result.ok) {
    const ua = navigator.userAgent || "";
    const inBaseApp = /Base/i.test(ua) || /Coinbase/i.test(ua);
    toast(inBaseApp ? "In Base app, install is handled automatically." : "Install prompt unavailable in this browser");
    return;
  }
  const accepted = result.choice?.outcome === "accepted";
  toast(accepted ? "Saved to your device" : "Install skipped");
}

async function submitCurrentScore() {
  if (!state.lastResult) {
    toast("No run to submit yet");
    return;
  }
  if (isPracticeCheckpointRun(state.lastResult)) {
    els.resultSubmitStatus.textContent =
      "Practice checkpoint runs are not eligible for verified submit. Start from stage 1 for ranked submit.";
    toast("Practice run submit disabled");
    return;
  }
  if (!state.profile.address) {
    toast("Connect wallet to sign this run");
    return;
  }

  setActionBusy(els.buttons.submitScore, true, "Submitting...");
  try {
    if (!isBaseChain(state.profile.chainId)) {
      const switched = await ensureBaseNetwork();
      if (!switched.ok) {
        els.resultSubmitStatus.textContent = "Switch to Base network to submit.";
        toast("Base switch required");
        return;
      }
      persistProfile({ chainId: switched.chainId });
    }

    const authGate = await ensureRemoteActionAuth("verify competitive score submissions", state.runtime.hasSubmitScore);
    if (!authGate.ok) {
      els.resultSubmitStatus.textContent =
        authGate.reason === "auth-config-missing"
          ? "Verified submit requires authNonce/authVerify backend endpoints."
          : authGate.message || "Authentication is required for verified submit mode.";
      return;
    }

    const response = await submitScore({
      score: state.lastResult.score,
      stage: state.lastResult.stage,
      maxCombo: state.lastResult.maxCombo,
      dailySeed: state.dailySeed,
      playerName: getDisplayName(state.profile)
    }, {
      auth: authGate.auth
    });

    if (!response.ok) {
      const submitMessage = getFailureMessage(response, "Score submit failed");
      els.resultSubmitStatus.textContent = submitMessage;
      toast(submitMessage);
      return;
    }

    state.lastSubmissionSignature = response.signature;
    updateProofButton();
    if (response.mode === "verified-remote" && response.synced) {
      state.trustModes.submit = "remote";
      els.resultSubmitStatus.textContent = `Verified submit sent as ${getDisplayName(state.profile)} (${response.chainId}).`;
      toast("Verified submit sent", "blue");
      return;
    }

    state.trustModes.submit = "local";
    els.resultSubmitStatus.textContent = `Signed and saved on this device as ${getDisplayName(state.profile)} (${response.chainId}).`;
    toast("Run signed and saved locally", "blue");
  } catch {
    els.resultSubmitStatus.textContent = "Signing was cancelled.";
    toast("Signing cancelled");
  } finally {
    setActionBusy(els.buttons.submitScore, false);
    if (state.lastResult) fillResult(state.lastResult);
  }
}

async function viewProofAction() {
  const claim = getCurrentResultClaimContext()?.claim || null;
  const txUrl = claim ? getMintTxUrlForClaim(claim) : "";
  if (txUrl) {
    window.open(txUrl, "_blank", "noopener,noreferrer");
    toast("Opened mint transaction", "blue");
    return;
  }

  const metadataUrl = claim ? getNftMetadataUrlForClaim(claim) : "";
  if (metadataUrl) {
    window.open(metadataUrl, "_blank", "noopener,noreferrer");
    toast("Opened NFT metadata", "blue");
    return;
  }

  if (!state.lastSubmissionSignature) {
    toast("Sign a run first to generate local proof");
    return;
  }
  if (!navigator.clipboard?.writeText) {
    toast("Clipboard unavailable");
    return;
  }
  await navigator.clipboard.writeText(state.lastSubmissionSignature);
  toast("Signature copied", "blue");
}

async function claimMilestoneFlow() {
  const bestCleared = Math.max(0, Math.min(CAMPAIGN_TOTAL, Number(state.campaignProgress?.bestClearedStage || 0)));
  const claimContext = getMilestoneClaimContext(bestCleared);
  if (!claimContext.unlocked || !claimContext.milestone) {
    toast(`Reach stage ${claimContext.milestone?.stage || 5} first`);
    return;
  }
  if (!state.profile.address) {
    toast("Connect wallet to claim milestone proof");
    return;
  }

  setActionBusy(els.buttons.claimOg, true, "Claiming...");
  try {
    if (!isBaseChain(state.profile.chainId)) {
      const switched = await ensureBaseNetwork();
      if (!switched.ok) {
        els.claimOgStatus.textContent = "Switch to Base to claim milestone reward.";
        toast("Base switch required");
        return;
      }
      persistProfile({ chainId: switched.chainId });
    }

    const authGate = await ensureRemoteActionAuth("verify reward claims", state.runtime.hasClaimReward);
    if (!authGate.ok) {
      els.claimOgStatus.textContent =
        authGate.reason === "auth-config-missing"
          ? "Verified reward sync requires authNonce/authVerify backend endpoints."
          : authGate.message || "Authentication is required for verified reward sync.";
      return;
    }

    const response = await claimMilestoneReward({
      milestoneId: claimContext.milestone.id,
      milestoneStage: claimContext.milestone.stage,
      milestoneLabel: claimContext.milestone.label,
      playerName: getDisplayName(state.profile),
      score: state.lastResult?.score || claimContext.claim?.score || 0,
      stage: Math.max(claimContext.milestone.stage, state.lastResult?.stage || claimContext.claim?.stage || 1)
    }, {
      auth: authGate.auth
    });

    if (!response.ok) {
      if (response.claim) {
        syncClaimRecord();
        updateHome();
      }
      const claimMessage = getFailureMessage(response, "Claim failed");
      els.claimOgStatus.textContent = claimMessage;
      toast(claimMessage);
      return;
    }

    syncClaimRecord();
    updateHome();
    const nextContext = getMilestoneClaimContext(
      Math.max(0, Math.min(CAMPAIGN_TOTAL, Number(state.campaignProgress?.bestClearedStage || 0)))
    );
    const claimState = getClaimUiState(nextContext);
    els.claimOgStatus.textContent = claimState.message;
    els.buttons.claimOg.textContent = claimState.buttonText;
    els.buttons.claimOg.disabled = claimState.disabled;
    updateProofButton();

    if (response.mode === "verified-remote" && response.synced) {
      state.trustModes.reward = "remote";
      if (response.claim?.mintStatus === MINT_STATUS.minted) {
        toast(response.alreadyClaimed ? "Mint status refreshed" : "Milestone minted", "blue");
      } else if (response.claim?.mintStatus === MINT_STATUS.failed) {
        toast("Mint failed, retry available");
      } else {
        toast(response.alreadyClaimed ? "Claim sync refreshed" : "Claim synced", "blue");
      }
    } else {
      state.trustModes.reward = "local";
      toast(response.retryable ? "Claim saved locally, sync retry available" : "Claim saved locally", "blue");
    }
  } catch {
    els.claimOgStatus.textContent = "Claim cancelled.";
    toast("Claim cancelled");
  } finally {
    setActionBusy(els.buttons.claimOg, false);
    if (state.lastResult) fillResult(state.lastResult);
  }
}

const game = new MonoBrickGame(els.canvas, {
  onHud: updateHud,
  onFeedback: ({ text, tone }) => toast(text, tone),
  onStageClear: ({ stage, cleanClear, bonus }) => {
    pulse(12);
    if (cleanClear) toast(`Clean clear bonus +${bonus}`, "blue");
    if (stage % 3 === 0) toast("Speed spike unlocked", "normal");
    persistCampaignCheckpoint({
      clearedStage: stage,
      lastPlayedStage: Math.min(CAMPAIGN_TOTAL, stage + 1)
    });
  },
  onCampaignComplete: ({ totalStages }) => {
    pulse([18, 50, 18]);
    toast(`Campaign ${totalStages}/${totalStages} complete`, "blue");
    toast("Omega milestone unlocked", "blue");
  },
  onRunEvent: (event) => {
    if (event.type === "new-best-live" && !state.currentRunNotifiedBest) {
      state.currentRunNotifiedBest = true;
      toast("New best pace", "blue");
    }
  },
  onSfx: (name) => {
    audio.play(name);
  },
  onGameOver: (result) => {
    pulse(24);
    state.lastResult = result;
    state.lastSubmissionSignature = "";
    syncClaimRecord();
    state.bestScore = Math.max(state.bestScore, result.bestScore);
    state.dailyBest = setDailyBest(state.dailySeed, result.score);
    setBestScore(state.bestScore);
    addRun({
      score: result.score,
      stage: result.stage,
      maxCombo: result.maxCombo,
      playerName: getDisplayName(state.profile),
      wallet: state.profile.address,
      when: result.endedAt
    });
    persistCampaignCheckpoint({
      clearedStage: result.campaignComplete
        ? CAMPAIGN_TOTAL
        : Math.max(0, Math.min(CAMPAIGN_TOTAL, Number(result.stage || 1) - 1)),
      lastPlayedStage: Math.max(1, Math.min(CAMPAIGN_TOTAL, Number(result.stage || 1)))
    });
    fillResult(result);
    updateHome();
    setScreen("result");
  }
});

els.buttons.playNow.addEventListener("click", startRun);
els.buttons.continueCampaign.addEventListener("click", () => {
  const unlocked = Math.max(1, Math.min(CAMPAIGN_TOTAL, Number(state.campaignProgress?.unlockedStage || 1)));
  const resumeStage = Math.max(2, unlocked);
  startRun({ startStage: resumeStage });
});
els.buttons.playAgain.addEventListener("click", startRun);
els.buttons.quickRestart.addEventListener("click", startRun);
els.buttons.backHome.addEventListener("click", toHome);
els.buttons.homeLeaderboard.addEventListener("click", openLeaderboard);
els.buttons.resultLeaderboard.addEventListener("click", openLeaderboard);
els.buttons.leaderboardPlay.addEventListener("click", startRun);
els.buttons.leaderboardHome.addEventListener("click", toHome);
els.buttons.submitScore.addEventListener("click", submitCurrentScore);
els.buttons.claimOg.addEventListener("click", claimMilestoneFlow);
els.buttons.viewProof.addEventListener("click", viewProofAction);

els.buttons.shareScore.addEventListener("click", () => {
  if (!state.lastResult) return;
  sharePayload(
    {
      score: state.lastResult.score,
      best: state.bestScore,
      stage: state.lastResult.stage
    },
    false
  );
});

els.buttons.homeShare.addEventListener("click", () => {
  sharePayload(
    {
      score: state.dailyBest,
      best: state.bestScore,
      stage: 1
    },
    true
  );
});

els.buttons.homeSave.addEventListener("click", askInstall);
els.buttons.viewContract.addEventListener("click", openRewardContract);
els.buttons.resultSave.addEventListener("click", askInstall);
els.buttons.connectWallet.addEventListener("click", connectWalletFlow);
els.buttons.switchBase.addEventListener("click", switchBaseFlow);
els.buttons.authenticate.addEventListener("click", () => authenticateFlow("authenticate your competitive profile"));
els.buttons.saveCustomName.addEventListener("click", saveCustomNameFlow);

els.buttons.soundToggle.addEventListener("click", () => {
  state.soundMuted = !state.soundMuted;
  setSoundMuted(state.soundMuted);
  audio.setEnabled(!state.soundMuted);
  refreshSoundButton();
  if (!state.soundMuted) {
    audio.play("launch");
  }
});

for (const controlButton of els.controlButtons) {
  const control = controlButton.dataset.control;
  if (control === "launch") {
    controlButton.addEventListener("click", () => {
      pulse(10);
      game.launchBall();
    });
    continue;
  }

  const activeKey = control === "left" ? "left" : "right";

  const activate = (event) => {
    event.preventDefault();
    if (typeof event.pointerId === "number" && controlButton.setPointerCapture) {
      controlButton.setPointerCapture(event.pointerId);
    }
    state.controls[activeKey] = true;
    controlButton.classList.add("is-active");
    updateControlState();
  };

  const deactivate = (event) => {
    event.preventDefault();
    state.controls[activeKey] = false;
    controlButton.classList.remove("is-active");
    updateControlState();
  };

  controlButton.addEventListener("pointerdown", activate);
  controlButton.addEventListener("pointerup", deactivate);
  controlButton.addEventListener("pointercancel", deactivate);
}

const pointer = {
  active: false,
  id: null,
  startX: 0,
  moved: false
};

function canvasClientToGameX(event) {
  const rect = els.canvas.getBoundingClientRect();
  return ((event.clientX - rect.left) * els.canvas.width) / rect.width;
}

els.canvas.addEventListener("pointerdown", (event) => {
  pointer.active = true;
  pointer.id = event.pointerId;
  pointer.startX = event.clientX;
  pointer.moved = false;
  els.canvas.setPointerCapture(event.pointerId);
  game.setPointerTarget(canvasClientToGameX(event));
});

els.canvas.addEventListener("pointermove", (event) => {
  if (!pointer.active) return;
  if (Math.abs(event.clientX - pointer.startX) > 8) {
    pointer.moved = true;
  }
  game.setPointerTarget(canvasClientToGameX(event));
});

function clearPointer(event) {
  if (!pointer.active) return;
  if (pointer.id !== null && event.pointerId !== pointer.id) return;
  if (!pointer.moved) {
    pulse(10);
    game.launchBall();
  }
  pointer.active = false;
  pointer.id = null;
  pointer.startX = 0;
  pointer.moved = false;
  game.clearPointerTarget();
}

els.canvas.addEventListener("pointerup", clearPointer);
els.canvas.addEventListener("pointercancel", clearPointer);
els.canvas.addEventListener("pointerleave", clearPointer);

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    state.controls.left = true;
    updateControlState();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    state.controls.right = true;
    updateControlState();
  } else if (event.code === "Space") {
    event.preventDefault();
    game.launchBall();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === "ArrowLeft") {
    state.controls.left = false;
    updateControlState();
  } else if (event.key === "ArrowRight") {
    state.controls.right = false;
    updateControlState();
  }
});

async function bootWalletSync() {
  try {
    state.unsubWalletWatcher = watchWallet((profileLike) => {
      applyWalletState(profileLike);
    });

    const maybeConnected = await getConnectedWallet();
    if (maybeConnected.ok) {
      await applyWalletState(maybeConnected);
      return;
    }
  } catch {
    // Silent: first-time users may not have or allow wallet.
  }

  updateProfileUI();
}

async function bootDailyChallenge() {
  try {
    const remote = await fetchDailyChallengeSeed();
    if (!remote.ok) return;
    state.dailySeed = remote.seed;
    state.dailyTarget = Number.isFinite(remote.target) ? remote.target : getDailyTarget(state.dailySeed);
    state.dailyBest = getDailyBest(state.dailySeed);
    state.trustModes.daily = "remote";
    updateHome();
  } catch {
    // Stay in local challenge mode.
  }
}

syncClaimRecord();
updateHome();
refreshSoundButton();
updateProfileUI();
syncThemeColorMeta();
const colorSchemeMedia = window.matchMedia("(prefers-color-scheme: light)");
if (typeof colorSchemeMedia.addEventListener === "function") {
  colorSchemeMedia.addEventListener("change", syncThemeColorMeta);
} else if (typeof colorSchemeMedia.addListener === "function") {
  colorSchemeMedia.addListener(syncThemeColorMeta);
}
setScreen("home");
bootWalletSync();
bootDailyChallenge();
els.canvas.focus?.();

if (shouldAutoPlay) {
  window.setTimeout(() => startRun(), 120);
}
