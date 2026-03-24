import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { loadDotEnv } from "./env.mjs";

function intEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name, fallback = false) {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

export function createConfig() {
  loadDotEnv();
  const cwd = process.cwd();
  const defaultSecret = crypto.randomBytes(32).toString("hex");

  return {
    env: process.env.NODE_ENV || "development",
    port: intEnv("PORT", 8787),
    corsOrigin: process.env.CORS_ORIGIN || "*",
    network: process.env.NETWORK || "base-mainnet",
    baseChainId: process.env.BASE_CHAIN_ID || "0x2105",
    authNonceTtlSec: intEnv("AUTH_NONCE_TTL_SEC", 300),
    authSessionTtlSec: intEnv("AUTH_SESSION_TTL_SEC", 3600),
    authTokenSecret: process.env.AUTH_TOKEN_SECRET || defaultSecret,
    requireVerifiedScoreForClaim: boolEnv("REQUIRE_VERIFIED_SCORE_FOR_CLAIM", true),
    maxScore: intEnv("MAX_SCORE", 250000),
    maxStage: intEnv("MAX_STAGE", 20),
    maxCombo: intEnv("MAX_COMBO", 999),
    maxSubmitAgeSec: intEnv("MAX_SUBMIT_AGE_SEC", 1800),
    maxIssuedAtSkewSec: intEnv("MAX_ISSUED_AT_SKEW_SEC", 900),
    scorePerStageSoftCap: intEnv("SCORE_PER_STAGE_SOFT_CAP", 16000),
    auditLogPath: process.env.AUDIT_LOG_PATH || path.join(cwd, "logs", "audit.log"),
    stateFilePath: process.env.STATE_FILE_PATH || path.join(cwd, "data", "state.json"),
    rateLimitWindowSec: intEnv("RATE_LIMIT_WINDOW_SEC", 60),
    rateLimitAuthPerIp: intEnv("RATE_LIMIT_AUTH_PER_IP", 20),
    rateLimitSubmitPerIp: intEnv("RATE_LIMIT_SUBMIT_PER_IP", 40),
    rateLimitClaimPerIp: intEnv("RATE_LIMIT_CLAIM_PER_IP", 30),
    mintMode: (process.env.MINT_MODE || "pending").toLowerCase(),
    mintExplorerBase: process.env.MINT_EXPLORER_BASE || "https://basescan.org/tx/",
    builderCode: process.env.BUILDER_CODE || "",
    baseRpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    rewardSignerPrivateKey: process.env.REWARD_SIGNER_PRIVATE_KEY || "",
    mintConfirmations: intEnv("MINT_CONFIRMATIONS", 1),
    rewardContractAddress: process.env.REWARD_CONTRACT_ADDRESS || "",
    rewardContractChainId: process.env.REWARD_CONTRACT_CHAIN_ID || process.env.BASE_CHAIN_ID || "0x2105",
    rewardMetadataBaseUri: process.env.REWARD_METADATA_BASE_URI || "",
    rewardContractExplorer:
      process.env.REWARD_CONTRACT_EXPLORER || "https://basescan.org/address/"
  };
}
