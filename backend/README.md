# BaseBrick Verified Backend Package

This folder now contains both:

- a production-oriented backend (`src/index.mjs`)
- a lightweight mock backend (`mock-server.mjs`)

Both implement the same API contract in `openapi.yaml`.

## API Surface

- `GET /health`
- `GET /metrics`
- `GET /auth/nonce`
- `POST /auth/verify`
- `GET /monobrick/daily-seed`
- `POST /monobrick/submit-score`
- `GET /monobrick/leaderboard`
- `POST /monobrick/claim-reward` (legacy alias: `/monobrick/claim-og-badge`)

## Run Production Backend

```powershell
cd backend
copy .env.example .env
npm install
npm start
```

## Run Mock Backend

```powershell
cd backend
copy .env.example .env
npm run start:mock
```

Default port is `8787`.

## Frontend Runtime Config

`runtime-config.json` example:

```json
{
  "apiBaseUrl": "http://localhost:8787",
  "endpoints": {
    "authNonce": "/auth/nonce",
    "authVerify": "/auth/verify",
    "dailySeed": "/monobrick/daily-seed",
    "submitScore": "/monobrick/submit-score",
    "leaderboard": "/monobrick/leaderboard",
    "claimReward": "/monobrick/claim-reward"
  }
}
```

## Production Backend Behavior

- Validates SIWE auth message + signature (`viem.verifyMessage`)
- Issues signed auth tokens with server-side session TTL
- Uses single-use nonce store for replay protection
- Reconstructs and verifies signed score + milestone claim messages
- Enforces chain and payload validation
- Enforces score plausibility checks (soft anti-cheat guardrail)
- Rate-limits auth/submit/claim by IP window
- Stores audit events in `AUDIT_LOG_PATH`
- Stores persistent state in `STATE_FILE_PATH`

## Key Env Vars

See `.env.example`. Most important:

- `AUTH_TOKEN_SECRET`
- `BASE_CHAIN_ID`
- `MAX_SCORE`, `MAX_STAGE`, `MAX_COMBO`
- `MAX_SUBMIT_AGE_SEC`, `MAX_ISSUED_AT_SKEW_SEC`
- `SCORE_PER_STAGE_SOFT_CAP`
- `REQUIRE_VERIFIED_SCORE_FOR_CLAIM`
- `MINT_MODE` (`pending`, `minted`, `failed`, `unavailable`, `live`)
- `REWARD_CONTRACT_ADDRESS` (live: `0xEACB5c472ad45D97f06C138833507dE6168A1A75`)
- `REWARD_CONTRACT_CHAIN_ID` (`0x2105` on Base mainnet)
- `REWARD_METADATA_BASE_URI` (`https://basebrick.vercel.app/metadata/`)
- `REWARD_CONTRACT_EXPLORER` (for example `https://basescan.org/address/`)
- `BASE_RPC_URL` (Base RPC used for live mint tx submission)
- `REWARD_SIGNER_PRIVATE_KEY` (server wallet that has `MINTER_ROLE`)
- `MINT_CONFIRMATIONS` (tx receipt confirmations to wait for in `live` mode)

`GET /health` and reward-claim responses now include a `reward` object with contract details. In `live` mode, claim responses also include `mintTxExplorerUrl` and `mintError`.

## Expected Frontend Error Handling

- auth: `auth-required`, `auth-invalid`, `auth-expired`, `auth-wallet-mismatch`
- payload/signature: `wallet-invalid`, `signature-invalid`, `signature-replay`
- score/game validity: `score-invalid`, `stage-invalid`, `combo-invalid`, `score-velocity-suspect`
- reward eligibility: `stage-not-eligible`, `wrong-network`
- milestone claim validity: `milestone-id-invalid`, `milestone-stage-mismatch`, `milestone-label-invalid`
- generic: `rate-limit`, `server-error`
