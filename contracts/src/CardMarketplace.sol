// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract CardMarketplace is AccessControl, EIP712, ReentrancyGuard, IERC721Receiver {
    bytes32 public constant QUOTE_SIGNER_ROLE = keccak256("QUOTE_SIGNER_ROLE");
    bytes32 public constant QUOTE_TYPEHASH = keccak256("Quote(bytes32 quoteId,uint256 listingId,address nft,uint256 tokenId,address buyer,address recipient,address seller,uint256 amount,uint256 deadline,bytes32 policyHash)");
    IERC721 public immutable nft;
    bool public paused;
    uint256 public nextListingId = 1;
    uint256 private expectedToken;
    address private expectedSeller;
    struct Listing { uint256 tokenId; address seller; uint256 price; uint256 expiresAt; uint8 status; }
    struct Quote { bytes32 quoteId; uint256 listingId; address nft; uint256 tokenId; address buyer; address recipient; address seller; uint256 amount; uint256 deadline; bytes32 policyHash; }
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => uint256) public activeListing;
    mapping(bytes32 => bool) public usedQuotes;
    mapping(address => uint256) public proceeds;
    event ListingCreated(uint256 indexed listingId, uint256 indexed tokenId, address indexed seller, uint256 price, uint256 expiresAt);
    event ListingCancelled(uint256 indexed listingId, uint256 indexed tokenId, address indexed seller);
    event PurchaseExecuted(bytes32 indexed quoteId, uint256 indexed listingId, address indexed buyer, address recipient, address seller, address nft, uint256 tokenId, uint256 amount);
    event ProceedsWithdrawn(address indexed seller, address indexed to, uint256 amount);
    error InvalidState();

    constructor(address token, address admin, address quoteSigner) EIP712("AgenticTCGMarketplace", "1") {
        require(token != address(0) && admin != address(0) && quoteSigner != address(0));
        nft = IERC721(token); _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(QUOTE_SIGNER_ROLE, quoteSigner);
    }
    function setPaused(bool value) external onlyRole(DEFAULT_ADMIN_ROLE) { paused = value; }
    function createListing(uint256 tokenId, uint256 price, uint256 expiresAt) external nonReentrant returns (uint256 id) {
        if (paused || price == 0 || expiresAt <= block.timestamp || activeListing[tokenId] != 0 || nft.ownerOf(tokenId) != msg.sender) revert InvalidState();
        id = nextListingId++; listings[id] = Listing(tokenId, msg.sender, price, expiresAt, 1); activeListing[tokenId] = id;
        expectedToken = tokenId; expectedSeller = msg.sender;
        nft.safeTransferFrom(msg.sender, address(this), tokenId);
        expectedSeller = address(0); expectedToken = 0;
        emit ListingCreated(id, tokenId, msg.sender, price, expiresAt);
    }
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(nft) || operator != address(this) || from != expectedSeller || expectedSeller == address(0) || tokenId != expectedToken) revert InvalidState();
        return IERC721Receiver.onERC721Received.selector;
    }
    function cancelListing(uint256 id) external nonReentrant {
        Listing storage l = listings[id]; if (l.status != 1 || l.seller != msg.sender) revert InvalidState();
        l.status = 3; delete activeListing[l.tokenId]; nft.safeTransferFrom(address(this), l.seller, l.tokenId);
        emit ListingCancelled(id, l.tokenId, l.seller);
    }
    function quoteDigest(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q.quoteId, q.listingId, q.nft, q.tokenId, q.buyer, q.recipient, q.seller, q.amount, q.deadline, q.policyHash)));
    }
    function buyListing(Quote calldata q, bytes calldata signature) external payable nonReentrant {
        Listing storage l = listings[q.listingId];
        if (paused || l.status != 1 || l.expiresAt < block.timestamp || q.deadline < block.timestamp || q.quoteId == bytes32(0) || usedQuotes[q.quoteId] || q.buyer != msg.sender || q.recipient != msg.sender || q.nft != address(nft) || q.tokenId != l.tokenId || q.seller != l.seller || q.amount != l.price || msg.value != l.price || nft.ownerOf(l.tokenId) != address(this) || !hasRole(QUOTE_SIGNER_ROLE, ECDSA.recover(quoteDigest(q), signature))) revert InvalidState();
        usedQuotes[q.quoteId] = true; l.status = 2; delete activeListing[l.tokenId]; proceeds[l.seller] += msg.value;
        nft.safeTransferFrom(address(this), q.recipient, l.tokenId);
        emit PurchaseExecuted(q.quoteId, q.listingId, q.buyer, q.recipient, q.seller, address(nft), q.tokenId, q.amount);
    }
    function withdrawProceeds(address payable to) external nonReentrant {
        uint256 amount = proceeds[msg.sender]; if (amount == 0 || to == address(0)) revert InvalidState();
        proceeds[msg.sender] = 0; (bool ok,) = to.call{value: amount}(""); require(ok);
        emit ProceedsWithdrawn(msg.sender, to, amount);
    }
}
