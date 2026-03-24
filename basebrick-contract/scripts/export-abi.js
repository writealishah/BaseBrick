const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

const artifactPath = resolve(
  "artifacts/contracts/BaseBrickMilestones.sol/BaseBrickMilestones.json"
);
const outputPath = resolve("abi/BaseBrickMilestones.abi.json");

const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(artifact.abi, null, 2));

console.log(`ABI exported: ${outputPath}`);
