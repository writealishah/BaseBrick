# MonoBrick Wallet Adapter (wagmi + viem + Base Account)

This package builds a browser bundle that exposes:

`window.MONOBRICK_WALLET_ADAPTER`

The main app will use this adapter when runtime config sets `walletAdapterUrl`.

## Why this exists

- keeps gameplay guest-first
- upgrades wallet/auth actions to wagmi + viem
- supports Base Account SIWE (`wallet_connect` + `signInWithEthereum`)
- includes connector stack: `baseAccount` -> `coinbaseWallet` -> `injected`
- avoids wallet popups during passive startup checks (`getConnected` is silent)

## Build

```powershell
cd wallet-adapter
npm install
npm run build
```

Build output:

- `wallet-adapter/dist/monobrick-wallet-adapter.js`
- copied to repo root as `wallet-adapter.js`

## Runtime config (optional)

You can customize adapter values via runtime config:

```json
{
  "walletAdapter": {
    "appName": "MonoBrick Base",
    "appLogoUrl": "https://example.com/icon.png",
    "rpcUrl": "https://mainnet.base.org"
  }
}
```

## Adapter methods

- `connect()`
- `getConnected()`
- `ensureBaseNetwork()`
- `signMessage({ address, message })`
- `signInWithEthereum({ nonce, chainId, statement, issuedAt, domain, uri })`
- `watch(onProfileChange)`
