// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {CardVaultNFT} from "../src/CardVaultNFT.sol";
import {CardMarketplace} from "../src/CardMarketplace.sol";

interface Vm {
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function deal(address, uint256) external;
    function warp(uint256) external;
    function expectRevert() external;
    function chainId(uint256) external;
}
contract RejectBuyer { function buy(CardMarketplace m, CardMarketplace.Quote calldata q, bytes calldata sig) external payable { m.buyListing{value: msg.value}(q, sig); } }
contract ReentrantSeller {
    CardMarketplace market; bool public blocked;
    constructor(CardMarketplace target) { market=target; }
    function onERC721Received(address,address,uint256,bytes calldata) external pure returns(bytes4){return 0x150b7a02;}
    function list(CardVaultNFT nft,uint256 id) external returns(uint256){nft.approve(address(market),id);return market.createListing(id,5 ether,block.timestamp+1 days);}
    function withdraw() external {market.withdrawProceeds(payable(address(this)));}
    receive() external payable {(bool ok,)=address(market).call(abi.encodeCall(market.withdrawProceeds,(payable(address(this)))));blocked=!ok;}
}
contract CardRwaTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    CardVaultNFT nft; CardMarketplace market;
    address seller = address(0x111); address buyer = address(0x222);
    uint256 signerKey = 0x12345; uint256 token;
    receive() external payable {}
    function setUp() public {
        nft = new CardVaultNFT(address(this)); market = new CardMarketplace(address(nft), address(this), vm.addr(signerKey));
        token = nft.mint(seller, keccak256("physical1"), keccak256("metadata1"), "https://example.test/demo/1");
        vm.deal(buyer, 100 ether); vm.deal(address(this), 100 ether);
    }
    function list() internal returns(uint256) {
        vm.startPrank(seller); nft.approve(address(market), token);
        uint256 id = market.createListing(token, 5 ether, block.timestamp + 1 days); vm.stopPrank(); return id;
    }
    function quote(uint256 id, address who) internal view returns(CardMarketplace.Quote memory) {
        return CardMarketplace.Quote(keccak256("quote1"), id, address(nft), token, who, who, seller, 5 ether, block.timestamp + 60, keccak256("policy1"));
    }
    function signature(CardMarketplace.Quote memory q) internal returns(bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, market.quoteDigest(q)); return abi.encodePacked(r,s,v);
    }
    function buy(CardMarketplace.Quote memory q, bytes memory sig, uint256 amount) internal { vm.prank(buyer); market.buyListing{value:amount}(q,sig); }
    function testAtomicPurchaseAndWithdraw() public {
        uint256 id = list(); CardMarketplace.Quote memory q = quote(id,buyer); buy(q,signature(q),5 ether);
        require(nft.ownerOf(token)==buyer && market.proceeds(seller)==5 ether && address(market).balance==5 ether);
        vm.prank(seller); market.withdrawProceeds(payable(seller)); require(seller.balance==5 ether && market.proceeds(seller)==0);
    }
    function testDuplicateMintAndUnauthorizedMint() public {
        vm.expectRevert(); nft.mint(seller,keccak256("physical1"),keccak256("x"),"uri");
        vm.prank(buyer); vm.expectRevert(); nft.mint(buyer,keccak256("physical2"),keccak256("x"),"uri");
    }
    function testCannotListWithoutApproval() public { vm.prank(seller); vm.expectRevert(); market.createListing(token,5 ether,block.timestamp+60); }
    function testRejectUnsolicitedSafeDeposit() public { vm.prank(seller); vm.expectRevert(); nft.safeTransferFrom(seller,address(market),token); }
    function testCancelWinsPurchase() public {
        uint256 id=list(); CardMarketplace.Quote memory q=quote(id,buyer); bytes memory sig=signature(q);
        vm.prank(seller); market.cancelListing(id); vm.expectRevert(); buy(q,sig,5 ether); require(nft.ownerOf(token)==seller);
    }
    function testReplayFails() public {
        CardMarketplace.Quote memory q=quote(list(),buyer); bytes memory sig=signature(q); buy(q,sig,5 ether);
        vm.expectRevert(); buy(q,sig,5 ether); require(market.proceeds(seller)==5 ether);
    }
    function testWrongPriceBuyerAndExpiredQuote() public {
        CardMarketplace.Quote memory q=quote(list(),buyer); bytes memory sig=signature(q);
        vm.expectRevert(); buy(q,sig,4 ether);
        vm.prank(seller); vm.expectRevert(); market.buyListing{value:5 ether}(q,sig);
        vm.warp(block.timestamp+61); vm.expectRevert(); buy(q,sig,5 ether);
    }
    function testMutatedQuoteAndWrongChain() public {
        CardMarketplace.Quote memory q=quote(list(),buyer); bytes memory sig=signature(q);
        q.recipient=seller; vm.expectRevert(); buy(q,sig,5 ether); q.recipient=buyer;
        vm.chainId(999); vm.expectRevert(); buy(q,sig,5 ether);
    }
    function testReceiverFailureRollsBackMoneyAndNft() public {
        RejectBuyer receiver = new RejectBuyer(); CardMarketplace.Quote memory q=quote(list(),address(receiver)); bytes memory sig=signature(q);
        vm.expectRevert(); receiver.buy{value:5 ether}(market,q,sig);
        require(nft.ownerOf(token)==address(market) && market.proceeds(seller)==0 && !market.usedQuotes(q.quoteId));
    }
    function testPauseAllowsMarketCancellation() public {
        uint256 id=list(); market.setPaused(true); vm.prank(seller); market.cancelListing(id); require(nft.ownerOf(token)==seller);
    }
    function testRedemptionLockCancelAndBurn() public {
        bytes32 id=keccak256("redemption"); vm.prank(seller); nft.requestRedemption(token,id); require(nft.ownerOf(token)==address(nft));
        vm.prank(seller); vm.expectRevert(); nft.transferFrom(address(nft),buyer,token);
        vm.prank(seller); nft.cancelRedemption(id); require(nft.ownerOf(token)==seller);
        id=keccak256("redemption2"); vm.prank(seller); nft.requestRedemption(token,id); nft.approveRelease(id);
        vm.prank(seller); vm.expectRevert(); nft.cancelRedemption(id);
        nft.finalizeRedemption(id); vm.expectRevert(); nft.ownerOf(token); vm.expectRevert(); nft.finalizeRedemption(id);
        vm.expectRevert(); nft.mint(seller,keccak256("physical1"),keccak256("x"),"uri");
    }
    function testRedemptionAbortAndUnauthorizedCustody() public {
        bytes32 id=keccak256("redemption"); vm.prank(seller); nft.requestRedemption(token,id);
        vm.prank(buyer); vm.expectRevert(); nft.approveRelease(id);
        nft.approveRelease(id); nft.abortRelease(id); vm.prank(seller); nft.cancelRedemption(id); require(nft.ownerOf(token)==seller);
    }
    function testWithdrawalReentrancyDoesNotDuplicateProceeds() public {
        ReentrantSeller attacker=new ReentrantSeller(market);
        token=nft.mint(address(attacker),keccak256("physical2"),keccak256("metadata2"),"uri");
        uint256 id=attacker.list(nft,token);CardMarketplace.Quote memory q=quote(id,buyer);q.seller=address(attacker);
        buy(q,signature(q),5 ether);attacker.withdraw();
        require(attacker.blocked()&&address(attacker).balance==5 ether&&market.proceeds(address(attacker))==0);
    }
    function testUnauthorizedQuoteSignerFails() public {
        CardMarketplace.Quote memory q=quote(list(),buyer);
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(0x999,market.quoteDigest(q));
        vm.expectRevert();buy(q,abi.encodePacked(r,s,v),5 ether);
        require(market.proceeds(seller)==0&&nft.ownerOf(token)==address(market));
    }
    function testFuzzDuplicatePhysicalIdentity(bytes32 physicalHash) public {
        if(physicalHash==bytes32(0)||physicalHash==keccak256("physical1"))return;
        nft.mint(seller,physicalHash,keccak256("metadata"),"uri");
        vm.expectRevert();nft.mint(buyer,physicalHash,keccak256("metadata"),"uri");
    }
}
