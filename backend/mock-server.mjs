import http from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

function parseEnvInt(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

const config = {
  port: parseEnvInt("PORT", 8787),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  nonceTtlMs: parseEnvInt("AUTH_NONCE_TTL_SEC", 300) * 1000,
  sessionTtlMs: parseEnvInt("AUTH_SESSION_TTL_SEC", 3600) * 1000,
  maxScore: parseEnvInt("MAX_SCORE", 250000),
  maxStage: parseEnvInt("MAX_STAGE", 20),
  autoMintMode: (process.env.AUTO_MINT_MODE || "pending").toLowerCase(),
  network: process.env.NETWORK || "base-mainnet"
};

const nonces = new Map();
const usedSignatures = new Set();
const sessions = new Map();
const submissions = [];
const claimsByWallet = new Map();
const milestoneStageMap = {
  alpha: 5,
  beta: 10,
  gamma: 15,
  omega: 20
};

function normalizeMilestoneId(value) {
  if (typeof value !== "string") return "";
  const key = value.trim().toLowerCase();
  return key in milestoneStageMap ? key : "";
}

function nowIso() {
  return new Date().toISOString();
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": config.corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > 500_000) {
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

function daySeed(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function dailyTarget(seed) {
  return 900 + (hash(seed) % 1800);
}

function isHexAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function getAuthToken(request, body = {}) {
  const authHeader = request.headers.authorization || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (typeof body?.auth?.token === "string") {
    return body.auth.token.trim();
  }
  return "";
}

function requireAuth(request, body) {
  const token = getAuthToken(request, body);
  if (!token) return { ok: false, reason: "auth-required" };
  const session = sessions.get(token);
  if (!session) return { ok: false, reason: "auth-invalid" };
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return { ok: false, reason: "auth-expired" };
  }
  return { ok: true, session };
}

function validateSubmission(body) {
  if (!isHexAddress(body.wallet)) return "wallet-invalid";
  if (typeof body.signature !== "string" || body.signature.length < 10) return "signature-invalid";
  if (!Number.isFinite(body.score) || body.score < 0 || body.score > config.maxScore) return "score-invalid";
  if (!Number.isFinite(body.stage) || body.stage < 1 || body.stage > config.maxStage) return "stage-invalid";
  if (!Number.isFinite(body.maxCombo) || body.maxCombo < 1 || body.maxCombo > 999) return "combo-invalid";
  if (typeof body.dailySeed !== "string" || body.dailySeed.length < 6) return "daily-seed-invalid";
  if (typeof body.when !== "string" || !body.when) return "timestamp-invalid";
  return "";
}

function validateClaim(body) {
  if (!isHexAddress(body.wallet)) return "wallet-invalid";
  const milestoneId = normalizeMilestoneId(body?.milestoneId);
  if (!milestoneId) return "milestone-id-invalid";
  const milestoneStage = Number(milestoneStageMap[milestoneId] || 0);
  if (!milestoneStage) return "milestone-id-invalid";
  if (!Number.isFinite(body?.milestoneStage) || Math.floor(body.milestoneStage) !== milestoneStage) {
    return "milestone-stage-mismatch";
  }
  if (!Number.isFinite(body.stage) || body.stage < milestoneStage) return "stage-not-eligible";
  if (!Number.isFinite(body.score) || body.score < 0 || body.score > config.maxScore) return "score-invalid";
  if (typeof body.signature !== "string" || body.signature.length < 10) return "signature-invalid";
  if (typeof body.tokenId !== "string" || !body.tokenId) return "token-id-invalid";
  return "";
}

function chooseMintStatus() {
  if (config.autoMintMode === "minted") return "minted";
  if (config.autoMintMode === "failed") return "failed";
  return "pending";
}

function leaderboardRows() {
  return submissions
    .slice()
    .sort((a, b) => b.score - a.score || b.stage - a.stage)
    .slice(0, 20)
    .map((entry) => ({
      score: entry.score,
      stage: entry.stage,
      maxCombo: entry.maxCombo,
      playerName: entry.playerName,
      wallet: entry.wallet,
      when: entry.when
    }));
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: { code: "bad-request", message: "Missing URL." } });
    return;
  }

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const { pathname } = url;

  try {
    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, { ok: true, network: config.network, time: nowIso() });
      return;
    }

    if (request.method === "GET" && pathname === "/auth/nonce") {
      const nonce = randomUUID().replaceAll("-", "");
      nonces.set(nonce, Date.now() + config.nonceTtlMs);
      sendJson(response, 200, {
        nonce,
        expiresAt: new Date(Date.now() + config.nonceTtlMs).toISOString()
      });
      return;
    }

    if (request.method === "POST" && pathname === "/auth/verify") {
      const body = await readJsonBody(request);
      if (!isHexAddress(body.address || "")) {
        sendJson(response, 400, { error: { code: "auth-address-invalid", message: "Invalid wallet address." } });
        return;
      }
      if (typeof body.signature !== "string" || body.signature.length < 10) {
        sendJson(response, 400, { error: { code: "auth-signature-invalid", message: "Signature missing." } });
        return;
      }
      if (typeof body.nonce !== "string" || !body.nonce) {
        sendJson(response, 400, { error: { code: "auth-nonce-missing", message: "Nonce missing." } });
        return;
      }

      const nonceExpiresAt = nonces.get(body.nonce);
      if (!nonceExpiresAt || Date.now() > nonceExpiresAt) {
        sendJson(response, 401, { error: { code: "auth-nonce-expired", message: "Nonce expired or not issued." } });
        return;
      }
      nonces.delete(body.nonce);

      const token = randomUUID().replaceAll("-", "");
      const expiresAt = Date.now() + config.sessionTtlMs;
      sessions.set(token, {
        token,
        address: body.address.toLowerCase(),
        issuedAt: Date.now(),
        expiresAt
      });

      sendJson(response, 200, {
        token,
        expiresAt: new Date(expiresAt).toISOString()
      });
      return;
    }

    if (request.method === "GET" && pathname === "/monobrick/daily-seed") {
      const seed = daySeed();
      sendJson(response, 200, {
        seed,
        target: dailyTarget(seed),
        source: "mock-server"
      });
      return;
    }

    if (request.method === "POST" && pathname === "/monobrick/submit-score") {
      const body = await readJsonBody(request);
      const authGate = requireAuth(request, body);
      if (!authGate.ok) {
        sendJson(response, 401, { error: { code: authGate.reason, message: "Auth session required." } });
        return;
      }

      const invalid = validateSubmission(body);
      if (invalid) {
        sendJson(response, 400, { error: { code: invalid, message: "Submission payload invalid." } });
        return;
      }

      if (usedSignatures.has(body.signature)) {
        sendJson(response, 409, { error: { code: "signature-replay", message: "Duplicate signature." } });
        return;
      }

      usedSignatures.add(body.signature);
      const submissionId = randomUUID();
      submissions.push({
        submissionId,
        score: Math.floor(body.score),
        stage: Math.floor(body.stage),
        maxCombo: Math.floor(body.maxCombo),
        playerName: typeof body.playerName === "string" ? body.playerName : "Anonymous",
        wallet: body.wallet.toLowerCase(),
        signature: body.signature,
        dailySeed: body.dailySeed,
        chainId: body.chainId || "0x2105",
        when: body.when || nowIso()
      });

      sendJson(response, 200, {
        submissionId,
        acceptedAt: nowIso(),
        trust: "verified-remote"
      });
      return;
    }

    if (request.method === "GET" && pathname === "/monobrick/leaderboard") {
      sendJson(response, 200, {
        entries: leaderboardRows(),
        source: "verified-remote",
        updatedAt: nowIso()
      });
      return;
    }

    if (
      request.method === "POST" &&
      (pathname === "/monobrick/claim-reward" || pathname === "/monobrick/claim-og-badge")
    ) {
      const body = await readJsonBody(request);
      const authGate = requireAuth(request, body);
      if (!authGate.ok) {
        sendJson(response, 401, { error: { code: authGate.reason, message: "Auth session required." } });
        return;
      }

      const invalid = validateClaim(body);
      if (invalid) {
        sendJson(response, 400, { error: { code: invalid, message: "Claim payload invalid." } });
        return;
      }

      const key = `${body.wallet.toLowerCase()}:${normalizeMilestoneId(body.milestoneId)}`;
      const existing = claimsByWallet.get(key);
      if (existing) {
        sendJson(response, 200, {
          claimId: existing.claimId,
          milestoneId: existing.milestoneId,
          milestoneStage: existing.milestoneStage,
          milestoneLabel: existing.milestoneLabel,
          mintStatus: existing.mintStatus,
          mintedTokenId: existing.mintedTokenId,
          mintTxHash: existing.mintTxHash,
          mintedAt: existing.mintedAt
        });
        return;
      }

      if (usedSignatures.has(body.signature)) {
        sendJson(response, 409, { error: { code: "signature-replay", message: "Duplicate signature." } });
        return;
      }
      usedSignatures.add(body.signature);

      const mintStatus = chooseMintStatus();
      const claimId = randomUUID();
      const mintedTokenId = mintStatus === "minted" ? `${Date.now()}`.slice(-8) : "";
      const mintTxHash = mintStatus === "minted" ? `0x${randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64)}` : "";
      const mintedAt = mintStatus === "minted" ? nowIso() : "";
      const claim = {
        claimId,
        wallet: body.wallet.toLowerCase(),
        milestoneId: normalizeMilestoneId(body.milestoneId),
        milestoneStage: Number(milestoneStageMap[normalizeMilestoneId(body.milestoneId)] || 0),
        milestoneLabel: typeof body.milestoneLabel === "string" ? body.milestoneLabel.slice(0, 48) : "",
        mintStatus,
        mintedTokenId,
        mintTxHash,
        mintedAt,
        createdAt: nowIso()
      };
      claimsByWallet.set(key, claim);

      sendJson(response, 200, {
        claimId,
        milestoneId: claim.milestoneId,
        milestoneStage: claim.milestoneStage,
        milestoneLabel: claim.milestoneLabel,
        mintStatus,
        mintedTokenId,
        mintTxHash,
        mintedAt
      });
      return;
    }

    sendJson(response, 404, { error: { code: "not-found", message: "Route not found." } });
  } catch (error) {
    sendJson(response, 500, {
      error: {
        code: "server-error",
        message: "Unhandled server error.",
        detail: String(error?.message || error)
      }
    });
  }
});

server.listen(config.port, () => {
  console.log(`[basebrick-backend-mock] listening on http://localhost:${config.port}`);
});
