# BaseBrick Onchain Reward Architecture (Implementation-Ready Spec)

## Scope

This spec defines the production onchain reward path for milestone rewards on Base.

Current live state in this repo:

- gameplay + milestone eligibility tracking: implemented
- local claim proof + remote sync states: implemented
- reward contract deployment: live on Base mainnet
- contract address: `0xEACB5c472ad45D97f06C138833507dE6168A1A75`
- BaseScan verified source: `https://basescan.org/address/0xEACB5c472ad45D97f06C138833507dE6168A1A75#code`
- metadata base URI: `https://basebrick.vercel.app/metadata/`
- mint relay/indexer backend: not deployed

## Milestones

- `alpha` -> stage `5`
- `beta` -> stage `10`
- `gamma` -> stage `15`
- `omega` -> stage `20`

Each milestone can be claimed once per wallet.

## Components

1. `BaseBrickScoreVerifier` (backend service)
- Validates score submission integrity and milestone eligibility.
- Issues signed reward attestations for eligible wallets and milestones.

2. `BaseBrickRewardMinter` (Base smart contract)
- Mints milestone reward token(s) for `alpha/beta/gamma/omega`.
- Accepts backend signer attestation with expiry + nonce.
- Emits indexed reward events.

3. `Reward Relay` (optional)
- Sponsored tx or relayer for gasless UX.
- Integrates paymaster policy if sponsoring.

4. `Indexer`
- Reads reward events.
- Exposes mint status + tx hash + token id to frontend.

## Contract Role

Recommended contract roles:

- `ADMIN_ROLE`: rotate signer, pause mint, set metadata base URI.
- `SIGNER_ROLE`: backend key authorizing claim attestations.
- `RELAYER_ROLE` (optional): restricted mint entrypoint for relayed txs.

## Eligibility Source of Truth

Eligibility is server-authoritative:

- Verified submission at or above the milestone stage.
- Replay and signature checks passed.
- Wallet has not already minted that milestone.

## Signature / Attestation Model

Use EIP-712 typed data:

- Domain:
  - `name`: `BaseBrickRewardMinter`
  - `version`: `1`
  - `chainId`: `8453`
  - `verifyingContract`: deployed minter address
- Struct fields:
  - `wallet`
  - `claimId`
  - `milestoneId`
  - `milestoneStage`
  - `expiresAt`
  - `nonce`

Backend signs typed message using `SIGNER_ROLE` key.
Contract verifies signer + nonce + expiry and mints once.

## Frontend States

Local sync states:

- `local-pending`
- `local-only`
- `synced`
- `failed-sync`

Mint states:

- `pending`
- `minted`
- `failed`
- `unavailable`

Expected transitions:

1. claim created locally -> `local-pending`
2. backend sync success -> `synced` + mint state
3. mint complete -> `synced` + `minted`
4. mint pipeline failure -> `synced` + `failed` (retry allowed)

## Required Deployment Checklist

1. Deploy reward minter on Base mainnet.
2. Publish ABI + contract address in backend env and frontend runtime.
3. Implement backend signer rotation and nonce store.
4. Implement indexer + mint status endpoint.
5. Turn on `claimReward` endpoint in runtime config.
