export const GAME_CONFIG = {
  width: 540,
  height: 420,
  maxLives: 5,
  startingLives: 3,
  paddle: {
    width: 84,
    height: 11,
    yOffset: 26,
    speed: 380
  },
  ball: {
    radius: 6,
    baseSpeed: 255,
    stageSpeedStep: 18,
    maxSpeed: 470
  },
  bricks: {
    cols: 26,
    topOffset: 44,
    sidePadding: 14,
    rowGap: 4,
    colGap: 3,
    brickHeight: 17
  },
  drops: {
    speed: 108
  }
};

export const COPY = {
  title: "BaseBrick",
  pitch: "Play fast. Win NFTs on Base Network.",
  shareTemplate:
    "I scored {score} in BaseBrick (best {best}, stage {stage}) while chasing milestone NFTs on Base Network. Beat this run.",
  dailyShareTemplate:
    "Daily challenge on BaseBrick: {score} points. Climbing for NFTs on Base Network. Can you top this seed?",
  starterTagline: "Play now. Clear milestones. Win NFTs on Base Network."
};

export const REWARD_MILESTONES = [
  { id: "alpha", stage: 5, label: "Alpha BaseBrick" },
  { id: "beta", stage: 10, label: "Beta BaseBrick" },
  { id: "gamma", stage: 15, label: "Gamma BaseBrick" },
  { id: "omega", stage: 20, label: "Omega BaseBrick" }
];

export const STORAGE_KEYS = {
  best: "monobrick.bestScore",
  runs: "monobrick.topRuns",
  daily: "monobrick.dailyBest",
  submittedRuns: "monobrick.submittedRuns",
  profile: "monobrick.profile",
  soundMuted: "monobrick.soundMuted",
  ogBrickClaims: "monobrick.ogBrickClaims",
  milestoneClaims: "monobrick.milestoneClaims",
  campaignProgress: "monobrick.campaignProgress"
};
