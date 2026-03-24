import { STORAGE_KEYS } from "./config.js";

const runLimit = 20;
const CLAIM_STATUS_VALUES = ["local-pending", "local-only", "synced", "failed-sync"];
const MINT_STATUS_VALUES = ["not-started", "pending", "minted", "failed", "unavailable"];

export const CLAIM_STATUS = {
  pending: "local-pending",
  localOnly: "local-only",
  synced: "synced",
  failedSync: "failed-sync"
};

export const MINT_STATUS = {
  notStarted: "not-started",
  pending: "pending",
  minted: "minted",
  failed: "failed",
  unavailable: "unavailable"
};

// Backward-compatible aliases for existing imports.
export const OG_CLAIM_STATUS = CLAIM_STATUS;
export const OG_MINT_STATUS = MINT_STATUS;

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeClaimStatus(rawStatus) {
  return CLAIM_STATUS_VALUES.includes(rawStatus) ? rawStatus : CLAIM_STATUS.localOnly;
}

function normalizeMintStatus(rawStatus) {
  return MINT_STATUS_VALUES.includes(rawStatus) ? rawStatus : MINT_STATUS.notStarted;
}

function normalizeMilestoneId(rawId) {
  if (typeof rawId !== "string") return "";
  return rawId.trim().toLowerCase().slice(0, 32);
}

function normalizeClaimRecord(wallet, milestoneId, claimData = {}) {
  const now = new Date().toISOString();
  const attemptsRaw = Number(claimData?.syncAttempts);
  const scoreRaw = Number(claimData?.score);
  const stageRaw = Number(claimData?.stage);
  const milestoneStageRaw = Number(claimData?.milestoneStage);
  return {
    wallet: typeof claimData?.wallet === "string" && claimData.wallet ? claimData.wallet : wallet,
    milestoneId,
    milestoneStage: Number.isFinite(milestoneStageRaw) ? Math.max(1, Math.floor(milestoneStageRaw)) : 1,
    milestoneLabel: typeof claimData?.milestoneLabel === "string" ? claimData.milestoneLabel : "",
    tokenId: String(claimData?.tokenId || ""),
    signature: String(claimData?.signature || ""),
    when: typeof claimData?.when === "string" && claimData.when ? claimData.when : now,
    playerName: typeof claimData?.playerName === "string" ? claimData.playerName : "",
    chainId: typeof claimData?.chainId === "string" ? claimData.chainId : "",
    score: Number.isFinite(scoreRaw) ? Math.max(0, Math.floor(scoreRaw)) : 0,
    stage: Number.isFinite(stageRaw) ? Math.max(1, Math.floor(stageRaw)) : 1,
    status: normalizeClaimStatus(typeof claimData?.status === "string" ? claimData.status : ""),
    mintStatus: normalizeMintStatus(typeof claimData?.mintStatus === "string" ? claimData.mintStatus : ""),
    mintTxHash: typeof claimData?.mintTxHash === "string" ? claimData.mintTxHash : "",
    mintTxExplorerUrl:
      typeof claimData?.mintTxExplorerUrl === "string" ? claimData.mintTxExplorerUrl : "",
    mintedTokenId: typeof claimData?.mintedTokenId === "string" ? claimData.mintedTokenId : "",
    mintedAt: typeof claimData?.mintedAt === "string" ? claimData.mintedAt : "",
    mintError: typeof claimData?.mintError === "string" ? claimData.mintError : "",
    syncAttempts: Number.isFinite(attemptsRaw) ? Math.max(0, Math.floor(attemptsRaw)) : 0,
    lastSyncAt: typeof claimData?.lastSyncAt === "string" ? claimData.lastSyncAt : "",
    lastSyncError: typeof claimData?.lastSyncError === "string" ? claimData.lastSyncError : ""
  };
}

export function getBestScore() {
  const raw = Number(window.localStorage.getItem(STORAGE_KEYS.best) || "0");
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

export function setBestScore(score) {
  window.localStorage.setItem(STORAGE_KEYS.best, String(Math.max(0, Math.floor(score))));
}

export function getTopRuns() {
  return parseJson(window.localStorage.getItem(STORAGE_KEYS.runs), []).filter(
    (run) => typeof run?.score === "number"
  );
}

export function addRun(run) {
  const safeRun = {
    score: Math.max(0, Math.floor(run.score || 0)),
    stage: Math.max(1, Math.floor(run.stage || 1)),
    maxCombo: Math.max(1, Math.floor(run.maxCombo || 1)),
    playerName: typeof run.playerName === "string" ? run.playerName : "Anonymous",
    wallet: typeof run.wallet === "string" ? run.wallet : "",
    when: typeof run.when === "string" ? run.when : new Date().toISOString()
  };

  const next = [...getTopRuns(), safeRun]
    .sort((a, b) => b.score - a.score || b.stage - a.stage)
    .slice(0, runLimit);

  window.localStorage.setItem(STORAGE_KEYS.runs, JSON.stringify(next));
}

export function getSubmittedRuns() {
  return parseJson(window.localStorage.getItem(STORAGE_KEYS.submittedRuns), []).filter(
    (run) => typeof run?.score === "number" && typeof run?.signature === "string"
  );
}

export function addSubmittedRun(run) {
  const safeRun = {
    score: Math.max(0, Math.floor(run.score || 0)),
    stage: Math.max(1, Math.floor(run.stage || 1)),
    maxCombo: Math.max(1, Math.floor(run.maxCombo || 1)),
    playerName: typeof run.playerName === "string" ? run.playerName : "Anonymous",
    wallet: typeof run.wallet === "string" ? run.wallet : "",
    signature: run.signature,
    chainId: typeof run.chainId === "string" ? run.chainId : "",
    dailySeed: typeof run.dailySeed === "string" ? run.dailySeed : "",
    when: typeof run.when === "string" ? run.when : new Date().toISOString()
  };

  const next = [...getSubmittedRuns(), safeRun]
    .sort((a, b) => b.score - a.score || b.stage - a.stage)
    .slice(0, runLimit);

  window.localStorage.setItem(STORAGE_KEYS.submittedRuns, JSON.stringify(next));
}

export function getProfile() {
  return parseJson(window.localStorage.getItem(STORAGE_KEYS.profile), {
    address: "",
    chainId: "",
    resolvedName: "",
    customName: ""
  });
}

export function setProfile(profile) {
  const safe = {
    address: typeof profile?.address === "string" ? profile.address : "",
    chainId: typeof profile?.chainId === "string" ? profile.chainId : "",
    resolvedName: typeof profile?.resolvedName === "string" ? profile.resolvedName : "",
    customName: typeof profile?.customName === "string" ? profile.customName : ""
  };
  window.localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(safe));
  return safe;
}

export function getSoundMuted() {
  return window.localStorage.getItem(STORAGE_KEYS.soundMuted) === "1";
}

export function setSoundMuted(muted) {
  window.localStorage.setItem(STORAGE_KEYS.soundMuted, muted ? "1" : "0");
}

function getLegacyOgClaims() {
  return parseJson(window.localStorage.getItem(STORAGE_KEYS.ogBrickClaims), {});
}

function getMilestoneClaimsRaw() {
  return parseJson(window.localStorage.getItem(STORAGE_KEYS.milestoneClaims), {});
}

function saveMilestoneClaimsRaw(claims) {
  window.localStorage.setItem(STORAGE_KEYS.milestoneClaims, JSON.stringify(claims));
}

function normalizeWalletClaimMap(wallet, rawMap = {}) {
  const result = {};
  Object.entries(rawMap || {}).forEach(([id, claim]) => {
    const milestoneId = normalizeMilestoneId(id);
    if (!milestoneId) return;
    result[milestoneId] = normalizeClaimRecord(wallet, milestoneId, claim);
  });
  return result;
}

function migrateLegacyClaimIfNeeded(wallet, claimsByWallet) {
  const walletKey = wallet.toLowerCase();
  const existingClaims = normalizeWalletClaimMap(wallet, claimsByWallet[walletKey]);
  if (Object.keys(existingClaims).length > 0) return existingClaims;

  const legacyClaims = getLegacyOgClaims();
  const legacy = legacyClaims?.[walletKey];
  if (!legacy) return existingClaims;

  const migrated = normalizeClaimRecord(wallet, "omega", {
    ...legacy,
    milestoneId: "omega",
    milestoneStage: 20,
    milestoneLabel: "Omega BaseBrick"
  });
  const nextClaims = { ...existingClaims, omega: migrated };
  claimsByWallet[walletKey] = nextClaims;
  saveMilestoneClaimsRaw(claimsByWallet);
  return nextClaims;
}

export function getMilestoneClaims() {
  return getMilestoneClaimsRaw();
}

export function getMilestoneClaimsByWallet(wallet = "") {
  if (!wallet) return {};
  const claimsByWallet = getMilestoneClaimsRaw();
  const walletKey = wallet.toLowerCase();
  const normalized = normalizeWalletClaimMap(wallet, claimsByWallet[walletKey]);
  claimsByWallet[walletKey] = normalized;
  saveMilestoneClaimsRaw(claimsByWallet);
  return migrateLegacyClaimIfNeeded(wallet, claimsByWallet);
}

export function getMilestoneClaim(wallet = "", milestoneId = "") {
  const cleanId = normalizeMilestoneId(milestoneId);
  if (!wallet || !cleanId) return null;
  const walletClaims = getMilestoneClaimsByWallet(wallet);
  return walletClaims[cleanId] || null;
}

export function setMilestoneClaim(wallet, milestoneId, claimData = {}) {
  const cleanId = normalizeMilestoneId(milestoneId);
  if (!wallet || !cleanId) return null;
  const claimsByWallet = getMilestoneClaimsRaw();
  const walletKey = wallet.toLowerCase();
  const walletClaims = normalizeWalletClaimMap(wallet, claimsByWallet[walletKey]);
  const previous = walletClaims[cleanId] || null;
  const merged = { ...previous, ...claimData, wallet, milestoneId: cleanId };
  const safe = normalizeClaimRecord(wallet, cleanId, merged);
  walletClaims[cleanId] = safe;
  claimsByWallet[walletKey] = walletClaims;
  saveMilestoneClaimsRaw(claimsByWallet);
  return safe;
}

// Legacy wrappers maintained for backward compatibility.
export function getOgBrickClaims() {
  return getMilestoneClaims();
}

export function getOgBrickClaim(wallet = "") {
  return getMilestoneClaim(wallet, "omega");
}

export function setOgBrickClaim(wallet, claimData) {
  return setMilestoneClaim(wallet, "omega", {
    ...claimData,
    milestoneId: "omega",
    milestoneStage: Number(claimData?.milestoneStage || 20),
    milestoneLabel: claimData?.milestoneLabel || "Omega BaseBrick"
  });
}

export function getDailyMap() {
  return parseJson(window.localStorage.getItem(STORAGE_KEYS.daily), {});
}

export function getDailyBest(seed) {
  const dailyMap = getDailyMap();
  const value = Number(dailyMap?.[seed] || 0);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function setDailyBest(seed, score) {
  const dailyMap = getDailyMap();
  const nextScore = Math.max(0, Math.floor(score));
  const prev = Number(dailyMap?.[seed] || 0);
  if (nextScore <= prev) return prev;
  dailyMap[seed] = nextScore;
  window.localStorage.setItem(STORAGE_KEYS.daily, JSON.stringify(dailyMap));
  return nextScore;
}

export function getCampaignProgress() {
  const parsed = parseJson(window.localStorage.getItem(STORAGE_KEYS.campaignProgress), {});
  const unlockedRaw = Number(parsed?.unlockedStage);
  const clearedRaw = Number(parsed?.bestClearedStage);
  const lastPlayedRaw = Number(parsed?.lastPlayedStage);

  return {
    unlockedStage: Number.isFinite(unlockedRaw) ? Math.min(20, Math.max(1, Math.floor(unlockedRaw))) : 1,
    bestClearedStage: Number.isFinite(clearedRaw) ? Math.min(20, Math.max(0, Math.floor(clearedRaw))) : 0,
    lastPlayedStage: Number.isFinite(lastPlayedRaw) ? Math.min(20, Math.max(1, Math.floor(lastPlayedRaw))) : 1,
    updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : ""
  };
}

export function setCampaignProgress(progress = {}) {
  const current = getCampaignProgress();
  const unlockedRaw = Number(progress?.unlockedStage);
  const clearedRaw = Number(progress?.bestClearedStage);
  const lastPlayedRaw = Number(progress?.lastPlayedStage);

  const safe = {
    unlockedStage: Number.isFinite(unlockedRaw) ? Math.min(20, Math.max(1, Math.floor(unlockedRaw))) : current.unlockedStage,
    bestClearedStage: Number.isFinite(clearedRaw)
      ? Math.min(20, Math.max(0, Math.floor(clearedRaw)))
      : current.bestClearedStage,
    lastPlayedStage: Number.isFinite(lastPlayedRaw)
      ? Math.min(20, Math.max(1, Math.floor(lastPlayedRaw)))
      : current.lastPlayedStage,
    updatedAt: typeof progress?.updatedAt === "string" && progress.updatedAt ? progress.updatedAt : new Date().toISOString()
  };
  window.localStorage.setItem(STORAGE_KEYS.campaignProgress, JSON.stringify(safe));
  return safe;
}
