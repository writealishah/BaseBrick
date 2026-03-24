const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();

  if (!deployer?.address) {
    throw new Error("No deployer signer available. Check DEPLOYER_PRIVATE_KEY in .env.");
  }

  const baseMetadataURI = process.env.BASE_METADATA_URI;
  if (!baseMetadataURI) {
    throw new Error("BASE_METADATA_URI is required in .env (e.g. https://cdn.example.com/basebrick/metadata/).");
  }

  const minterAddress = process.env.MINTER_ADDRESS || deployer.address;

  console.log("Deploying BaseBrickMilestones...");
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("Minter:", minterAddress);
  console.log("Base metadata URI:", baseMetadataURI);

  const Contract = await ethers.getContractFactory("BaseBrickMilestones");
  const contract = await Contract.deploy(baseMetadataURI, deployer.address, minterAddress);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("BaseBrickMilestones deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
