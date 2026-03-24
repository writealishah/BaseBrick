// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title BaseBrickMilestones
/// @notice Milestone reward NFTs for BaseBrick progression.
contract BaseBrickMilestones is ERC1155, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint8 public constant MAX_MILESTONE = 4; // 1..4 => stages 5/10/15/20

    string private _baseMetadataURI;

    // tokenId => wallet => minted
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    error InvalidMilestone(uint8 milestone);
    error AlreadyClaimed(address player, uint8 milestone);
    error ZeroAddress();

    event MilestoneMinted(address indexed to, uint8 indexed milestone, uint256 indexed tokenId);
    event BaseURIUpdated(string indexed newBaseURI);

    constructor(
        string memory baseMetadataURI_,
        address admin_,
        address minter_
    ) ERC1155("") {
        if (admin_ == address(0) || minter_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(MINTER_ROLE, minter_);
        _baseMetadataURI = baseMetadataURI_;
    }

    function setBaseMetadataURI(string calldata newBaseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseMetadataURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    function uri(uint256 tokenId) public view override returns (string memory) {
        return string.concat(_baseMetadataURI, Strings.toString(tokenId), ".json");
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Mint one milestone NFT to player. Callable by backend signer/relayer.
    /// @param to Recipient wallet.
    /// @param milestone Milestone number from 1..4 (5/10/15/20 stages).
    function mintMilestone(address to, uint8 milestone) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (milestone == 0 || milestone > MAX_MILESTONE) revert InvalidMilestone(milestone);
        if (hasClaimed[milestone][to]) revert AlreadyClaimed(to, milestone);

        hasClaimed[milestone][to] = true;
        _mint(to, milestone, 1, "");
        emit MilestoneMinted(to, milestone, milestone);
    }
}
