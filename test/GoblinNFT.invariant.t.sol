// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {GoblinNFT} from "../src/GoblinNFT.sol";

/// @dev Pre-release only (eight actors can mint at most 160 tokens, so the collection never sells out): every
///      deposit stays in the pool, no token is ever credited, refunds forfeit nothing and claims settle nothing.
contract NFTHandler is Test {
    GoblinNFT public nft;
    address[8] public actors;
    mapping(uint256 => address) public holder;
    uint256 public live;
    uint256 public deposited;
    uint256 public minted;
    uint256 public refunded;
    uint256 public claimCalls;

    constructor() {
        nft = new GoblinNFT(address(this));
        for (uint256 i; i < 8; ++i) {
            actors[i] = address(uint160(0x8000 + i));
            vm.deal(actors[i], 1000 ether);
        }
        vm.deal(address(this), 1_000_000 ether);
    }

    function mint(uint256 actor, uint256 quantity) external {
        address to = actors[actor % 8];
        uint256 remaining = 20 - nft.mintedBy(to);
        if (remaining == 0) return;
        quantity = bound(quantity, 1, remaining);
        uint256 first = nft.nextTokenId();
        vm.prank(to);
        nft.mint{value: quantity * 0.001 ether}(quantity);
        live += quantity;
        minted += quantity;
        for (uint256 id = first; id < first + quantity; ++id) {
            holder[id] = to;
        }
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 1 ether);
        deposited += amount;
        nft.depositRevenue{value: amount}();
    }

    function refund(uint256 rawId) external {
        if (minted == 0) return;
        uint256 id = bound(rawId, 1, minted);
        address who = holder[id];
        if (who == address(0)) return;
        holder[id] = address(0);
        --live;
        ++refunded;
        uint256 before = who.balance;
        vm.prank(who);
        nft.refund(id);
        // Full price, nothing more: a refundable token never carries revenue out.
        assertEq(who.balance - before, 0.001 ether);
    }

    function claim(uint256 rawId) external {
        if (minted == 0) return;
        uint256 id = bound(rawId, 1, minted);
        address who = holder[id];
        if (who == address(0)) return;
        ++claimCalls;
        uint256[] memory ids = new uint256[](2);
        ids[0] = id;
        ids[1] = id;
        uint256 before = who.balance;
        vm.prank(who);
        assertEq(nft.claimRevenue(ids), 0);
        assertEq(who.balance, before);
    }

    function transfer(uint256 rawId, uint256 recipient) external {
        if (minted == 0) return;
        uint256 id = bound(rawId, 1, minted);
        address who = holder[id];
        if (who == address(0)) return;
        address to = actors[recipient % 8];
        holder[id] = to;
        vm.prank(who);
        nft.transferFrom(who, to, id);
    }
}

/// forge-config: default.invariant.runs = 128
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract GoblinNFTInvariantTest is Test {
    NFTHandler handler;
    GoblinNFT nft;

    function setUp() public {
        handler = new NFTHandler();
        nft = handler.nft();
        bytes4[] memory methods = new bytes4[](5);
        methods[0] = handler.mint.selector;
        methods[1] = handler.deposit.selector;
        methods[2] = handler.refund.selector;
        methods[3] = handler.claim.selector;
        methods[4] = handler.transfer.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), methods));
    }

    function invariant_revenueAndRefundBackingMatchIndependentLedger() public view {
        assertFalse(nft.released());
        uint256 live = handler.live();
        uint256 deposited = handler.deposited();
        assertEq(nft.liveSupply(), live);
        assertEq(nft.totalRevenueDeposited(), deposited);
        // Before release nothing is credited, claimed or retained: the whole deposit is the pool.
        assertEq(nft.deferredRevenue(), deposited);
        assertEq(nft.totalRevenueClaimed(), 0);
        assertEq(nft.retainedRevenue(), 0);
        assertEq(nft.revenuePerToken(), 0);
        uint256 share = live == 0 ? 0 : deposited / live;
        uint256 pending;
        for (uint256 id = 1; id <= handler.minted(); ++id) {
            if (handler.holder(id) != address(0)) {
                assertEq(nft.ownerOf(id), handler.holder(id));
                assertEq(nft.pendingRevenue(id), share);
                pending += share;
            } else {
                assertEq(nft.pendingRevenue(id), 0);
            }
        }
        // Provisional shares differ from the pool only by the division dust; with nobody live, nothing is shown.
        assertEq(pending, live == 0 ? 0 : share * live);
        if (live > 0) assertGt(pending + live, deposited);
        assertEq(address(nft).balance, live * 0.001 ether + deposited);
        for (uint256 i; i < 8; ++i) {
            assertLe(nft.mintedBy(handler.actors(i)), 20);
        }
        assertLe(nft.liveSupply(), 10_000);
    }
}
