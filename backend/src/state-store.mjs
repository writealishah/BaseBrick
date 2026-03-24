import fs from "node:fs";
import path from "node:path";

function defaultState() {
  return {
    nonces: {},
    sessions: {},
    usedSignatures: {},
    submissions: [],
    claims: {},
    counters: {
      authNonceIssued: 0,
      authVerified: 0,
      scoreSubmitted: 0,
      rewardClaimed: 0
    }
  };
}

export function createStateStore(filePath) {
  const folder = path.dirname(filePath);
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

  let state = defaultState();
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      state = {
        ...defaultState(),
        ...parsed
      };
    } catch {
      state = defaultState();
    }
  }

  function persist() {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
  }

  function prune(nowMs) {
    Object.entries(state.nonces).forEach(([nonce, item]) => {
      if (!item || nowMs > Number(item.expiresAt || 0)) {
        delete state.nonces[nonce];
      }
    });
    Object.entries(state.sessions).forEach(([token, item]) => {
      if (!item || nowMs > Number(item.expiresAt || 0)) {
        delete state.sessions[token];
      }
    });
  }

  return {
    issueNonce(nonce, expiresAt) {
      state.nonces[nonce] = { expiresAt };
      state.counters.authNonceIssued += 1;
      persist();
    },
    consumeNonce(nonce, nowMs) {
      const item = state.nonces[nonce];
      if (!item) return false;
      if (nowMs > Number(item.expiresAt || 0)) {
        delete state.nonces[nonce];
        persist();
        return false;
      }
      delete state.nonces[nonce];
      persist();
      return true;
    },
    saveSession(token, payload) {
      state.sessions[token] = payload;
      state.counters.authVerified += 1;
      persist();
    },
    getSession(token, nowMs) {
      prune(nowMs);
      const item = state.sessions[token];
      if (!item) return null;
      if (nowMs > Number(item.expiresAt || 0)) return null;
      return item;
    },
    useSignature(signature, type, nowIso) {
      if (state.usedSignatures[signature]) return false;
      state.usedSignatures[signature] = { type, when: nowIso };
      persist();
      return true;
    },
    addSubmission(entry) {
      state.submissions.push(entry);
      state.counters.scoreSubmitted += 1;
      persist();
    },
    getLeaderboard(limit = 20) {
      return state.submissions
        .slice()
        .sort((a, b) => b.score - a.score || b.stage - a.stage)
        .slice(0, limit);
    },
    getClaim(wallet, milestoneId) {
      const walletClaims = state.claims[wallet.toLowerCase()] || {};
      const key = String(milestoneId || "").toLowerCase();
      if (walletClaims && typeof walletClaims === "object" && typeof walletClaims.claimId === "string") {
        // Legacy single-claim shape from pre-milestone storage.
        return key === "omega" ? walletClaims : null;
      }
      return walletClaims[key] || null;
    },
    saveClaim(wallet, milestoneId, claim) {
      const walletKey = wallet.toLowerCase();
      const key = String(milestoneId || "").toLowerCase();
      const walletClaims = state.claims[walletKey] && typeof state.claims[walletKey] === "object"
        ? state.claims[walletKey]
        : {};
      walletClaims[key] = claim;
      state.claims[walletKey] = walletClaims;
      state.counters.rewardClaimed += 1;
      persist();
    },
    hasEligibleSubmission(wallet, minStage) {
      const target = wallet.toLowerCase();
      return state.submissions.some((row) => row.wallet.toLowerCase() === target && row.stage >= minStage);
    },
    metrics() {
      const claimCount = Object.values(state.claims).reduce((total, walletClaims) => {
        if (!walletClaims || typeof walletClaims !== "object") return total;
        if (typeof walletClaims.claimId === "string") return total + 1;
        return total + Object.keys(walletClaims).length;
      }, 0);
      return {
        submissions: state.submissions.length,
        claims: claimCount,
        sessions: Object.keys(state.sessions).length,
        nonces: Object.keys(state.nonces).length,
        counters: { ...state.counters }
      };
    }
  };
}
