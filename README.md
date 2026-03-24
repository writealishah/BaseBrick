# BaseBrick

BaseBrick is a standalone Breakout-style mini app where players clear stages and win milestone NFT rewards on Base Network.

## Base Feature Readiness (March 24, 2026)

Implemented in this repo:

- Standard web app flow (no Farcaster SDK dependency)
- Wallet adapter powered by wagmi + viem + Base Account / Coinbase connectors
- SIWE-compatible auth flow for verified actions
- Guest-first gameplay with delayed wallet/auth prompts
- Production reward contract deployed and verified on Base mainnet:
  - `0xEACB5c472ad45D97f06C138833507dE6168A1A75`
  - https://basescan.org/address/0xEACB5c472ad45D97f06C138833507dE6168A1A75#code
- Mobile-safe layout, safe-area handling, and clear post-run actions

Still external (not solved by static frontend code alone):

- Base.dev listing metadata completion (screenshots/category/tagline/builder code)
- Production backend deployment URL and operational monitoring
- Optional notifications via Base.dev API (when available for your app use case)

## Product Goals

- Instant onboarding and fast retries
- Strong NFT-on-Base reward motivation
- Strong screenshot scenes
- Natural share moments after runs
- Lightweight, mobile-first gameplay loop
- Honest trust states (device-local vs verified remote)

## Features in v2

- Home, gameplay, result, and leaderboard screens
- Responsive keyboard, touch drag, and on-screen controls
- Core Breakout loop with score, lives, stages, speed ramp, and best score
- 20-stage crypto text campaign
- `BASE`, `ETHEREUM`, `BITCOIN`, then slang stages (`HODL`, `LFG`, `IYKYK`, ...), ending with `WGMI`
- Milestone claim flow at stages `5`, `10`, `15`, `20` with backend-driven mint status
- Deployed Base mainnet reward contract: `0xEACB5c472ad45D97f06C138833507dE6168A1A75`
- Milestone claim state machine with explicit statuses: `local-pending`, `local-only`, `synced`, `failed-sync`
- Blue bricks with chain bonuses and drop rewards
- Rare multiplier block moments
- Daily seeded challenge target (local)
- Wallet connect and Base network switch button
- Optional SIWE authentication flow for verified remote actions
- Wallet adapter boundary (`external adapter` required in production, `legacy-injected` only for localhost fallback)
- Player identity using resolved wallet name (`.eth`/`*.base.eth` when available) or custom alias
- Signed score submission via wallet `personal_sign`
- Signed device leaderboard with player names + wallet addresses (local storage today)
- Dynamic trust-mode UI: local-first by default, verified mode when remote APIs are configured
- Share deep-link (`?play=1`) to jump challengers directly into gameplay
- Sound effects with in-app mute toggle
- Share CTA using native share or clipboard fallback
- Save/install prompt hook via `beforeinstallprompt`

## Project Structure

```text
mono-brick-base/
  index.html
  styles.css
  manifest.webmanifest
  base-miniapp.config.json
  backend/
  docs/
  wallet-adapter/
  assets/
  launch-assets/
  src/
    bootstrap.js
    app.js
    game.js
    storage.js
    config.js
    base-hooks.js
  runtime-config.example.js
  runtime-config.example.json
  wallet-adapter.js (generated)
```

## Local Run

Serve this folder with any static server, for example:

```powershell
cd mono-brick-base
python -m http.server 4173
```

Then open `http://localhost:4173`.

## Integration Hooks

`src/base-hooks.js` includes live browser integrations for:

- `connectWallet()` / `getConnectedWallet()`
- `ensureBaseNetwork()`
- `resolveWalletName(address)`
- `submitScore(payload)`
- `fetchLeaderboard()`
- `promptSaveInstall()`
- `shareScore(payload)`
- `fetchDailyChallengeSeed()`
- `authenticateWithSiwe()`
- `getRuntimeCapabilities()`

The score, leaderboard, daily challenge, and milestone claim logic are wallet-signed and device-local today, and can be upgraded to verified remote or onchain Base services without changing the core game loop.

## Runtime API Wiring

Optional runtime configuration is auto-loaded by [`src/bootstrap.js`](./src/bootstrap.js). It checks for:

- `runtime-config.json`
- `runtime-config.js`

If neither file exists, the app runs in local-only mode without errors.

To enable verified remote services, create either:

- `runtime-config.json` from [`runtime-config.example.json`](./runtime-config.example.json), or
- `runtime-config.js` from [`runtime-config.example.js`](./runtime-config.example.js)

This repo now ships a default [`runtime-config.js`](./runtime-config.js):

- On `localhost`, it points to `http://localhost:8787`
- On production hosts, it stays safe (no backend URL) unless you set:
  - `window.BASEBRICK_API_BASE_URL = "https://your-backend.example.com"`
  - or `<meta name="basebrick-api-base-url" content="https://your-backend.example.com">` in [`index.html`](./index.html)

For local verified-flow testing with the mock backend:

- copy [`runtime-config.mock-local.json`](./runtime-config.mock-local.json) to `runtime-config.json`

For local wallet modernization testing:

- build adapter bundle from [`wallet-adapter`](./wallet-adapter)
- set `walletAdapterUrl` in runtime config (for example `"/wallet-adapter.js"`)

Supported runtime endpoints:

- `dailySeed` (GET) -> `{ "seed": "YYYYMMDD-or-custom", "target": 1234 }`
- `leaderboard` (GET) -> `{ "entries": [...] }` or raw array
- `submitScore` (POST) -> accepts signed run payload
- `claimReward` (POST) -> accepts signed milestone claim payload
- `authNonce` (GET) -> `{ "nonce": "server-generated-nonce" }`
- `authVerify` (POST) -> verifies SIWE payload and optionally returns `{ "token": "...", "expiresAt": "..." }`

Supported runtime wallet adapter keys:

- `walletAdapterUrl` -> optional custom adapter script URL
- `walletAdapterRequired`
- `allowLegacyInjected`
- `walletAdapter.appName`
- `walletAdapter.appLogoUrl`
- `walletAdapter.rpcUrl`
- `walletAdapter.required`
- `walletAdapter.allowLegacyInjected`

Supported runtime reward keys:

- `reward.chainId`
- `reward.contractAddress`
- `reward.metadataBaseUri`
- `reward.contractExplorerUrl`

Claim sync behavior:

- If no reward endpoint exists, claims are stored as `local-only`.
- If a reward endpoint exists but sync fails, claim becomes `failed-sync` and can be retried.
- Successfully synced claims become `synced`.
- Mint state from backend is tracked as `pending`, `minted`, `failed`, or `unavailable`.

## Backend Package

Use the verified backend package in [`backend/README.md`](./backend/README.md).

Included:

- OpenAPI contract: [`backend/openapi.yaml`](./backend/openapi.yaml)
- Local mock server: [`backend/mock-server.mjs`](./backend/mock-server.mjs)
- Production server: [`backend/src/index.mjs`](./backend/src/index.mjs)
- Example payloads: [`backend/examples`](./backend/examples)

## Onchain Reward Spec

- [`docs/onchain-reward-architecture.md`](./docs/onchain-reward-architecture.md)
- [`docs/live-deploy-checklist.md`](./docs/live-deploy-checklist.md)

## Wallet Modernization Spec

- [`docs/wallet-modernization.md`](./docs/wallet-modernization.md)
- Buildable adapter package: [`wallet-adapter/README.md`](./wallet-adapter/README.md)

## Base App Alignment (March 22, 2026)

Current Base docs indicate Base App now runs standard web apps (not Farcaster mini-app SDK flows), with wagmi/viem + SIWE as the preferred auth/wallet stack.

This repo now uses an adapter-first wallet stack with wagmi + viem + Base Account/Coinbase connectors in production. Legacy injected mode remains available only for localhost debugging.
