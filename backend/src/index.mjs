import crypto from "node:crypto";
import http from "node:http";
import process from "node:process";
import { URL } from "node:url";
import { createPublicClient, createWalletClient, http as viemHttp, isAddress, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createAuditLogger } from "./audit-log.mjs";
import { createConfig } from "./config.mjs";
import { createRateLimiter } from "./rate-limit.mjs";
import { createStateStore } from "./state-store.mjs";
import { createToken, verifyToken } from "./token.mjs";

const config = createConfig();
const stateStore = createStateStore(config.stateFilePath);
const audit = createAuditLogger(config.auditLogPath);
const rateLimiter = createRateLimiter({
  windowSec: config.rateLimitWindowSec,
  limitByKey: config.rateLimitSubmitPerIp
});

let signatureVerifyClient = null;
try {
  signatureVerifyClient = createPublicClient({
    chain: base,
    transport: viemHttp(config.baseRpcUrl || "https://mainnet.base.org")
  });
} catch {
  signatureVerifyClient = null;
}

const REWARD_CONTRACT_ABI = [
  {
    type: "function",
    name: "mintMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "milestone", type: "uint8" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "hasClaimed",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" }
    ],
    outputs: [{ name: "", type: "bool" }]
  }
];

function nowIso() {
  return new Date().toISOString();
}

function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

function normalizeChainId(chainId) {
  if (typeof chainId !== "string" || !chainId.trim()) return "";
  const raw = chainId.trim().toLowerCase();
  if (raw.startsWith("0x")) {
    const parsed = Number.parseInt(raw, 16);
    if (!Number.isFinite(parsed) || parsed <= 0) return "";
    return `0x${parsed.toString(16)}`;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return `0x${parsed.toString(16)}`;
}

function chainIdToNumber(chainId) {
  const hex = normalizeChainId(chainId);
  if (!hex) return 0;
  return Number.parseInt(hex, 16);
}

function hash(text) {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) {
    value = (value << 5) - value + text.charCodeAt(i);
    value |= 0;
  }
  return Math.abs(value);
}

function daySeed(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function dailyTarget(seed) {
  return 900 + (hash(seed) % 1800);
}

function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return request.socket.remoteAddress || "0.0.0.0";
}

function getAuthToken(request, body = {}) {
  const authHeader = request.headers.authorization || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const bodyToken = typeof body?.auth?.token === "string" ? body.auth.token.trim() : "";
  return bodyToken || "";
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": config.corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  };
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(),
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, code, message, detail = "") {
  sendJson(response, statusCode, {
    error: {
      code,
      message,
      ...(detail ? { detail } : {})
    }
  });
}

function sendRateLimitHeaders(response, limitResult) {
  return {
    "X-RateLimit-Remaining": String(Math.max(0, Number(limitResult?.remaining || 0))),
    "X-RateLimit-Reset": String(Math.floor(Number(limitResult?.resetAt || Date.now()) / 1000))
  };
}

function checkRateLimit(request, action, limit) {
  const ip = getClientIp(request);
  const key = `${action}:${ip}`;
  const limitResult = rateLimiter.allow(key, limit);
  return { ...limitResult, ip };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > 512_000) {
        reject(new Error("body-too-large"));
      }
    });
    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid-json"));
      }
    });
    request.on("error", reject);
  });
}

function isReasonableIsoTimestamp(value) {
  if (typeof value !== "string" || !value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function parseMessageField(message, fieldName) {
  if (typeof message !== "string" || !message) return "";
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped}:\\s*(.+)$`, "mi");
  const match = message.match(regex);
  return match ? match[1].trim() : "";
}

function buildSubmissionMessage(payload) {
  return (
    `BaseBrick Score Submission\n` +
    `player: ${payload.playerName}\n` +
    `wallet: ${payload.wallet}\n` +
    `score: ${payload.score}\n` +
    `stage: ${payload.stage}\n` +
    `combo: ${payload.maxCombo}\n` +
    `dailySeed: ${payload.dailySeed}\n` +
    `timestamp: ${payload.when}`
  );
}

const MILESTONE_STAGE_MAP = {
  alpha: 5,
  beta: 10,
  gamma: 15,
  omega: 20
};

const MILESTONE_TOKEN_MAP = {
  alpha: 1,
  beta: 2,
  gamma: 3,
  omega: 4
};

function normalizePrivateKey(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function normalizeBuilderCodeDataSuffix(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("0x")
    ? trimmed
    : `0x${Buffer.from(trimmed, "utf8").toString("hex")}`;
}

function createRewardMinter() {
  const liveMode = config.mintMode === "live";
  const contractAddress = String(config.rewardContractAddress || "").trim();
  const signerKey = normalizePrivateKey(config.rewardSignerPrivateKey);
  const dataSuffix = normalizeBuilderCodeDataSuffix(config.builderCode);
  if (!liveMode) return { enabled: false, reason: "mint-mode-not-live" };
  if (!contractAddress || !isAddress(contractAddress)) {
    return { enabled: false, reason: "contract-address-missing" };
  }
  if (!signerKey) return { enabled: false, reason: "signer-key-missing" };

  try {
    const account = privateKeyToAccount(signerKey);
    const transport = viemHttp(config.baseRpcUrl);
    const publicClient = createPublicClient({ chain: base, transport });
    const walletClient = createWalletClient({ account, chain: base, transport });

    return {
      enabled: true,
      reason: "ready",
      contractAddress,
      account,
      publicClient,
      walletClient,
      async mintMilestone(wallet, milestoneId) {
        const tokenId = Number(MILESTONE_TOKEN_MAP[milestoneId] || 0);
        if (!tokenId || !isAddress(wallet)) {
          return {
            mintStatus: "failed",
            mintTxHash: "",
            mintedTokenId: tokenId ? String(tokenId) : "",
            mintedAt: "",
            mintError: "mint-input-invalid"
          };
        }

        try {
          const alreadyClaimed = await publicClient.readContract({
            address: contractAddress,
            abi: REWARD_CONTRACT_ABI,
            functionName: "hasClaimed",
            args: [BigInt(tokenId), wallet]
          });

          if (alreadyClaimed) {
            return {
              mintStatus: "minted",
              mintTxHash: "",
              mintedTokenId: String(tokenId),
              mintedAt: ""
            };
          }

          const txHash = await walletClient.writeContract({
            account,
            chain: base,
            address: contractAddress,
            abi: REWARD_CONTRACT_ABI,
            functionName: "mintMilestone",
            args: [wallet, tokenId],
            ...(dataSuffix ? { dataSuffix } : {})
          });

          const receipt = await publicClient.waitForTransactionReceipt({
            hash: txHash,
            confirmations: Math.max(1, Number(config.mintConfirmations || 1))
          });

          if (receipt.status !== "success") {
            return {
              mintStatus: "failed",
              mintTxHash: txHash,
              mintedTokenId: String(tokenId),
              mintedAt: "",
              mintError: "tx-reverted"
            };
          }

          return {
            mintStatus: "minted",
            mintTxHash: txHash,
            mintedTokenId: String(tokenId),
            mintedAt: nowIso()
          };
        } catch (error) {
          return {
            mintStatus: "failed",
            mintTxHash: "",
            mintedTokenId: String(tokenId),
            mintedAt: "",
            mintError: String(error?.message || error || "mint-failed").slice(0, 200)
          };
        }
      }
    };
  } catch (error) {
    return { enabled: false, reason: String(error?.message || error || "mint-setup-failed") };
  }
}

const rewardMinter = createRewardMinter();

function normalizeMilestoneId(value) {
  if (typeof value !== "string") return "";
  const key = value.trim().toLowerCase();
  return key in MILESTONE_STAGE_MAP ? key : "";
}

function buildClaimMessage(payload) {
  return (
    `BaseBrick Milestone Claim\n` +
    `wallet: ${payload.wallet}\n` +
    `player: ${payload.playerName}\n` +
    `score: ${payload.score}\n` +
    `stage: ${payload.stage}\n` +
    `milestoneId: ${payload.milestoneId}\n` +
    `milestoneStage: ${payload.milestoneStage}\n` +
    `milestoneLabel: ${payload.milestoneLabel}\n` +
    `tokenId: ${payload.tokenId}\n` +
    `timestamp: ${payload.when}`
  );
}

async function verifyWalletMessage({ wallet, message, signature }) {
  if (!isAddress(wallet)) return false;
  if (typeof message !== "string" || !message) return false;
  if (typeof signature !== "string" || !signature) return false;

  if (signatureVerifyClient) {
    try {
      const valid = await signatureVerifyClient.verifyMessage({
        address: wallet,
        message,
        signature
      });
      if (valid) return true;
    } catch {
      // Fall through to local verification.
    }
  }

  try {
    const valid = await verifyMessage({
      address: wallet,
      message,
      signature
    });
    return Boolean(valid);
  } catch {
    return false;
  }
}

function requireAuth(request, body, nowMs) {
  const token = getAuthToken(request, body);
  if (!token) return { ok: false, code: "auth-required", message: "Auth session required." };

  const parsed = verifyToken(token, config.authTokenSecret);
  if (!parsed.ok) {
    return { ok: false, code: "auth-invalid", message: "Invalid auth token." };
  }
  const payload = parsed.payload || {};
  if (Number.isFinite(payload.exp) && nowMs >= payload.exp * 1000) {
    return { ok: false, code: "auth-expired", message: "Auth token expired." };
  }

  const session = stateStore.getSession(token, nowMs);
  if (!session) {
    return { ok: false, code: "auth-invalid", message: "Auth session not found." };
  }

  return { ok: true, session, tokenPayload: payload };
}

function validateAuthVerifyPayload(body, nowMs) {
  if (!isAddress(body?.address || "")) return "auth-address-invalid";
  if (typeof body?.signature !== "string" || body.signature.length < 10) return "auth-signature-invalid";
  if (typeof body?.nonce !== "string" || !body.nonce.trim()) return "auth-nonce-missing";
  if (!isReasonableIsoTimestamp(body?.issuedAt)) return "auth-issued-at-invalid";
  if (typeof body?.message !== "string" || !body.message.trim()) return "auth-message-missing";

  const issuedAtMs = Date.parse(body.issuedAt);
  if (nowMs > issuedAtMs + config.maxIssuedAtSkewSec * 1000) return "auth-issued-at-stale";
  if (issuedAtMs > nowMs + config.maxIssuedAtSkewSec * 1000) return "auth-issued-at-future";

  const messageAddress = body.message.includes(`\n${body.address}\n`) || body.message.endsWith(`\n${body.address}`);
  if (!messageAddress) return "auth-message-address-mismatch";
  if (!body.message.includes(`Nonce: ${body.nonce}`)) return "auth-message-nonce-mismatch";
  if (!body.message.includes(`Issued At: ${body.issuedAt}`)) return "auth-message-issued-at-mismatch";

  const chainInMessage = Number.parseInt(parseMessageField(body.message, "Chain ID"), 10);
  const chainFromBody = chainIdToNumber(body.chainId);
  if (!chainInMessage || !chainFromBody || chainInMessage !== chainFromBody) {
    return "auth-message-chain-mismatch";
  }

  return "";
}

function validateScoreSubmission(body, session, nowMs) {
  if (!isAddress(body?.wallet || "")) return "wallet-invalid";
  if (typeof body?.signature !== "string" || body.signature.length < 10) return "signature-invalid";
  if (!Number.isFinite(body?.score) || body.score < 0 || body.score > config.maxScore) return "score-invalid";
  if (!Number.isFinite(body?.stage) || body.stage < 1 || body.stage > config.maxStage) return "stage-invalid";
  if (!Number.isFinite(body?.maxCombo) || body.maxCombo < 1 || body.maxCombo > config.maxCombo) return "combo-invalid";
  if (typeof body?.dailySeed !== "string" || body.dailySeed.trim().length < 6) return "daily-seed-invalid";
  if (!isReasonableIsoTimestamp(body?.when)) return "timestamp-invalid";
  if (typeof body?.playerName !== "string" || !body.playerName.trim()) return "player-name-invalid";

  const normalizedChainId = normalizeChainId(body.chainId || "");
  if (normalizedChainId !== normalizeChainId(config.baseChainId)) return "wrong-network";

  const wallet = body.wallet.toLowerCase();
  if (wallet !== String(session.address || "").toLowerCase()) return "auth-wallet-mismatch";

  const whenMs = Date.parse(body.when);
  if (nowMs > whenMs + config.maxSubmitAgeSec * 1000) return "timestamp-stale";
  if (whenMs > nowMs + config.maxIssuedAtSkewSec * 1000) return "timestamp-future";

  const plausibleScoreCap = Math.max(config.scorePerStageSoftCap, Math.floor(body.stage * config.scorePerStageSoftCap));
  if (body.score > plausibleScoreCap) return "score-velocity-suspect";

  return "";
}

function validateClaim(body, session) {
  if (!isAddress(body?.wallet || "")) return "wallet-invalid";
  if (typeof body?.signature !== "string" || body.signature.length < 10) return "signature-invalid";
  if (typeof body?.tokenId !== "string" || !body.tokenId.trim()) return "token-id-invalid";
  const milestoneId = normalizeMilestoneId(body?.milestoneId);
  if (!milestoneId) return "milestone-id-invalid";
  const milestoneStageExpected = Number(MILESTONE_STAGE_MAP[milestoneId] || 0);
  if (!milestoneStageExpected) return "milestone-id-invalid";
  const milestoneStage = Number.isFinite(body?.milestoneStage) ? Math.floor(body.milestoneStage) : 0;
  if (milestoneStage !== milestoneStageExpected) return "milestone-stage-mismatch";
  if (typeof body?.milestoneLabel !== "string" || !body.milestoneLabel.trim()) return "milestone-label-invalid";
  if (!Number.isFinite(body?.score) || body.score < 0 || body.score > config.maxScore) return "score-invalid";
  if (!Number.isFinite(body?.stage) || body.stage < milestoneStageExpected) return "stage-not-eligible";
  if (!isReasonableIsoTimestamp(body?.when)) return "timestamp-invalid";
  if (typeof body?.playerName !== "string" || !body.playerName.trim()) return "player-name-invalid";

  const normalizedChainId = normalizeChainId(body.chainId || "");
  if (normalizedChainId !== normalizeChainId(config.baseChainId)) return "wrong-network";

  if (body.wallet.toLowerCase() !== String(session.address || "").toLowerCase()) return "auth-wallet-mismatch";

  return "";
}

function chooseMintStatus() {
  const raw = typeof config.mintMode === "string" ? config.mintMode.trim().toLowerCase() : "";
  if (raw === "minted") return "minted";
  if (raw === "failed") return "failed";
  if (raw === "unavailable") return "unavailable";
  if (raw === "live") return "pending";
  return "pending";
}

function mintDetails(mintStatus, tokenId) {
  if (mintStatus !== "minted") {
    return {
      mintStatus,
      mintTxHash: "",
      mintedTokenId: "",
      mintedAt: ""
    };
  }

  const txHash = `0x${randomHex(32)}`;
  return {
    mintStatus,
    mintTxHash: txHash,
    mintedTokenId: tokenId,
    mintedAt: nowIso()
  };
}

async function mintForClaim(wallet, milestoneId, tokenId) {
  if (rewardMinter?.enabled && typeof rewardMinter.mintMilestone === "function") {
    return rewardMinter.mintMilestone(wallet, milestoneId);
  }
  return mintDetails(chooseMintStatus(), tokenId);
}

function rewardContractExplorerUrl() {
  const address = String(config.rewardContractAddress || "").trim();
  if (!address) return "";
  const base = String(config.rewardContractExplorer || "").trim();
  if (!base) return "";
  if (base.toLowerCase().includes(address.toLowerCase())) return base;
  if (base.endsWith("/")) return `${base}${address}`;
  return `${base}/${address}`;
}

function rewardRuntimeInfo() {
  return {
    chainId: normalizeChainId(config.rewardContractChainId || config.baseChainId),
    contractAddress: String(config.rewardContractAddress || "").trim(),
    metadataBaseUri: String(config.rewardMetadataBaseUri || "").trim(),
    contractExplorerUrl: rewardContractExplorerUrl(),
    mintMode: config.mintMode,
    liveMinterEnabled: Boolean(rewardMinter?.enabled),
    liveMinterReason: String(rewardMinter?.reason || "")
  };
}

function mintTxExplorerUrl(txHash) {
  const hash = typeof txHash === "string" ? txHash.trim() : "";
  if (!hash) return "";
  const baseUrl = String(config.mintExplorerBase || "").trim();
  if (!baseUrl) return "";
  if (baseUrl.endsWith("/")) return `${baseUrl}${hash}`;
  return `${baseUrl}/${hash}`;
}

function sanitizeLeaderboardEntry(row) {
  return {
    score: Number(row.score) || 0,
    stage: Number(row.stage) || 1,
    maxCombo: Number(row.maxCombo) || 1,
    playerName: String(row.playerName || "Anonymous"),
    wallet: String(row.wallet || ""),
    when: String(row.when || nowIso())
  };
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendError(response, 400, "bad-request", "Missing URL.");
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }

  const nowMs = Date.now();
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "basebrick-backend",
        env: config.env,
        network: config.network,
        chainId: normalizeChainId(config.baseChainId),
        authVerifier: {
          rpcUrl: config.baseRpcUrl,
          smartAccountCapable: Boolean(signatureVerifyClient)
        },
        reward: rewardRuntimeInfo(),
        now: nowIso()
      });
      return;
    }

    if (request.method === "GET" && pathname === "/metrics") {
      sendJson(response, 200, {
        ok: true,
        metrics: stateStore.metrics(),
        now: nowIso()
      });
      return;
    }

    if (request.method === "GET" && pathname === "/auth/nonce") {
      const limit = checkRateLimit(request, "auth", config.rateLimitAuthPerIp);
      if (!limit.ok) {
        sendError(
          response,
          429,
          "rate-limit",
          "Too many auth requests.",
          "Retry after the reset window."
        );
        return;
      }

      const nonce = randomHex(18);
      const expiresAtMs = nowMs + config.authNonceTtlSec * 1000;
      stateStore.issueNonce(nonce, expiresAtMs);
      audit.write("auth.nonce_issued", {
        nonce,
        ip: limit.ip,
        expiresAt: new Date(expiresAtMs).toISOString()
      });

      sendJson(
        response,
        200,
        {
          nonce,
          expiresAt: new Date(expiresAtMs).toISOString()
        },
        sendRateLimitHeaders(response, limit)
      );
      return;
    }

    if (request.method === "POST" && pathname === "/auth/verify") {
      const limit = checkRateLimit(request, "auth", config.rateLimitAuthPerIp);
      if (!limit.ok) {
        sendError(response, 429, "rate-limit", "Too many auth verify requests.");
        return;
      }

      const body = await readJsonBody(request);
      const authError = validateAuthVerifyPayload(body, nowMs);
      if (authError) {
        sendError(response, 400, authError, "Invalid auth verification payload.");
        return;
      }

      const nonceAccepted = stateStore.consumeNonce(String(body.nonce), nowMs);
      if (!nonceAccepted) {
        sendError(response, 401, "auth-nonce-expired", "Nonce expired or already used.");
        return;
      }

      const address = String(body.address).toLowerCase();
      const validSignature = await verifyWalletMessage({
        wallet: address,
        message: String(body.message),
        signature: String(body.signature)
      });
      if (!validSignature) {
        sendError(response, 401, "auth-signature-invalid", "Auth signature verification failed.");
        return;
      }

      const expiresAtMs = nowMs + config.authSessionTtlSec * 1000;
      const tokenPayload = {
        sub: address,
        chainId: normalizeChainId(body.chainId || config.baseChainId),
        iat: Math.floor(nowMs / 1000),
        exp: Math.floor(expiresAtMs / 1000)
      };
      const token = createToken(tokenPayload, config.authTokenSecret);

      stateStore.saveSession(token, {
        address,
        chainId: tokenPayload.chainId,
        issuedAt: nowIso(),
        expiresAt: expiresAtMs
      });

      audit.write("auth.verified", {
        address,
        ip: limit.ip,
        chainId: tokenPayload.chainId,
        expiresAt: new Date(expiresAtMs).toISOString()
      });

      sendJson(
        response,
        200,
        {
          token,
          expiresAt: new Date(expiresAtMs).toISOString()
        },
        sendRateLimitHeaders(response, limit)
      );
      return;
    }

    if (request.method === "GET" && pathname === "/monobrick/daily-seed") {
      const seed = daySeed();
      sendJson(response, 200, {
        seed,
        target: dailyTarget(seed),
        source: "verified-remote",
        network: config.network,
        updatedAt: nowIso()
      });
      return;
    }

    if (request.method === "POST" && pathname === "/monobrick/submit-score") {
      const limit = checkRateLimit(request, "submit", config.rateLimitSubmitPerIp);
      if (!limit.ok) {
        sendError(response, 429, "rate-limit", "Too many score submissions.");
        return;
      }

      const body = await readJsonBody(request);
      const authGate = requireAuth(request, body, nowMs);
      if (!authGate.ok) {
        sendError(response, 401, authGate.code, authGate.message);
        return;
      }

      const invalid = validateScoreSubmission(body, authGate.session, nowMs);
      if (invalid) {
        sendError(response, 400, invalid, "Score submission validation failed.");
        return;
      }

      const walletRaw = String(body.wallet || "");
      const wallet = walletRaw.toLowerCase();
      const message = buildSubmissionMessage({
        score: Math.floor(body.score),
        stage: Math.floor(body.stage),
        maxCombo: Math.floor(body.maxCombo),
        playerName: String(body.playerName || ""),
        wallet: walletRaw,
        dailySeed: String(body.dailySeed),
        when: String(body.when)
      });
      const signature = String(body.signature);
      const signatureOk = await verifyWalletMessage({ wallet, message, signature });
      if (!signatureOk) {
        sendError(response, 400, "signature-invalid", "Submission signature verification failed.");
        return;
      }

      const signatureUnused = stateStore.useSignature(signature, "submit-score", nowIso());
      if (!signatureUnused) {
        sendError(response, 409, "signature-replay", "Duplicate signature detected.");
        return;
      }

      const submissionId = crypto.randomUUID();
      const entry = {
        submissionId,
        score: Math.floor(body.score),
        stage: Math.floor(body.stage),
        maxCombo: Math.floor(body.maxCombo),
        playerName: String(body.playerName).trim().slice(0, 32),
        wallet,
        signature,
        chainId: normalizeChainId(body.chainId || config.baseChainId),
        dailySeed: String(body.dailySeed).trim(),
        when: String(body.when)
      };
      stateStore.addSubmission(entry);
      audit.write("score.submitted", {
        submissionId,
        wallet,
        score: entry.score,
        stage: entry.stage,
        ip: limit.ip
      });

      sendJson(
        response,
        200,
        {
          submissionId,
          acceptedAt: nowIso(),
          trust: "verified-remote"
        },
        sendRateLimitHeaders(response, limit)
      );
      return;
    }

    if (request.method === "GET" && pathname === "/monobrick/leaderboard") {
      const limitRaw = Number.parseInt(url.searchParams.get("limit") || "", 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 50) : 20;
      const entries = stateStore.getLeaderboard(limit).map(sanitizeLeaderboardEntry);
      sendJson(response, 200, {
        entries,
        source: "verified-remote",
        updatedAt: nowIso()
      });
      return;
    }

    if (
      request.method === "POST" &&
      (pathname === "/monobrick/claim-reward" || pathname === "/monobrick/claim-og-badge")
    ) {
      const limit = checkRateLimit(request, "claim", config.rateLimitClaimPerIp);
      if (!limit.ok) {
        sendError(response, 429, "rate-limit", "Too many reward claim requests.");
        return;
      }

      const body = await readJsonBody(request);
      const authGate = requireAuth(request, body, nowMs);
      if (!authGate.ok) {
        sendError(response, 401, authGate.code, authGate.message);
        return;
      }

      const invalid = validateClaim(body, authGate.session);
      if (invalid) {
        sendError(response, 400, invalid, "Claim payload validation failed.");
        return;
      }

      const walletRaw = String(body.wallet || "");
      const wallet = walletRaw.toLowerCase();
      const milestoneId = normalizeMilestoneId(body?.milestoneId);
      const milestoneStage = Number(MILESTONE_STAGE_MAP[milestoneId] || 0);
      if (config.requireVerifiedScoreForClaim && !stateStore.hasEligibleSubmission(wallet, milestoneStage)) {
        sendError(
          response,
          403,
          "stage-not-eligible",
          "Verified stage completion is required before this milestone claim."
        );
        return;
      }

      const existing = stateStore.getClaim(wallet, milestoneId);
      if (existing) {
        sendJson(
          response,
          200,
          {
            claimId: existing.claimId,
            milestoneId: existing.milestoneId,
            milestoneStage: existing.milestoneStage,
            milestoneLabel: existing.milestoneLabel,
            mintStatus: existing.mintStatus,
            mintTxHash: existing.mintTxHash || "",
            mintTxExplorerUrl: mintTxExplorerUrl(existing.mintTxHash || ""),
            mintedTokenId: existing.mintedTokenId || "",
            mintedAt: existing.mintedAt || "",
            mintError: existing.mintError || "",
            reward: rewardRuntimeInfo()
          },
          sendRateLimitHeaders(response, limit)
        );
        return;
      }

      const message = buildClaimMessage({
        wallet: walletRaw,
        playerName: String(body.playerName),
        score: Math.floor(body.score),
        stage: Math.floor(body.stage),
        milestoneId,
        milestoneStage: milestoneStage,
        milestoneLabel: String(body.milestoneLabel),
        tokenId: String(body.tokenId),
        when: String(body.when)
      });
      const signature = String(body.signature);
      const signatureOk = await verifyWalletMessage({ wallet, message, signature });
      if (!signatureOk) {
        sendError(response, 400, "signature-invalid", "Claim signature verification failed.");
        return;
      }

      const signatureUnused = stateStore.useSignature(signature, `claim-reward:${milestoneId}`, nowIso());
      if (!signatureUnused) {
        sendError(response, 409, "signature-replay", "Duplicate signature detected.");
        return;
      }

      const claimId = crypto.randomUUID();
      const mint = await mintForClaim(wallet, milestoneId, String(body.tokenId).trim());
      const claim = {
        claimId,
        wallet,
        milestoneId,
        milestoneStage,
        milestoneLabel: String(body.milestoneLabel).trim().slice(0, 48),
        score: Math.floor(body.score),
        stage: Math.floor(body.stage),
        tokenId: String(body.tokenId).trim(),
        signature,
        chainId: normalizeChainId(body.chainId || config.baseChainId),
        createdAt: nowIso(),
        ...mint
      };
      stateStore.saveClaim(wallet, milestoneId, claim);
      audit.write("reward.claimed", {
        claimId,
        wallet,
        milestoneId,
        stage: claim.stage,
        mintStatus: claim.mintStatus,
        ip: limit.ip
      });

      sendJson(
        response,
        200,
        {
          claimId: claim.claimId,
          milestoneId: claim.milestoneId,
          milestoneStage: claim.milestoneStage,
          milestoneLabel: claim.milestoneLabel,
          mintStatus: claim.mintStatus,
          mintTxHash: claim.mintTxHash,
          mintTxExplorerUrl: mintTxExplorerUrl(claim.mintTxHash || ""),
          mintedTokenId: claim.mintedTokenId,
          mintedAt: claim.mintedAt,
          mintError: claim.mintError || "",
          reward: rewardRuntimeInfo()
        },
        sendRateLimitHeaders(response, limit)
      );
      return;
    }

    sendError(response, 404, "not-found", "Route not found.");
  } catch (error) {
    audit.write("server.error", {
      route: pathname,
      method: request.method,
      detail: String(error?.message || error)
    });
    sendError(response, 500, "server-error", "Unhandled server error.", String(error?.message || error));
  }
});

server.listen(config.port, () => {
  const prefix = `[basebrick-backend] listening on http://localhost:${config.port}`;
  console.log(prefix);
});
