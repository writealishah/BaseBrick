# BaseBrick Contract Package

This package contains the onchain milestone reward contract for BaseBrick.

## What it deploys

- `BaseBrickMilestones` (ERC-1155)
- Milestones `1..4` map to stage rewards:
  - `1` => Stage 5
  - `2` => Stage 10
  - `3` => Stage 15
  - `4` => Stage 20

Mint API:

```solidity
function mintMilestone(address to, uint8 milestone) external;
```

Only `MINTER_ROLE` can mint. Each wallet can claim each milestone once.

## Setup

1. Copy env template:

```bash
cp .env.example .env
```

2. Fill `.env`:

- `DEPLOYER_PRIVATE_KEY` = deploy wallet private key
- `BASE_METADATA_URI` = metadata directory URL ending with `/`
- `MINTER_ADDRESS` = backend signer/relayer wallet (or leave deployer)

## Commands

```bash
npm run compile
npm run deploy:base-sepolia
npm run abi:export
```

ABI output:

- `abi/BaseBrickMilestones.abi.json`

## Live Deployment

- Network: Base mainnet (`8453`)
- Contract: `0xEACB5c472ad45D97f06C138833507dE6168A1A75`
- Verified: `https://basescan.org/address/0xEACB5c472ad45D97f06C138833507dE6168A1A75#code`
