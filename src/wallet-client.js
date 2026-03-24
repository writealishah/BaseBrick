export const BASE_CHAIN_ID = "0x2105";

function normalizeHexChainId(chainId) {
  if (typeof chainId !== "string" || !chainId) return "";
  if (chainId.startsWith("0x")) return chainId.toLowerCase();
  const parsed = Number.parseInt(chainId, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return `0x${parsed.toString(16)}`;
}

function normalizeWalletShape(payload = {}) {
  const address = typeof payload?.address === "string" ? payload.address : "";
  const chainId = normalizeHexChainId(typeof payload?.chainId === "string" ? payload.chainId : "");
  return {
    address,
    chainId
  };
}

function getRuntimeConfig() {
  const runtime = window.MONOBRICK_RUNTIME || window.__MONOBRICK_RUNTIME__;
  return runtime && typeof runtime === "object" ? runtime : {};
}

function isLocalHostRuntime() {
  const host = String(window.location.hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function getWalletPolicy() {
  const runtime = getRuntimeConfig();
  const adapterConfig =
    runtime.walletAdapter && typeof runtime.walletAdapter === "object" ? runtime.walletAdapter : {};

  const requiredFromRuntime =
    typeof runtime.walletAdapterRequired === "boolean"
      ? runtime.walletAdapterRequired
      : typeof adapterConfig.required === "boolean"
        ? adapterConfig.required
        : !isLocalHostRuntime();

  const allowLegacyInjected =
    typeof runtime.allowLegacyInjected === "boolean"
      ? runtime.allowLegacyInjected
      : typeof adapterConfig.allowLegacyInjected === "boolean"
        ? adapterConfig.allowLegacyInjected
        : isLocalHostRuntime();

  return {
    adapterRequired: Boolean(requiredFromRuntime),
    allowLegacyInjected: Boolean(allowLegacyInjected)
  };
}

function getInjectedProvider() {
  const ethereum = window.ethereum || null;
  if (!ethereum) return null;
  const providers = Array.isArray(ethereum.providers) ? ethereum.providers : null;
  if (!providers?.length) return ethereum;
  const coinbaseProvider = providers.find((provider) => provider?.isCoinbaseWallet);
  if (coinbaseProvider) return coinbaseProvider;
  return providers[0] || ethereum;
}

function getExternalAdapter() {
  const adapter = window.MONOBRICK_WALLET_ADAPTER;
  if (!adapter || typeof adapter !== "object") return null;

  const requiredFns = ["connect", "getConnected", "signMessage"];
  const valid = requiredFns.every((name) => typeof adapter[name] === "function");
  if (!valid) return null;
  return adapter;
}

function canUseLegacyFallback() {
  const policy = getWalletPolicy();
  return !policy.adapterRequired || policy.allowLegacyInjected;
}

export function getWalletMode() {
  const external = getExternalAdapter();
  if (external) return typeof external.mode === "string" ? external.mode : "external-adapter";
  if (getInjectedProvider() && canUseLegacyFallback()) return "legacy-injected";
  if (!canUseLegacyFallback()) return "adapter-required";
  return "none";
}

export async function connectWalletClient() {
  const external = getExternalAdapter();
  if (external) {
    const connected = await external.connect();
    const safe = normalizeWalletShape(connected);
    if (!safe.address) return { ok: false, reason: "account-missing" };
    return { ok: true, ...safe, mode: getWalletMode() };
  }
  if (!canUseLegacyFallback()) return { ok: false, reason: "wallet-adapter-required" };

  const provider = getInjectedProvider();
  if (!provider) return { ok: false, reason: "wallet-missing" };
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const address = Array.isArray(accounts) ? accounts[0] : "";
  if (!address) return { ok: false, reason: "account-missing" };
  const chainId = normalizeHexChainId(await provider.request({ method: "eth_chainId" }));
  return { ok: true, address, chainId, mode: getWalletMode() };
}

export async function getConnectedWalletClient() {
  const external = getExternalAdapter();
  if (external) {
    const connected = await external.getConnected();
    const safe = normalizeWalletShape(connected);
    if (!safe.address) return { ok: false, reason: "account-missing" };
    return { ok: true, ...safe, mode: getWalletMode() };
  }
  if (!canUseLegacyFallback()) return { ok: false, reason: "wallet-adapter-required" };

  const provider = getInjectedProvider();
  if (!provider) return { ok: false, reason: "wallet-missing" };
  const accounts = await provider.request({ method: "eth_accounts" });
  const address = Array.isArray(accounts) ? accounts[0] : "";
  if (!address) return { ok: false, reason: "account-missing" };
  const chainId = normalizeHexChainId(await provider.request({ method: "eth_chainId" }));
  return { ok: true, address, chainId, mode: getWalletMode() };
}

export async function ensureBaseNetworkClient() {
  const external = getExternalAdapter();
  if (external && typeof external.ensureBaseNetwork === "function") {
    const response = await external.ensureBaseNetwork();
    const chainId = normalizeHexChainId(response?.chainId || "");
    return {
      ok: chainId === BASE_CHAIN_ID,
      chainId: chainId || BASE_CHAIN_ID,
      mode: getWalletMode()
    };
  }
  if (!canUseLegacyFallback()) return { ok: false, reason: "wallet-adapter-required" };

  const provider = getInjectedProvider();
  if (!provider) return { ok: false, reason: "wallet-missing" };

  const chainId = normalizeHexChainId(await provider.request({ method: "eth_chainId" }));
  if (chainId === BASE_CHAIN_ID) return { ok: true, chainId, mode: getWalletMode() };

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID }]
    });
  } catch (error) {
    if (error?.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: BASE_CHAIN_ID,
            chainName: "Base",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://mainnet.base.org"],
            blockExplorerUrls: ["https://basescan.org"]
          }
        ]
      });
    } else {
      return { ok: false, reason: "switch-rejected" };
    }
  }

  const nextChainId = normalizeHexChainId(await provider.request({ method: "eth_chainId" }));
  return { ok: nextChainId === BASE_CHAIN_ID, chainId: nextChainId, mode: getWalletMode() };
}

export async function signWalletMessage(message, address) {
  const external = getExternalAdapter();
  if (external) {
    const signature = await external.signMessage({ address, message });
    return { ok: typeof signature === "string" && signature.length > 0, signature: signature || "" };
  }
  if (!canUseLegacyFallback()) return { ok: false, reason: "wallet-adapter-required", signature: "" };

  const provider = getInjectedProvider();
  if (!provider) return { ok: false, reason: "wallet-missing", signature: "" };
  try {
    const signature = await provider.request({
      method: "personal_sign",
      params: [message, address]
    });
    return { ok: true, signature };
  } catch {
    const signature = await provider.request({
      method: "personal_sign",
      params: [address, message]
    });
    return { ok: true, signature };
  }
}

export async function signInWithEthereumClient(payload = {}) {
  const external = getExternalAdapter();
  if (!external || typeof external.signInWithEthereum !== "function") {
    if (!canUseLegacyFallback()) return { ok: false, reason: "wallet-adapter-required" };
    return { ok: false, reason: "unsupported" };
  }

  try {
    const result = await external.signInWithEthereum(payload);
    if (!result || typeof result !== "object") {
      return { ok: false, reason: "invalid-response" };
    }
    if (!result.ok) return { ok: false, reason: result.reason || "rejected" };
    return {
      ok: true,
      address: typeof result.address === "string" ? result.address : "",
      chainId: typeof result.chainId === "string" ? result.chainId : "",
      nonce: typeof result.nonce === "string" ? result.nonce : "",
      issuedAt: typeof result.issuedAt === "string" ? result.issuedAt : "",
      message: typeof result.message === "string" ? result.message : "",
      signature: typeof result.signature === "string" ? result.signature : ""
    };
  } catch {
    return { ok: false, reason: "rejected" };
  }
}

export function watchWalletClient(onProfileChange) {
  const external = getExternalAdapter();
  if (external && typeof external.watch === "function") {
    const maybeUnsub = external.watch((payload) => {
      const safe = normalizeWalletShape(payload || {});
      onProfileChange(safe);
    });
    return typeof maybeUnsub === "function" ? maybeUnsub : () => {};
  }
  if (!canUseLegacyFallback()) return () => {};

  const provider = getInjectedProvider();
  if (!provider?.on) return () => {};

  const handleAccounts = async (accounts) => {
    const address = Array.isArray(accounts) ? accounts[0] || "" : "";
    const chainId = address ? normalizeHexChainId(await provider.request({ method: "eth_chainId" })) : "";
    onProfileChange({ address, chainId });
  };

  const handleChain = async (chainId) => {
    const accounts = await provider.request({ method: "eth_accounts" });
    const address = Array.isArray(accounts) ? accounts[0] || "" : "";
    onProfileChange({ address, chainId: normalizeHexChainId(chainId) });
  };

  provider.on("accountsChanged", handleAccounts);
  provider.on("chainChanged", handleChain);

  return () => {
    provider.removeListener("accountsChanged", handleAccounts);
    provider.removeListener("chainChanged", handleChain);
  };
}
