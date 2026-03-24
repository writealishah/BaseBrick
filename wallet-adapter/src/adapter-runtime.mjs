import {
  connect,
  createConfig,
  getAccount,
  reconnect,
  signMessage,
  switchChain,
  watchAccount
} from "@wagmi/core";
import { baseAccount, injected } from "@wagmi/connectors";
import { http } from "viem";
import { base } from "viem/chains";

const BASE_CHAIN_HEX = "0x2105";

function toHexChainId(chainId) {
  if (typeof chainId !== "number") return "";
  if (!Number.isFinite(chainId) || chainId <= 0) return "";
  return `0x${chainId.toString(16)}`;
}

function normalizeAccountPayload(account) {
  if (!account || typeof account !== "object") {
    return { address: "", chainId: "" };
  }
  const address = typeof account.address === "string" ? account.address : "";
  const chainId = toHexChainId(account.chainId);
  return { address, chainId };
}

function adapterRuntimeConfig() {
  const runtime = window.MONOBRICK_RUNTIME && typeof window.MONOBRICK_RUNTIME === "object" ? window.MONOBRICK_RUNTIME : {};
  const adapter =
    runtime.walletAdapter && typeof runtime.walletAdapter === "object" ? runtime.walletAdapter : {};
  const appName =
    typeof adapter.appName === "string" && adapter.appName.trim() ? adapter.appName.trim() : "MonoBrick Base";
  const appLogoUrl =
    typeof adapter.appLogoUrl === "string" && adapter.appLogoUrl.trim() ? adapter.appLogoUrl.trim() : undefined;
  const rpcUrl = typeof adapter.rpcUrl === "string" && adapter.rpcUrl.trim() ? adapter.rpcUrl.trim() : "https://mainnet.base.org";
  return { appName, appLogoUrl, rpcUrl };
}

const runtime = adapterRuntimeConfig();
const connectors = [];

try {
  connectors.push(
    baseAccount({
      appName: runtime.appName,
      ...(runtime.appLogoUrl ? { appLogoUrl: runtime.appLogoUrl } : {})
    })
  );
} catch {
  // Keep injected fallback available when Base Account connector is unavailable.
}

connectors.push(injected({ shimDisconnect: true }));

const wagmiConfig = createConfig({
  chains: [base],
  connectors,
  transports: {
    [base.id]: http(runtime.rpcUrl)
  }
});

function findConnectorById(connectorId) {
  return connectors.find((connector) => connector?.id === connectorId) || null;
}

async function ensureConnected(preferred = "") {
  const current = getAccount(wagmiConfig);
  if (current?.address) return normalizeAccountPayload(current);

  try {
    await reconnect(wagmiConfig);
  } catch {
    // Continue to explicit connect.
  }

  const next = getAccount(wagmiConfig);
  if (next?.address) return normalizeAccountPayload(next);

  const attempts = [];
  if (preferred) {
    const preferredConnector = findConnectorById(preferred);
    if (preferredConnector) attempts.push(preferredConnector);
  }

  connectors.forEach((connector) => {
    if (!attempts.includes(connector)) attempts.push(connector);
  });

  for (const connector of attempts) {
    try {
      await connect(wagmiConfig, { connector });
      const connected = getAccount(wagmiConfig);
      if (connected?.address) return normalizeAccountPayload(connected);
    } catch {
      // Try next connector.
    }
  }

  return { address: "", chainId: "" };
}

async function getBaseAccountProvider() {
  const connector = findConnectorById("baseAccount");
  if (!connector) return null;

  const connected = await ensureConnected("baseAccount");
  if (!connected.address) return null;

  if (connector.provider && typeof connector.provider.request === "function") {
    return connector.provider;
  }
  if (typeof connector.getProvider === "function") {
    const provider = await connector.getProvider();
    if (provider && typeof provider.request === "function") {
      return provider;
    }
  }
  return null;
}

async function connectAdapter() {
  const connected = await ensureConnected("baseAccount");
  if (!connected.address) {
    return { ok: false, reason: "wallet-connect-failed" };
  }
  return { ok: true, address: connected.address, chainId: connected.chainId };
}

async function getConnectedAdapter() {
  const account = getAccount(wagmiConfig);
  if (account?.address) {
    const payload = normalizeAccountPayload(account);
    return { ok: true, ...payload };
  }

  const connected = await ensureConnected();
  if (!connected.address) return { ok: false, reason: "account-missing" };
  return { ok: true, address: connected.address, chainId: connected.chainId };
}

async function ensureBaseNetworkAdapter() {
  const connected = await ensureConnected();
  if (!connected.address) return { ok: false, reason: "account-missing", chainId: "" };
  if (connected.chainId === BASE_CHAIN_HEX) {
    return { ok: true, chainId: connected.chainId };
  }

  try {
    await switchChain(wagmiConfig, { chainId: base.id });
  } catch {
    const latest = getAccount(wagmiConfig);
    const fallback = normalizeAccountPayload(latest);
    return {
      ok: fallback.chainId === BASE_CHAIN_HEX,
      chainId: fallback.chainId,
      reason: "switch-rejected"
    };
  }

  const updated = normalizeAccountPayload(getAccount(wagmiConfig));
  return { ok: updated.chainId === BASE_CHAIN_HEX, chainId: updated.chainId };
}

async function signMessageAdapter({ address, message }) {
  const connected = await ensureConnected();
  if (!connected.address) return "";
  const accountAddress = typeof address === "string" && address ? address : connected.address;
  return signMessage(wagmiConfig, {
    account: accountAddress,
    message: String(message || "")
  });
}

async function signInWithEthereumAdapter({
  nonce,
  chainId = BASE_CHAIN_HEX,
  statement = "",
  issuedAt = "",
  domain = "",
  uri = ""
}) {
  const provider = await getBaseAccountProvider();
  if (!provider) return { ok: false, reason: "base-account-provider-missing" };

  const nonceValue =
    typeof nonce === "string" && nonce.trim()
      ? nonce.trim()
      : window.crypto?.randomUUID?.().replaceAll("-", "") || `${Date.now()}`;
  const chainIdHex = typeof chainId === "string" && chainId.trim() ? chainId.trim() : BASE_CHAIN_HEX;

  try {
    const result = await provider.request({
      method: "wallet_connect",
      params: [
        {
          version: "1",
          capabilities: {
            signInWithEthereum: {
              nonce: nonceValue,
              chainId: chainIdHex,
              ...(statement ? { statement } : {}),
              ...(issuedAt ? { issuedAt } : {}),
              ...(domain ? { domain } : {}),
              ...(uri ? { uri } : {})
            }
          }
        }
      ]
    });

    const account = Array.isArray(result?.accounts) ? result.accounts[0] : null;
    const address = typeof account?.address === "string" ? account.address : "";
    const siwe = account?.capabilities?.signInWithEthereum || {};
    const message = typeof siwe.message === "string" ? siwe.message : "";
    const signature = typeof siwe.signature === "string" ? siwe.signature : "";
    const nonceFromResponse = typeof siwe.nonce === "string" ? siwe.nonce : nonceValue;
    const issuedAtFromResponse = typeof siwe.issuedAt === "string" ? siwe.issuedAt : issuedAt;

    if (!address || !message || !signature) {
      return { ok: false, reason: "base-siwe-invalid-response" };
    }

    return {
      ok: true,
      address,
      message,
      signature,
      nonce: nonceFromResponse,
      issuedAt: issuedAtFromResponse,
      chainId: chainIdHex
    };
  } catch {
    return { ok: false, reason: "base-siwe-rejected" };
  }
}

function watchAdapter(onProfileChange) {
  if (typeof onProfileChange !== "function") return () => {};

  const unwatch = watchAccount(wagmiConfig, {
    onChange(account) {
      const normalized = normalizeAccountPayload(account);
      onProfileChange(normalized);
    }
  });

  return typeof unwatch === "function" ? unwatch : () => {};
}

window.MONOBRICK_WALLET_ADAPTER = {
  mode: "wagmi-viem-base-account",
  connect: connectAdapter,
  getConnected: getConnectedAdapter,
  ensureBaseNetwork: ensureBaseNetworkAdapter,
  signMessage: signMessageAdapter,
  signInWithEthereum: signInWithEthereumAdapter,
  watch: watchAdapter
};

window.dispatchEvent(
  new CustomEvent("monobrick:wallet-adapter-ready", {
    detail: { mode: "wagmi-viem-base-account" }
  })
);

