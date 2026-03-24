import {
  CLAIM_STATUS,
  addSubmittedRun,
  getMilestoneClaim,
  getSubmittedRuns,
  setMilestoneClaim
} from "./storage.js";
import {
  BASE_CHAIN_ID,
  connectWalletClient,
  ensureBaseNetworkClient,
  getConnectedWalletClient,
  getWalletMode,
  signInWithEthereumClient,
  signWalletMessage,
  watchWalletClient
} from "./wallet-client.js";

let installPromptEvent = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPromptEvent = event;
});

function buildFallbackText(payload) {
  const suffix = payload.url ? ` ${payload.url}` : "";
  return `BaseBrick run: ${payload.score} pts (best ${payload.best}, stage ${payload.stage})${suffix}`;
}

function shortAddress(address = "") {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getRuntimeConfig() {
  const candidate = window.MONOBRICK_RUNTIME || window.__MONOBRICK_RUNTIME__;
  if (!candidate || typeof candidate !== "object") return {};
  return candidate;
}

function getRewardConfig() {
  const config = getRuntimeConfig();
  const reward = typeof config.reward === "object" && config.reward ? config.reward : {};
  const contractAddress =
    typeof reward.contractAddress === "string" ? reward.contractAddress.trim() : "";
  const metadataBaseUri =
    typeof reward.metadataBaseUri === "string" ? reward.metadataBaseUri.trim() : "";
  const contractExplorerUrl =
    typeof reward.contractExplorerUrl === "string" ? reward.contractExplorerUrl.trim() : "";
  const chainId = typeof reward.chainId === "string" ? reward.chainId.trim() : "";
  return { contractAddress, metadataBaseUri, contractExplorerUrl, chainId };
}

function getEndpoint(key) {
  const config = getRuntimeConfig();
  const endpoints = typeof config.endpoints === "object" && config.endpoints ? config.endpoints : {};
  const direct = typeof config[key] === "string" ? config[key].trim() : "";
  const fromMap = typeof endpoints[key] === "string" ? endpoints[key].trim() : "";
  const baseUrl = typeof config.apiBaseUrl === "string" ? config.apiBaseUrl.trim() : "";
  const raw = fromMap || direct;
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!baseUrl) {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }
  const left = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const right = raw.startsWith("/") ? raw : `/${raw}`;
  return `${left}${right}`;
}

function normalizeEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.entries)) return payload.entries;
  return [];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const code = typeof parsed?.error?.code === "string" ? parsed.error.code : "";
    const message = typeof parsed?.error?.message === "string" ? parsed.error.message : "";
    const detail = typeof parsed?.error?.detail === "string" ? parsed.error.detail : "";
    const error = new Error(message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = code || `http-${response.status}`;
    error.apiMessage = message;
    error.apiDetail = detail;
    error.payload = parsed;
    throw error;
  }
  return parsed || {};
}

function getApiErrorCode(error, fallback = "request-failed") {
  if (typeof error?.code === "string" && error.code) return error.code;
  return fallback;
}

function getApiErrorMessage(error, fallback = "") {
  if (typeof error?.apiMessage === "string" && error.apiMessage) return error.apiMessage;
  if (typeof error?.message === "string" && error.message) return error.message;
  return fallback;
}

function isClientApiError(error) {
  return Number.isFinite(error?.status) && error.status >= 400 && error.status < 500;
}

function getChainIdNumber(chainId) {
  if (typeof chainId !== "string" || !chainId) return 8453;
  if (chainId.startsWith("0x")) {
    const parsed = Number.parseInt(chainId, 16);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const direct = Number.parseInt(chainId, 10);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return 8453;
}

function randomNonce() {
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeMilestoneId(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase().slice(0, 32);
}

function getMilestoneShape(payload = {}) {
  const milestoneId = normalizeMilestoneId(payload.milestoneId);
  const milestoneStageRaw = Number(payload.milestoneStage);
  return {
    milestoneId,
    milestoneStage: Number.isFinite(milestoneStageRaw) ? Math.max(1, Math.floor(milestoneStageRaw)) : 0,
    milestoneLabel: typeof payload.milestoneLabel === "string" ? payload.milestoneLabel.slice(0, 48) : ""
  };
}

function buildSiweMessage({ address, chainId, statement, nonce, issuedAt }) {
  const domain = window.location.host;
  const uri = window.location.origin;
  const chainIdNumber = getChainIdNumber(chainId);
  return (
    `${domain} wants you to sign in with your Ethereum account:\n` +
    `${address}\n\n` +
    `${statement}\n\n` +
    `URI: ${uri}\n` +
    `Version: 1\n` +
    `Chain ID: ${chainIdNumber}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}`
  );
}

function buildAuthHeaders(auth) {
  if (!auth || typeof auth !== "object") return {};
  const token = typeof auth.token === "string" ? auth.token.trim() : "";
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

function buildRewardPayload(basePayload, auth) {
  if (!auth) return basePayload;
  return { ...basePayload, auth };
}

function normalizeRemoteMintStatus(status) {
  const raw = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (raw === "minted") return "minted";
  if (raw === "failed") return "failed";
  if (raw === "pending") return "pending";
  if (raw === "unavailable") return "unavailable";
  return "pending";
}

function getMintUpdateFromResponse(response, fallback = {}) {
  if (!response || typeof response !== "object") {
    return {
      mintStatus: fallback.mintStatus || "pending",
      mintTxHash: fallback.mintTxHash || "",
      mintTxExplorerUrl: fallback.mintTxExplorerUrl || "",
      mintedTokenId: fallback.mintedTokenId || "",
      mintedAt: fallback.mintedAt || "",
      mintError: fallback.mintError || ""
    };
  }

  const mintedTokenId =
    typeof response?.mintedTokenId === "string"
      ? response.mintedTokenId
      : typeof response?.tokenId === "string"
        ? response.tokenId
        : fallback.mintedTokenId || "";

  return {
    mintStatus: normalizeRemoteMintStatus(response?.mintStatus),
    mintTxHash: typeof response?.mintTxHash === "string" ? response.mintTxHash : fallback.mintTxHash || "",
    mintTxExplorerUrl:
      typeof response?.mintTxExplorerUrl === "string"
        ? response.mintTxExplorerUrl
        : fallback.mintTxExplorerUrl || "",
    mintedTokenId,
    mintedAt: typeof response?.mintedAt === "string" ? response.mintedAt : fallback.mintedAt || "",
    mintError: typeof response?.mintError === "string" ? response.mintError : fallback.mintError || ""
  };
}

function buildClaimSyncResponse({
  claim,
  wallet,
  chainId,
  synced,
  mode,
  alreadyClaimed,
  retryable,
  milestoneId
}) {
  return {
    ok: true,
    claim,
    wallet,
    chainId,
    synced,
    mode,
    alreadyClaimed,
    retryable,
    milestoneId
  };
}

export function getRuntimeCapabilities() {
  const reward = getRewardConfig();
  return {
    walletMode: getWalletMode(),
    hasDailySeed: Boolean(getEndpoint("dailySeed")),
    hasSubmitScore: Boolean(getEndpoint("submitScore")),
    hasLeaderboard: Boolean(getEndpoint("leaderboard")),
    hasClaimReward: Boolean(getEndpoint("claimReward")),
    hasAuthNonce: Boolean(getEndpoint("authNonce")),
    hasAuthVerify: Boolean(getEndpoint("authVerify")),
    rewardContractAddress: reward.contractAddress,
    rewardContractExplorerUrl: reward.contractExplorerUrl,
    rewardMetadataBaseUri: reward.metadataBaseUri,
    rewardChainId: reward.chainId
  };
}

export async function shareScore(payload) {
  const text = payload.text || buildFallbackText(payload);
  if (navigator.share) {
    await navigator.share({
      title: "BaseBrick",
      text,
      url: payload.url || undefined
    });
    return { ok: true, method: "native" };
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return { ok: true, method: "clipboard" };
  }

  return { ok: false, method: "none", text };
}

export async function fetchDailyChallengeSeed() {
  const endpoint = getEndpoint("dailySeed");
  if (!endpoint) {
    return { ok: false, mode: "local", reason: "daily-endpoint-missing" };
  }

  try {
    const data = await fetchJson(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    const seed = typeof data?.seed === "string" ? data.seed.trim() : "";
    const target = Number.isFinite(data?.target) ? Math.max(0, Math.floor(data.target)) : null;
    if (!seed) {
      return { ok: false, mode: "local", reason: "invalid-seed-response" };
    }
    return { ok: true, mode: "remote", seed, target };
  } catch {
    return { ok: false, mode: "local", reason: "daily-fetch-failed" };
  }
}

export async function authenticateWithSiwe(options = {}) {
  const connected = await getConnectedWalletClient();
  if (!connected.ok) return { ok: false, reason: connected.reason || "wallet-not-connected" };
  let address = connected.address;
  let chainId = connected.chainId;
  const nonceEndpoint = getEndpoint("authNonce");
  const verifyEndpoint = getEndpoint("authVerify");
  let nonce = randomNonce();

  if (nonceEndpoint) {
    try {
      const nonceResponse = await fetchJson(nonceEndpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      const remoteNonce = typeof nonceResponse?.nonce === "string" ? nonceResponse.nonce.trim() : "";
      if (remoteNonce) nonce = remoteNonce;
    } catch {
      // Fallback to local nonce.
    }
  }

  let issuedAt = new Date().toISOString();
  const statement =
    typeof options.statement === "string" && options.statement.trim()
      ? options.statement.trim()
      : "Sign in to BaseBrick to verify competitive actions.";
  const domain = window.location.host;
  const uri = window.location.origin;

  let message = "";
  let signature = "";
  const baseSiwe = await signInWithEthereumClient({
    nonce,
    chainId,
    statement,
    issuedAt,
    domain,
    uri
  });
  if (baseSiwe.ok && baseSiwe.message && baseSiwe.signature) {
    message = baseSiwe.message;
    signature = baseSiwe.signature;
    if (baseSiwe.address) address = baseSiwe.address;
    if (baseSiwe.chainId) chainId = baseSiwe.chainId;
    if (baseSiwe.nonce) nonce = baseSiwe.nonce;
    if (baseSiwe.issuedAt) {
      const candidate = Date.parse(baseSiwe.issuedAt);
      if (Number.isFinite(candidate)) {
        issuedAt = baseSiwe.issuedAt;
      }
    }
  } else {
    message = buildSiweMessage({ address, chainId, statement, nonce, issuedAt });
    const signed = await signWalletMessage(message, address);
    if (!signed.ok || !signed.signature) return { ok: false, reason: "auth-signature-failed" };
    signature = signed.signature;
  }

  const session = {
    address,
    chainId,
    nonce,
    issuedAt,
    message,
    signature,
    verified: false,
    token: "",
    expiresAt: ""
  };

  if (!verifyEndpoint) {
    return { ok: true, mode: "siwe-local", session };
  }

  try {
    const verifyResponse = await fetchJson(verifyEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(session)
    });

    return {
      ok: true,
      mode: "siwe-verified",
      session: {
        ...session,
        verified: true,
        token: typeof verifyResponse?.token === "string" ? verifyResponse.token : "",
        expiresAt: typeof verifyResponse?.expiresAt === "string" ? verifyResponse.expiresAt : ""
      }
    };
  } catch (error) {
    return {
      ok: false,
      reason: getApiErrorCode(error, "auth-verify-failed"),
      message: getApiErrorMessage(error, "Authentication verification failed.")
    };
  }
}

export async function connectWallet() {
  return connectWalletClient();
}

export async function getConnectedWallet() {
  return getConnectedWalletClient();
}

export async function ensureBaseNetwork() {
  return ensureBaseNetworkClient();
}

async function tryResolveEnsByApi(address) {
  try {
    const response = await fetch(`https://api.ensideas.com/ens/resolve/${address}`);
    if (!response.ok) return "";
    const data = await response.json();
    const candidate = typeof data?.name === "string" ? data.name.trim() : "";
    if (!candidate) return "";
    if (candidate.endsWith(".eth") || candidate.endsWith(".base.eth")) return candidate;
    return "";
  } catch {
    return "";
  }
}

export async function resolveWalletName(address) {
  if (!address) return "";
  const ensName = await tryResolveEnsByApi(address);
  if (ensName) return ensName;
  return shortAddress(address);
}

export function watchWallet(onProfileChange) {
  return watchWalletClient(onProfileChange);
}

export async function submitScore(payload, options = {}) {
  const connected = await getConnectedWalletClient();
  if (!connected.ok) return { ok: false, reason: connected.reason || "wallet-not-connected" };
  const wallet = connected.address;
  const chainId = connected.chainId;
  const timestamp = new Date().toISOString();
  const message =
    `BaseBrick Score Submission\n` +
    `player: ${payload.playerName}\n` +
    `wallet: ${wallet}\n` +
    `score: ${payload.score}\n` +
    `stage: ${payload.stage}\n` +
    `combo: ${payload.maxCombo}\n` +
    `dailySeed: ${payload.dailySeed}\n` +
    `timestamp: ${timestamp}`;

  const signed = await signWalletMessage(message, wallet);
  if (!signed.ok || !signed.signature) return { ok: false, reason: "signature-failed" };
  const signature = signed.signature;

  const signedRun = {
    score: payload.score,
    stage: payload.stage,
    maxCombo: payload.maxCombo,
    playerName: payload.playerName,
    wallet,
    signature,
    chainId,
    dailySeed: payload.dailySeed,
    when: timestamp
  };

  addSubmittedRun(signedRun);

  const endpoint = getEndpoint("submitScore");
  if (!endpoint) {
    return { ok: true, signature, chainId, wallet, mode: "signed-local", synced: false };
  }

  try {
    const auth = options?.auth || null;
    const remote = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...buildAuthHeaders(auth)
      },
      body: JSON.stringify({
        ...signedRun,
        auth
      })
    });
    return {
      ok: true,
      signature,
      chainId,
      wallet,
      mode: "verified-remote",
      synced: true,
      submissionId: remote?.submissionId || ""
    };
  } catch (error) {
    if (isClientApiError(error)) {
      return {
        ok: false,
        reason: getApiErrorCode(error, "submit-rejected"),
        message: getApiErrorMessage(error, "Score submission rejected by backend."),
        status: error.status
      };
    }
    return { ok: true, signature, chainId, wallet, mode: "signed-local", synced: false };
  }
}

export async function fetchLeaderboard() {
  const endpoint = getEndpoint("leaderboard");
  if (endpoint) {
    try {
      const remote = await fetchJson(endpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      const entries = normalizeEntries(remote)
        .filter((entry) => typeof entry?.score === "number")
        .sort((a, b) => b.score - a.score || b.stage - a.stage)
        .slice(0, 20);
      if (entries.length) {
        return { ok: true, mode: "verified-remote", entries };
      }
    } catch {
      // Fall through to local mode.
    }
  }

  const submitted = getSubmittedRuns().sort((a, b) => b.score - a.score || b.stage - a.stage).slice(0, 20);
  return { ok: true, mode: "signed-local", entries: submitted };
}

export async function claimMilestoneReward(payload, options = {}) {
  const connected = await getConnectedWalletClient();
  if (!connected.ok) return { ok: false, reason: connected.reason || "wallet-not-connected" };
  const wallet = connected.address;
  const chainId = connected.chainId;
  const allowLegacyResign = options?.allowLegacyResign !== false;
  if (chainId !== BASE_CHAIN_ID) return { ok: false, reason: "wrong-network", chainId };

  const milestone = getMilestoneShape(payload);
  if (!milestone.milestoneId || milestone.milestoneStage < 1) {
    return { ok: false, reason: "milestone-invalid" };
  }

  const endpoint = getEndpoint("claimReward");
  const auth = options?.auth || null;
  const existing = getMilestoneClaim(wallet, milestone.milestoneId);
  const hasExistingClaim = Boolean(existing?.tokenId && existing?.signature);
  if (hasExistingClaim) {
    if (existing.status === CLAIM_STATUS.synced && existing.mintStatus === "minted") {
      return buildClaimSyncResponse({
        claim: existing,
        wallet,
        chainId,
        synced: true,
        mode: "verified-remote",
        alreadyClaimed: true,
        retryable: false,
        milestoneId: milestone.milestoneId
      });
    }

    if (!endpoint) {
      return buildClaimSyncResponse({
        claim: existing,
        wallet,
        chainId,
        synced: false,
        mode: "signed-local",
        alreadyClaimed: true,
        retryable: false,
        milestoneId: milestone.milestoneId
      });
    }

    const retryAttempt = setMilestoneClaim(wallet, milestone.milestoneId, {
      ...existing,
      milestoneStage: existing.milestoneStage || milestone.milestoneStage,
      milestoneLabel: existing.milestoneLabel || milestone.milestoneLabel,
      status: CLAIM_STATUS.pending,
      syncAttempts: (existing.syncAttempts || 0) + 1,
      lastSyncError: ""
    });

    try {
      const remote = await fetchJson(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...buildAuthHeaders(auth)
        },
        body: JSON.stringify(
          buildRewardPayload(
            {
              wallet,
              chainId,
              tokenId: retryAttempt.tokenId,
              signature: retryAttempt.signature,
              when: retryAttempt.when,
              playerName: retryAttempt.playerName || payload.playerName,
              score: retryAttempt.score ?? payload.score,
              stage: retryAttempt.stage ?? payload.stage,
              milestoneId: retryAttempt.milestoneId,
              milestoneStage: retryAttempt.milestoneStage,
              milestoneLabel: retryAttempt.milestoneLabel || milestone.milestoneLabel
            },
            auth
          )
        )
      });
      const mintUpdate = getMintUpdateFromResponse(remote, retryAttempt);
      const syncedClaim = setMilestoneClaim(wallet, milestone.milestoneId, {
        ...retryAttempt,
        status: CLAIM_STATUS.synced,
        ...mintUpdate,
        lastSyncAt: new Date().toISOString(),
        lastSyncError: ""
      });
      return buildClaimSyncResponse({
        claim: syncedClaim,
        wallet,
        chainId,
        synced: true,
        mode: "verified-remote",
        alreadyClaimed: true,
        retryable: false,
        milestoneId: milestone.milestoneId
      });
    } catch (error) {
      const errorCode = getApiErrorCode(error, "sync-failed");
      const errorMessage = getApiErrorMessage(error, "Claim sync failed.");
      if (allowLegacyResign && (errorCode === "signature-invalid" || errorCode === "timestamp-invalid")) {
        setMilestoneClaim(wallet, milestone.milestoneId, {
          ...retryAttempt,
          tokenId: "",
          signature: "",
          status: CLAIM_STATUS.failedSync,
          mintStatus: retryAttempt.mintStatus || "pending",
          lastSyncAt: new Date().toISOString(),
          lastSyncError: "stale-local-claim"
        });
        return claimMilestoneReward(payload, { ...options, allowLegacyResign: false });
      }

      const failedClaim = setMilestoneClaim(wallet, milestone.milestoneId, {
        ...retryAttempt,
        status: CLAIM_STATUS.failedSync,
        mintStatus: retryAttempt.mintStatus || "pending",
        lastSyncAt: new Date().toISOString(),
        lastSyncError: errorCode
      });
      if (isClientApiError(error)) {
        return {
          ok: false,
          reason: errorCode,
          message: errorMessage,
          status: error.status,
          claim: failedClaim,
          wallet,
          chainId,
          synced: false,
          mode: "signed-local",
          alreadyClaimed: true,
          retryable: true,
          milestoneId: milestone.milestoneId
        };
      }
      return buildClaimSyncResponse({
        claim: failedClaim,
        wallet,
        chainId,
        synced: false,
        mode: "signed-local",
        alreadyClaimed: true,
        retryable: true,
        milestoneId: milestone.milestoneId
      });
    }
  }

  const timestamp = new Date().toISOString();
  const tokenId = `${Date.now()}`.slice(-10);
  const message =
    `BaseBrick Milestone Claim\n` +
    `wallet: ${wallet}\n` +
    `player: ${payload.playerName}\n` +
    `score: ${payload.score}\n` +
    `stage: ${payload.stage}\n` +
    `milestoneId: ${milestone.milestoneId}\n` +
    `milestoneStage: ${milestone.milestoneStage}\n` +
    `milestoneLabel: ${milestone.milestoneLabel}\n` +
    `tokenId: ${tokenId}\n` +
    `timestamp: ${timestamp}`;

  const signed = await signWalletMessage(message, wallet);
  if (!signed.ok || !signed.signature) return { ok: false, reason: "signature-failed" };
  const signature = signed.signature;
  const initialStatus = endpoint ? CLAIM_STATUS.pending : CLAIM_STATUS.localOnly;
  const claim = setMilestoneClaim(wallet, milestone.milestoneId, {
    tokenId,
    signature,
    when: timestamp,
    playerName: payload.playerName,
    chainId,
    score: payload.score,
    stage: payload.stage,
    milestoneStage: milestone.milestoneStage,
    milestoneLabel: milestone.milestoneLabel,
    status: initialStatus,
    mintStatus: endpoint ? "pending" : "unavailable",
    mintTxHash: "",
    mintedTokenId: "",
    mintedAt: "",
    syncAttempts: endpoint ? 1 : 0,
    lastSyncAt: "",
    lastSyncError: ""
  });

  if (!endpoint) {
    return buildClaimSyncResponse({
      claim,
      wallet,
      chainId,
      synced: false,
      mode: "signed-local",
      alreadyClaimed: false,
      retryable: false,
      milestoneId: milestone.milestoneId
    });
  }

  try {
    const remote = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...buildAuthHeaders(auth)
      },
      body: JSON.stringify(
        buildRewardPayload(
          {
            wallet,
            playerName: payload.playerName,
            score: payload.score,
            stage: payload.stage,
            chainId,
            tokenId,
            signature,
            when: timestamp,
            milestoneId: milestone.milestoneId,
            milestoneStage: milestone.milestoneStage,
            milestoneLabel: milestone.milestoneLabel
          },
          auth
        )
      )
    });
    const mintUpdate = getMintUpdateFromResponse(remote, claim);
    const syncedClaim = setMilestoneClaim(wallet, milestone.milestoneId, {
      ...claim,
      status: CLAIM_STATUS.synced,
      ...mintUpdate,
      lastSyncAt: new Date().toISOString(),
      lastSyncError: ""
    });
    return buildClaimSyncResponse({
      claim: syncedClaim,
      wallet,
      chainId,
      synced: true,
      mode: "verified-remote",
      alreadyClaimed: false,
      retryable: false,
      milestoneId: milestone.milestoneId
    });
  } catch (error) {
    const errorCode = getApiErrorCode(error, "sync-failed");
    const errorMessage = getApiErrorMessage(error, "Claim sync failed.");
    const failedClaim = setMilestoneClaim(wallet, milestone.milestoneId, {
      ...claim,
      status: CLAIM_STATUS.failedSync,
      mintStatus: claim.mintStatus || "pending",
      lastSyncAt: new Date().toISOString(),
      lastSyncError: errorCode
    });
    if (isClientApiError(error)) {
      return {
        ok: false,
        reason: errorCode,
        message: errorMessage,
        status: error.status,
        claim: failedClaim,
        wallet,
        chainId,
        synced: false,
        mode: "signed-local",
        alreadyClaimed: false,
        retryable: true,
        milestoneId: milestone.milestoneId
      };
    }
    return buildClaimSyncResponse({
      claim: failedClaim,
      wallet,
      chainId,
      synced: false,
      mode: "signed-local",
      alreadyClaimed: false,
      retryable: true,
      milestoneId: milestone.milestoneId
    });
  }
}

// Backward-compatible wrapper.
export async function claimOgBrickBadge(payload, options = {}) {
  return claimMilestoneReward(
    {
      ...payload,
      milestoneId: "omega",
      milestoneStage: 20,
      milestoneLabel: "Omega BaseBrick"
    },
    options
  );
}

export async function promptSaveInstall() {
  if (!installPromptEvent) return { ok: false, reason: "prompt-unavailable" };
  installPromptEvent.prompt();
  const choice = await installPromptEvent.userChoice;
  installPromptEvent = null;
  return { ok: true, choice };
}
