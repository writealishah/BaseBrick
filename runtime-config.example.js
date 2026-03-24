window.MONOBRICK_RUNTIME = {
  apiBaseUrl: "https://api.example.com",
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
    dailySeed: "/monobrick/daily-seed",
    submitScore: "/monobrick/submit-score",
    leaderboard: "/monobrick/leaderboard",
    claimReward: "/monobrick/claim-reward",
    authNonce: "/auth/nonce",
    authVerify: "/auth/verify"
  }
};
