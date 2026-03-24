(function setRuntimeConfig() {
  const host = String(window.location.hostname || "").toLowerCase();
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const metaApiBase =
    document.querySelector('meta[name="basebrick-api-base-url"]')?.getAttribute("content")?.trim() || "";

  const configuredApiBase =
    typeof window.BASEBRICK_API_BASE_URL === "string" ? window.BASEBRICK_API_BASE_URL.trim() : "";
  const apiBaseUrl = configuredApiBase || metaApiBase || (isLocalHost ? "http://localhost:8787" : "");

  window.MONOBRICK_RUNTIME = {
    ...(window.MONOBRICK_RUNTIME || {}),
    apiBaseUrl,
    walletAdapterUrl: "/wallet-adapter.js",
    walletAdapter: {
      appName: "BaseBrick",
      rpcUrl: "https://mainnet.base.org"
    },
    reward: {
      chainId: "0x2105",
      contractAddress: "0xEACB5c472ad45D97f06C138833507dE6168A1A75",
      metadataBaseUri: "https://basebrick.vercel.app/metadata/",
      contractExplorerUrl: "https://basescan.org/address/0xEACB5c472ad45D97f06C138833507dE6168A1A75"
    },
    endpoints: {
      authNonce: "/auth/nonce",
      authVerify: "/auth/verify",
      dailySeed: "/monobrick/daily-seed",
      submitScore: "/monobrick/submit-score",
      leaderboard: "/monobrick/leaderboard",
      claimReward: "/monobrick/claim-reward"
    }
  };
})();
