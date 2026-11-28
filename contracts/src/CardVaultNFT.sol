// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Demonstration custody claims; no assertion of physical verification.
contract CardVaultNFT is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");
    uint256 public nextTokenId = 1;
    bool public paused;
    bool private custodyMovement;
    mapping(bytes32 => bool) public usedPhysicalCards;
    mapping(uint256 => bytes32) public physicalCardHashes;
    mapping(uint256 => bytes32) public metadataDigests;
    mapping(uint256 => string) private uris;
    struct Redemption { uint256 tokenId; address claimant; uint8 status; }
    mapping(bytes32 => Redemption) public redemptions;
    mapping(uint256 => bytes32) public tokenRedemption;
    event CardMinted(uint256 indexed tokenId, bytes32 indexed physicalCardHash, bytes32 metadataDigest);
    event RedemptionChanged(bytes32 indexed requestId, uint256 indexed tokenId, address indexed claimant, uint8 status);
    event Paused(bool value);
    error InvalidState();

    constructor(address admin) ERC721("Agentic TCG Vault", "TCGV") {
        require(admin != address(0));
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(CUSTODIAN_ROLE, admin);
    }
    function supportsInterface(bytes4 id) public view override(ERC721, AccessControl) returns (bool) { return super.supportsInterface(id); }
    function setPaused(bool value) external onlyRole(DEFAULT_ADMIN_ROLE) { paused = value; emit Paused(value); }
    function mint(address to, bytes32 physicalHash, bytes32 digest, string calldata uri) external onlyRole(MINTER_ROLE) returns (uint256 id) {
        if (paused || physicalHash == bytes32(0) || digest == bytes32(0) || usedPhysicalCards[physicalHash] || bytes(uri).length == 0) revert InvalidState();
        usedPhysicalCards[physicalHash] = true;
        id = nextTokenId++;
        physicalCardHashes[id] = physicalHash; metadataDigests[id] = digest; uris[id] = uri;
        _safeMint(to, id);
        emit CardMinted(id, physicalHash, digest);
    }
    function tokenURI(uint256 id) public view override returns (string memory) { _requireOwned(id); return uris[id]; }
    function requestRedemption(uint256 id, bytes32 requestId) external {
        if (paused || ownerOf(id) != msg.sender || requestId == bytes32(0) || redemptions[requestId].status != 0) revert InvalidState();
        redemptions[requestId] = Redemption(id, msg.sender, 1); tokenRedemption[id] = requestId;
        custodyMovement = true; _transfer(msg.sender, address(this), id); custodyMovement = false;
        emit RedemptionChanged(requestId, id, msg.sender, 1);
    }
    function cancelRedemption(bytes32 requestId) external {
        Redemption storage r = redemptions[requestId];
        if (r.status != 1 || r.claimant != msg.sender) revert InvalidState();
        r.status = 4; delete tokenRedemption[r.tokenId];
        custodyMovement = true; _transfer(address(this), r.claimant, r.tokenId); custodyMovement = false;
        emit RedemptionChanged(requestId, r.tokenId, r.claimant, 4);
    }
    function approveRelease(bytes32 requestId) external onlyRole(CUSTODIAN_ROLE) {
        Redemption storage r = redemptions[requestId]; if (r.status != 1) revert InvalidState();
        r.status = 2; emit RedemptionChanged(requestId, r.tokenId, r.claimant, 2);
    }
    function abortRelease(bytes32 requestId) external onlyRole(CUSTODIAN_ROLE) {
        Redemption storage r = redemptions[requestId]; if (r.status != 2) revert InvalidState();
        r.status = 1; emit RedemptionChanged(requestId, r.tokenId, r.claimant, 1);
    }
    function finalizeRedemption(bytes32 requestId) external onlyRole(CUSTODIAN_ROLE) {
        Redemption storage r = redemptions[requestId]; if (r.status != 2) revert InvalidState();
        r.status = 3; delete tokenRedemption[r.tokenId];
        custodyMovement = true; _burn(r.tokenId); custodyMovement = false;
        emit RedemptionChanged(requestId, r.tokenId, r.claimant, 3);
    }
    function _update(address to, uint256 id, address auth) internal override returns (address) {
        if (!custodyMovement && (paused || to == address(this) || _ownerOf(id) == address(this))) revert InvalidState();
        return super._update(to, id, auth);
    }
}
