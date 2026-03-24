# Wallet Modernization Layer

## Why this exists

The Base docs now recommend a standard web wallet stack using wagmi + viem + SIWE.
This static repo now uses a wallet adapter boundary so gameplay code stays stable while wallet stack upgrades happen underneath.

## Current Architecture

- `src/wallet-client.js`: canonical wallet interface
- `src/base-hooks.js`: auth/submit/claim logic using wallet interface
- `window.MONOBRICK_WALLET_ADAPTER` (optional): external modern adapter
- `wallet-adapter/`: buildable wagmi + viem + Base Account adapter package
- production policy: adapter-first (legacy injected disabled by default)
- localhost policy: legacy injected fallback allowed for debugging

## Adapter Contract

Provide this global before `src/bootstrap.js` finishes app boot:

```js
window.MONOBRICK_WALLET_ADAPTER = {
  mode: "wagmi-viem",
  async connect() {
    return { address: "0x...", chainId: "0x2105" };
  },
  async getConnected() {
    return { address: "0x...", chainId: "0x2105" };
  },
  async ensureBaseNetwork() {
    return { chainId: "0x2105" };
  },
  async signMessage({ address, message }) {
    return "0xsignature";
  },
  async signInWithEthereum({ nonce, chainId, statement, issuedAt, domain, uri }) {
    return { ok: true, address: "0x...", message: "...", signature: "0x..." };
  },
  watch(onProfileChange) {
    // invoke onProfileChange({ address, chainId })
    return () => {};
  }
};
```

## Implemented Adapter Package

Build steps:

```powershell
cd wallet-adapter
npm install
npm run build
```

Output:

- `wallet-adapter/dist/monobrick-wallet-adapter.js`
- copied to repo root: `wallet-adapter.js`

`src/bootstrap.js` loads adapter scripts only when `walletAdapterUrl` is set in runtime config, so guest-first startup stays fast.

Adapter internals:

- wagmi core action flow (`connect`, `getAccount`, `switchChain`, `signMessage`, `watchAccount`)
- wagmi connectors (`baseAccount`, `coinbaseWallet`, `injected`)
- viem chain transport for Base mainnet
- Base Account SIWE capability via `wallet_connect` + `signInWithEthereum`
- guest-safe behavior: passive wallet checks do not trigger connect popups

## Runtime Wallet Policy

Runtime keys:

- `walletAdapterRequired`
- `allowLegacyInjected`
- `walletAdapter.required`
- `walletAdapter.allowLegacyInjected`

Recommended production values:

- `walletAdapterRequired: true`
- `allowLegacyInjected: false`

Recommended localhost values:

- `walletAdapterRequired: false`
- `allowLegacyInjected: true`
