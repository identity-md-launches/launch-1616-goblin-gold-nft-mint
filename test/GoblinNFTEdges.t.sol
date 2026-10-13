// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {GoblinNFT} from "../src/GoblinNFT.sol";

contract EdgeTarget {
    bool public reject;

    function setReject(bool v) external {
        reject = v;
    }

    function pull(GoblinNFT nft) external returns (uint256) {
        return nft.claimRelease();
    }

    receive() external payable {
        require(!reject, "rejected");
    }
}

/// @dev A holder whose receive hook tries every value-moving entry point again.
contract ReentrantHolder {
    GoblinNFT public nft;
    uint256 public attempts;
    uint256 public successes;
    uint256 public targetId;

    constructor(GoblinNFT n) {
        nft = n;
    }

    function mint(uint256 q) external payable {
        nft.mint{value: msg.value}(q);
    }

    function claim(uint256 id) external {
        targetId = id;
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        nft.claimRevenue(ids);
    }

    function refundSelf(uint256 id) external {
        targetId = id;
        nft.refund(id);
    }

    receive() external payable {
        if (attempts > 0) return;
        attempts++;
        uint256[] memory ids = new uint256[](1);
        ids[0] = targetId;
        try nft.claimRevenue(ids) {
            successes++;
        } catch {}
        try nft.refund(targetId) {
            successes++;
        } catch {}
    }
}

contract GoblinNFTEdgesTest is Test {
    address constant OWNER = 0xA7e99BB7155D7477E0C838E201b16E62B9c0b5Ac;
    GoblinNFT nft;
    EdgeTarget pol;
    EdgeTarget res;
    EdgeTarget vrf;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        nft = new GoblinNFT(OWNER);
        pol = new EdgeTarget();
        res = new EdgeTarget();
        vrf = new EdgeTarget();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _mintAs(address who, uint256 q) internal {
        vm.prank(who);
        nft.mint{value: q * 0.001 ether}(q);
    }

    /// @dev Mints the whole supply from 500 wallets; the last mint is done by `last` when given.
    function _sellOut() internal {
        uint256 remaining = nft.MAX_SUPPLY() - nft.liveSupply();
        uint256 i;
        while (remaining > 0) {
            address m = address(uint160(0xB0000 + i++));
            uint256 q = remaining > 20 ? 20 : remaining;
            vm.deal(m, 1 ether);
            vm.prank(m);
            nft.mint{value: q * 0.001 ether}(q);
            remaining -= q;
        }
        assertTrue(nft.soldOut());
    }

    function _setTargets() internal {
        vm.prank(OWNER);
        nft.setLaunchTargets(address(pol), address(res), address(vrf));
    }

    // ------------------------------------------------------------ mint failure paths

    function testMintRejectsZeroQuantity() public {
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.BadQuantity.selector);
        nft.mint(0);
    }

    function testMintRejectsUnderAndOverPayment() public {
        vm.startPrank(alice);
        vm.expectRevert(GoblinNFT.WrongPayment.selector);
        nft.mint{value: 0.001 ether - 1}(1);
        vm.expectRevert(GoblinNFT.WrongPayment.selector);
        nft.mint{value: 0.001 ether + 1}(1);
        vm.expectRevert(GoblinNFT.WrongPayment.selector);
        nft.mint{value: 0}(1);
        vm.stopPrank();
        assertEq(address(nft).balance, 0);
    }

    function testMintQuantityOverflowRevertsWithoutMinting() public {
        vm.prank(alice);
        vm.expectRevert(); // quantity * PRICE overflows
        nft.mint(type(uint256).max);
        assertEq(nft.liveSupply(), 0);
    }

    function testWalletLimitCountsRefundedMints() public {
        _mintAs(alice, 20);
        vm.prank(alice);
        nft.refund(1);
        assertEq(nft.mintedBy(alice), 20);
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.WalletLimit.selector);
        nft.mint{value: 0.001 ether}(1);
    }

    function testExceedsSupplyAndMintClosedAfterSellout() public {
        // fill to 9_990, then a 20-mint must fail with ExceedsSupply
        for (uint256 i; i < 499; ++i) {
            address m = address(uint160(0xC0000 + i));
            vm.deal(m, 1 ether);
            _mintAs(m, 20);
        }
        _mintAs(alice, 10);
        assertEq(nft.liveSupply(), 9_990);
        vm.prank(bob);
        vm.expectRevert(GoblinNFT.ExceedsSupply.selector);
        nft.mint{value: 0.011 ether}(11);
        _mintAs(bob, 10);
        assertTrue(nft.soldOut());
        assertEq(nft.soldOutAt(), block.timestamp);
        assertEq(nft.revealBlock(), block.number + 1);
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.MintClosed.selector);
        nft.mint{value: 0.001 ether}(1);

        // Refunds after sellout (in a review) never reopen the mint.
        _setTargets();
        vm.prank(bob);
        nft.refund(10_000);
        assertEq(nft.liveSupply(), 9_999);
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.MintClosed.selector);
        nft.mint{value: 0.001 ether}(1);
    }

    // ------------------------------------------------------------ refund failure paths

    function testRefundRejectsNonHolderNonexistentAndBurned() public {
        _mintAs(alice, 2);
        vm.prank(bob);
        vm.expectRevert(GoblinNFT.NotHolder.selector);
        nft.refund(1);
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.NotHolder.selector);
        nft.refund(99);
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.NotHolder.selector);
        nft.refund(0);
        vm.prank(alice);
        nft.refund(1);
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.NotHolder.selector);
        nft.refund(1);
        assertEq(address(nft).balance, 0.001 ether);
    }

    function testApprovedOperatorCannotRefundSomeoneElsesToken() public {
        _mintAs(alice, 1);
        vm.prank(alice);
        nft.setApprovalForAll(bob, true);
        vm.prank(bob);
        vm.expectRevert(GoblinNFT.NotHolder.selector);
        nft.refund(1);
    }

    function testRefundsClosedBetweenSelloutAnd90DaysThenReviewBoundaries() public {
        _mintAs(alice, 1);
        _sellOut();
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.RefundsClosed.selector);
        nft.refund(1);

        vm.warp(block.timestamp + 10 days);
        _setTargets();
        uint256 setAt = block.timestamp;
        assertTrue(nft.refundsOpen());
        vm.warp(setAt + 7 days - 1);
        assertTrue(nft.refundsOpen());
        vm.warp(setAt + 7 days);
        assertFalse(nft.refundsOpen());
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.RefundsClosed.selector);
        nft.refund(1);

        // A later target change reopens the review even after a closed gap.
        _setTargets();
        vm.prank(alice);
        nft.refund(1);
    }

    // ------------------------------------------------------------ release failure paths

    function testReleaseGuards() public {
        vm.expectRevert(GoblinNFT.NotSoldOut.selector);
        nft.release();
        _sellOut();
        vm.expectRevert(GoblinNFT.TargetsNotSet.selector);
        nft.release();
        _setTargets();
        vm.warp(block.timestamp + 7 days - 1);
        vm.expectRevert(GoblinNFT.ReviewPending.selector);
        nft.release();
        vm.warp(block.timestamp + 1);
        nft.release();
        vm.expectRevert(GoblinNFT.AlreadyReleased.selector);
        nft.release();
        assertEq(nft.polOwed(), 5 ether);
        assertEq(nft.reserveOwed(), 4 ether);
        assertEq(nft.vrfOwed(), 1 ether);

        vm.prank(OWNER);
        vm.expectRevert(GoblinNFT.AlreadyReleased.selector);
        nft.setLaunchTargets(address(pol), address(res), address(vrf));
        assertFalse(nft.refundsOpen());
        vm.warp(block.timestamp + 365 days);
        assertFalse(nft.refundsOpen(), "released escrow never reopens refunds");
    }

    function testSetLaunchTargetsGuards() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        nft.setLaunchTargets(address(pol), address(res), address(vrf));

        vm.startPrank(OWNER);
        vm.expectRevert(GoblinNFT.ZeroAddress.selector);
        nft.setLaunchTargets(address(0), address(res), address(vrf));
        vm.expectRevert(GoblinNFT.ZeroAddress.selector);
        nft.setLaunchTargets(address(pol), address(0), address(vrf));
        vm.expectRevert(GoblinNFT.ZeroAddress.selector);
        nft.setLaunchTargets(address(pol), address(res), address(0));
        vm.expectRevert(GoblinNFT.TargetNotContract.selector);
        nft.setLaunchTargets(address(pol), alice, address(vrf));
        vm.stopPrank();
        assertFalse(nft.targetsSet());
    }

    function testOwnershipCannotGoToZeroOrBeRenouncedEarlyByAnyone() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        nft.transferOwnership(address(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        nft.renounceOwnership();
        vm.prank(OWNER);
        vm.expectRevert(GoblinNFT.NotReleased.selector);
        nft.renounceOwnership();
        assertEq(nft.owner(), OWNER);
    }

    function testClaimReleaseGuardsAndRejectingTargetDoesNotBlockOthers() public {
        _sellOut();
        _setTargets();
        vm.expectRevert(GoblinNFT.NothingOwed.selector);
        pol.pull(nft); // nothing released yet
        vm.warp(block.timestamp + 7 days);
        nft.release();

        vm.prank(alice);
        vm.expectRevert(GoblinNFT.NothingOwed.selector);
        nft.claimRelease();
        vm.prank(OWNER);
        vm.expectRevert(GoblinNFT.NothingOwed.selector);
        nft.claimRelease();

        res.setReject(true);
        vm.expectRevert(GoblinNFT.TransferFailed.selector);
        res.pull(nft);
        assertEq(nft.releaseOwed(address(res)), 4 ether, "failed pull keeps the credit");

        assertEq(pol.pull(nft), 5 ether);
        assertEq(vrf.pull(nft), 1 ether);
        vm.expectRevert(GoblinNFT.NothingOwed.selector);
        pol.pull(nft);
        res.setReject(false);
        assertEq(res.pull(nft), 4 ether);
        assertEq(address(nft).balance, 0);
    }

    function testReleaseSplitRoundingNeverLosesWei() public {
        _sellOut();
        // Leave an odd live supply so the split exercises the remainder path.
        vm.warp(block.timestamp + 90 days);
        for (uint256 id = 1; id <= 3; ++id) {
            vm.prank(nft.ownerOf(id));
            nft.refund(id);
        }
        _setTargets();
        vm.warp(block.timestamp + 7 days);
        nft.release();
        uint256 amount = 9_997 * 0.001 ether;
        assertEq(nft.polOwed() + nft.reserveOwed() + nft.vrfOwed(), amount);
        assertEq(address(nft).balance, amount);
    }

    // ------------------------------------------------------------ revenue failure paths

    function _release() internal {
        if (!nft.soldOut()) _sellOut();
        _setTargets();
        vm.warp(block.timestamp + 7 days);
        nft.release();
    }

    function testRevenueGuardsBeforeRelease() public {
        vm.expectRevert(GoblinNFT.WrongPayment.selector);
        nft.depositRevenue{value: 0}();

        _mintAs(alice, 2);
        uint256[] memory none = new uint256[](0);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        nft.depositRevenue{value: 1 ether}();
        assertEq(nft.deferredRevenue(), 1 ether);
        assertEq(nft.revenuePerToken(), 0, "nothing accrues to a refundable token");
        assertEq(nft.pendingRevenue(1), 0.5 ether, "provisional share is shown");

        // Before release a claim settles nothing and pays nothing, but a foreign id still reverts.
        uint256 before = alice.balance;
        vm.prank(alice);
        assertEq(nft.claimRevenue(none), 0);
        vm.prank(alice);
        assertEq(nft.claimRevenue(ids), 0);
        assertEq(alice.balance, before);
        assertEq(nft.totalRevenueClaimed(), 0);
        vm.prank(bob);
        vm.expectRevert(GoblinNFT.NotHolder.selector);
        nft.claimRevenue(ids);

        // A refund forfeits nothing: the pool stays whole for the remaining holders.
        vm.prank(alice);
        nft.refund(2);
        assertEq(nft.deferredRevenue(), 1 ether);
        assertEq(nft.retainedRevenue(), 0);
        assertEq(nft.pendingRevenue(1), 1 ether);
        assertEq(nft.pendingRevenue(2), 0);
    }

    function testRevenueGuardsAfterRelease() public {
        _mintAs(alice, 2);
        _mintAs(bob, 1);
        _release();
        uint256[] memory none = new uint256[](0);
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.NothingOwed.selector);
        nft.claimRevenue(none);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.NothingOwed.selector);
        nft.claimRevenue(ids);

        nft.depositRevenue{value: 10 ether}(); // 0.001 ether per token
        vm.prank(bob);
        vm.expectRevert(GoblinNFT.NotHolder.selector);
        nft.claimRevenue(ids);

        // One foreign id in the batch reverts the whole batch.
        uint256[] memory mixed = new uint256[](2);
        mixed[0] = 1;
        mixed[1] = 3;
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.NotHolder.selector);
        nft.claimRevenue(mixed);

        vm.prank(alice);
        assertEq(nft.claimRevenue(ids), 0.001 ether);
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.NothingOwed.selector);
        nft.claimRevenue(ids);
        assertEq(nft.pendingRevenue(10_001), 0);
    }

    function testDepositSmallerThanSupplyIsAllRetained() public {
        _mintAs(alice, 3);
        nft.depositRevenue{value: 2}(); // deferred until release
        assertEq(nft.retainedRevenue(), 0);
        _release();
        assertEq(nft.deferredRevenue(), 0);
        assertEq(nft.revenuePerToken(), 0);
        assertEq(nft.retainedRevenue(), 2, "pool smaller than supply is retained at release");
        nft.depositRevenue{value: 9_999}();
        assertEq(nft.revenuePerToken(), 0);
        assertEq(nft.retainedRevenue(), 10_001);
    }

    function testRevenueFollowsTokenAcrossTransferAndRevertsForRejectingHolder() public {
        _mintAs(alice, 1);
        nft.depositRevenue{value: 10 ether}(); // pre-release pool, 0.001 ether per token at release
        _release();
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(alice);
        vm.expectRevert(GoblinNFT.NotHolder.selector);
        nft.claimRevenue(ids);
        uint256 before = bob.balance;
        vm.prank(bob);
        nft.claimRevenue(ids);
        assertEq(bob.balance - before, 0.001 ether);

        EdgeTarget rejecting = new EdgeTarget();
        rejecting.setReject(true);
        vm.prank(bob);
        nft.transferFrom(bob, address(rejecting), 1);
        nft.depositRevenue{value: 10 ether}();
        vm.prank(address(rejecting));
        vm.expectRevert(GoblinNFT.TransferFailed.selector);
        nft.claimRevenue(ids);
        assertEq(nft.pendingRevenue(1), 0.001 ether, "failed claim keeps the revenue");
    }

    function testReentrantHolderGainsNothingOnRefund() public {
        ReentrantHolder h = new ReentrantHolder(nft);
        vm.deal(address(h), 1 ether);
        h.mint{value: 0.002 ether}(2);
        nft.depositRevenue{value: 1 ether}();
        uint256 before = address(h).balance;
        h.refundSelf(1);
        assertEq(h.attempts(), 1);
        assertEq(h.successes(), 0, "claim and refund re-entry both blocked");
        assertEq(address(h).balance - before, 0.001 ether);
        assertEq(nft.liveSupply(), 1);
        assertEq(nft.deferredRevenue(), 1 ether);
    }

    function testReentrantHolderGainsNothingOnClaim() public {
        ReentrantHolder h = new ReentrantHolder(nft);
        vm.deal(address(h), 1 ether);
        h.mint{value: 0.001 ether}(1);
        nft.depositRevenue{value: 10 ether}();
        _release();
        uint256 before = address(h).balance;
        h.claim(1);
        assertEq(h.attempts(), 1);
        assertEq(h.successes(), 0);
        assertEq(address(h).balance - before, 0.001 ether);
        assertEq(nft.ownerOf(1), address(h));
    }

    // ------------------------------------------------------------ reveal and metadata failure paths

    function testRevealGuardsAndMetadataOfMissingTokens() public {
        vm.expectRevert(GoblinNFT.RevealNotReady.selector);
        nft.reveal();
        _mintAs(alice, 1);
        vm.expectRevert(GoblinNFT.RevealNotReady.selector);
        nft.traitsOf(1);
        vm.expectRevert(GoblinNFT.NonexistentToken.selector);
        nft.tokenURI(2);
        vm.expectRevert(GoblinNFT.NonexistentToken.selector);
        nft.tokenURI(0);

        _sellOut();
        vm.expectRevert(GoblinNFT.RevealNotReady.selector);
        nft.reveal(); // same block as sellout
        vm.roll(block.number + 1);
        vm.expectRevert(GoblinNFT.RevealNotReady.selector);
        nft.reveal(); // revealBlock itself has no hash yet
        vm.roll(block.number + 1);
        nft.reveal();
        assertTrue(nft.revealed());
        bytes32 s = nft.seed();
        assertTrue(s != bytes32(0));
        vm.expectRevert(GoblinNFT.AlreadyRevealed.selector);
        nft.reveal();
        assertEq(nft.seed(), s);
        vm.expectRevert(GoblinNFT.NonexistentToken.selector);
        nft.traitsOf(10_001);
        nft.traitsOf(10_000);
        assertGt(bytes(nft.tokenURI(10_000)).length, 100);
    }

    // ------------------------------------------------------------ accepted finding: review before sellout

    function testAcceptedFinding_ReviewEndingBeforeSelloutLetsReleaseFollowSelloutImmediately() public {
        _mintAs(alice, 1);
        _setTargets();
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        nft.refund(1); // refunds were open throughout (pre-sellout)
        _sellOut();
        assertFalse(nft.refundsOpen());
        nft.release(); // same block as sellout
        assertTrue(nft.released());
    }
}

/// @dev Starts every fuzz run from a sold-out collection with targets under review, so release-time
///      revenue arithmetic can be fuzzed without re-minting 10,000 tokens per run.
contract GoblinNFTRevenueFuzzTest is Test {
    address constant OWNER = 0xA7e99BB7155D7477E0C838E201b16E62B9c0b5Ac;
    GoblinNFT nft;

    function setUp() public {
        nft = new GoblinNFT(OWNER);
        for (uint256 i; i < 500; ++i) {
            address m = address(uint160(0xB0000 + i));
            vm.deal(m, 1 ether);
            vm.prank(m);
            nft.mint{value: 0.02 ether}(20);
        }
        EdgeTarget t = new EdgeTarget();
        vm.prank(OWNER);
        nft.setLaunchTargets(address(t), address(t), address(t));
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzzDeferredAndLiveRevenueSplitIsExact(uint256 refunds, uint256 pre, uint256 post) public {
        refunds = bound(refunds, 0, 20);
        pre = bound(pre, 1, 1_000_000 ether);
        post = bound(post, 1, 1_000_000 ether);
        address first = address(uint160(0xB0000)); // holds ids 1..20
        for (uint256 id = 1; id <= refunds; ++id) {
            vm.prank(first);
            nft.refund(id);
        }
        uint256 supply = 10_000 - refunds;
        vm.deal(address(this), pre + post);
        nft.depositRevenue{value: pre}();
        assertEq(nft.pendingRevenue(10_000), pre / supply);
        vm.warp(block.timestamp + 7 days);
        nft.release();
        assertEq(nft.deferredRevenue(), 0);
        assertEq(nft.revenuePerToken() * supply + nft.retainedRevenue(), pre);
        assertLt(nft.retainedRevenue(), supply);
        assertEq(nft.pendingRevenue(10_000), pre / supply);
        assertEq(nft.pendingRevenue(1), refunds > 0 ? 0 : pre / supply);

        nft.depositRevenue{value: post}();
        assertEq(nft.revenuePerToken() * supply + nft.retainedRevenue(), pre + post);
        assertLt(nft.retainedRevenue(), 2 * supply);
        assertEq(address(nft).balance, supply * 0.001 ether + pre + post);
    }
}

// ================================================================ lifecycle invariant (pre- and post-sellout)

contract LifecycleHandler is Test {
    GoblinNFT public nft;
    EdgeTarget[3] public targets;
    address[4] public actors;
    address public owner;

    uint256[] public liveIds;
    mapping(uint256 => uint256) internal slot; // id => index + 1

    uint256 public ghostMinted;
    uint256 public ghostRefunded;
    uint256 public ghostDeposits;
    uint256 public ghostRevenuePaid;
    uint256 public ghostReleasePulled;
    uint256 public ghostMintPaid;
    uint256 public ghostRefundPaid;
    /// @dev Sum of revenuePaid over live tokens, kept from the handler's own view of each step.
    uint256 public ghostPaidLive;
    bool public everReleased;
    bool public everSoldOut;
    uint256 public releasedAmount;

    constructor() {
        owner = address(0xA7e99BB7155D7477E0C838E201b16E62B9c0b5Ac);
        nft = new GoblinNFT(owner);
        for (uint256 i; i < 3; ++i) {
            targets[i] = new EdgeTarget();
        }
        for (uint256 i; i < 4; ++i) {
            actors[i] = address(uint160(0xD0000 + i));
            vm.deal(actors[i], 100 ether);
        }
        vm.deal(address(this), 1_000_000 ether);
        // 9,900 tokens minted once at revenuePerToken 0 by wallets the handler never drives; the
        // actors and sellOut() mint the last 100 so both pre- and post-sellout states are reached.
        for (uint256 i; i < 495; ++i) {
            address m = address(uint160(0xE0000 + i));
            vm.deal(m, 1 ether);
            vm.prank(m);
            nft.mint{value: 0.02 ether}(20);
        }
        preMinted = 9_900;
        ghostMinted = 9_900;
        ghostMintPaid = 9.9 ether;
    }

    uint256 public preMinted;

    function _doMint(address who, uint256 q) internal {
        uint256 first = nft.nextTokenId();
        uint256 acc = nft.revenuePerToken();
        vm.prank(who);
        nft.mint{value: q * 0.001 ether}(q);
        for (uint256 i; i < q; ++i) {
            liveIds.push(first + i);
            slot[first + i] = liveIds.length;
            assertEq(nft.revenuePaid(first + i), acc, "new mints settle at the current accumulator");
            assertEq(
                nft.pendingRevenue(first + i),
                nft.deferredRevenue() / nft.liveSupply(),
                "a new mint only shows its provisional share of the pre-release pool"
            );
        }
        ghostPaidLive += acc * q;
        ghostMinted += q;
        ghostMintPaid += q * 0.001 ether;
        if (nft.soldOut()) everSoldOut = true;
    }

    function _remove(uint256 id) internal {
        uint256 i = slot[id] - 1;
        uint256 last = liveIds[liveIds.length - 1];
        liveIds[i] = last;
        slot[last] = i + 1;
        liveIds.pop();
        delete slot[id];
    }

    function mint(uint256 a, uint256 q) external {
        address who = actors[a % 4];
        q = bound(q, 1, 20);
        if (nft.soldOut() || nft.mintedBy(who) + q > 20 || nft.liveSupply() + q > 10_000) return;
        _doMint(who, q);
    }

    /// @dev Fills the rest of the supply from fresh wallets so post-sellout states are reached.
    function sellOut(uint256 salt) external {
        if (nft.soldOut()) return;
        uint256 i;
        while (!nft.soldOut()) {
            address m = address(uint160(uint256(keccak256(abi.encode(salt, i++)))));
            uint256 remaining = 10_000 - nft.liveSupply();
            uint256 q = remaining > 20 ? 20 : remaining;
            if (nft.mintedBy(m) + q > 20) continue;
            vm.deal(m, 1 ether);
            _doMint(m, q);
        }
    }

    function refund(uint256 raw) external {
        if (liveIds.length == 0) return;
        uint256 id = liveIds[raw % liveIds.length];
        address holder = nft.ownerOf(id);
        if (!nft.refundsOpen()) {
            vm.prank(holder);
            vm.expectRevert(GoblinNFT.RefundsClosed.selector);
            nft.refund(id);
            return;
        }
        uint256 paidBefore = nft.revenuePaid(id);
        uint256 retainedBefore = nft.retainedRevenue();
        uint256 deferredBefore = nft.deferredRevenue();
        uint256 before = holder.balance;
        vm.prank(holder);
        nft.refund(id);
        assertEq(holder.balance - before, 0.001 ether, "refund pays exactly the price");
        assertEq(nft.retainedRevenue(), retainedBefore, "refund forfeits nothing to retained");
        assertEq(nft.deferredRevenue(), deferredBefore, "refund leaves the pool to the remaining holders");
        ghostPaidLive -= paidBefore;
        _remove(id);
        ghostRefunded++;
        ghostRefundPaid += 0.001 ether;
    }

    function transfer(uint256 raw, uint256 to) external {
        if (liveIds.length == 0) return;
        uint256 id = liveIds[raw % liveIds.length];
        address from = nft.ownerOf(id);
        address dest = actors[to % 4];
        uint256 pending = nft.pendingRevenue(id);
        vm.prank(from);
        nft.transferFrom(from, dest, id);
        assertEq(nft.pendingRevenue(id), pending, "transfer carries unpaid revenue");
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 10 ether);
        nft.depositRevenue{value: amount}();
        ghostDeposits += amount;
    }

    /// @dev Claims one or two ids of one holder; a repeated id must not pay twice.
    function claim(uint256 raw, bool duplicate) external {
        if (liveIds.length == 0) return;
        uint256 id = liveIds[raw % liveIds.length];
        address who = nft.ownerOf(id);
        uint256[] memory ids = new uint256[](duplicate ? 2 : 1);
        ids[0] = id;
        if (duplicate) ids[1] = id;
        uint256 acc = nft.revenuePerToken();
        uint256 paid = nft.revenuePaid(id);
        uint256 expected = acc - paid;
        if (expected == 0) {
            if (nft.released()) {
                vm.prank(who);
                vm.expectRevert(GoblinNFT.NothingOwed.selector);
                nft.claimRevenue(ids);
            } else {
                uint256 bal = who.balance;
                vm.prank(who);
                assertEq(nft.claimRevenue(ids), 0, "nothing is claimable before release");
                assertEq(who.balance, bal);
            }
            return;
        }
        uint256 before = who.balance;
        vm.prank(who);
        nft.claimRevenue(ids);
        assertEq(who.balance - before, expected);
        ghostPaidLive += expected;
        ghostRevenuePaid += expected;
    }

    function claimForeign(uint256 raw, uint256 a) external {
        if (liveIds.length == 0) return;
        uint256 id = liveIds[raw % liveIds.length];
        address who = actors[a % 4];
        if (nft.ownerOf(id) == who) return;
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(who);
        vm.expectRevert(GoblinNFT.NotHolder.selector);
        nft.claimRevenue(ids);
    }

    function setTargets(uint256 a, uint256 b, uint256 c) external {
        address p = address(targets[a % 3]);
        address r = address(targets[b % 3]);
        address v = address(targets[c % 3]);
        if (nft.released()) {
            vm.prank(owner);
            vm.expectRevert(GoblinNFT.AlreadyReleased.selector);
            nft.setLaunchTargets(p, r, v);
            return;
        }
        vm.prank(owner);
        nft.setLaunchTargets(p, r, v);
        assertTrue(nft.refundsOpen(), "every target change opens a review");
    }

    function warp(uint256 s) external {
        vm.warp(block.timestamp + bound(s, 1, 30 days));
    }

    function release() external {
        bool ok = nft.soldOut() && nft.targetsSet() && !nft.released() && block.timestamp >= nft.targetsSetAt() + 7 days;
        if (!ok) {
            vm.expectRevert();
            nft.release();
            return;
        }
        releasedAmount = nft.liveSupply() * 0.001 ether;
        uint256 pool = nft.deferredRevenue();
        uint256 accBefore = nft.revenuePerToken();
        uint256 retainedBefore = nft.retainedRevenue();
        nft.release();
        everReleased = true;
        assertEq(nft.deferredRevenue(), 0, "release empties the pool");
        assertEq(
            (nft.revenuePerToken() - accBefore) * nft.liveSupply() + nft.retainedRevenue() - retainedBefore,
            pool,
            "the pool is split over live tokens with only dust retained"
        );
    }

    function pull(uint256 i) external {
        EdgeTarget t = targets[i % 3];
        uint256 owed = nft.releaseOwed(address(t));
        if (owed == 0) {
            vm.expectRevert(GoblinNFT.NothingOwed.selector);
            t.pull(nft);
            return;
        }
        assertEq(t.pull(nft), owed);
        ghostReleasePulled += owed;
    }

    function liveIdCount() external view returns (uint256) {
        return liveIds.length + preMinted;
    }
}

/// forge-config: default.invariant.runs = 128
/// forge-config: default.invariant.depth = 100
/// forge-config: default.invariant.fail-on-revert = true
contract GoblinNFTLifecycleInvariantTest is Test {
    LifecycleHandler h;
    GoblinNFT nft;

    function setUp() public {
        h = new LifecycleHandler();
        nft = h.nft();
        bytes4[] memory s = new bytes4[](15);
        s[0] = h.mint.selector;
        s[1] = h.mint.selector;
        s[2] = h.refund.selector;
        s[3] = h.transfer.selector;
        s[4] = h.deposit.selector;
        s[5] = h.claim.selector;
        s[6] = h.setTargets.selector;
        s[7] = h.warp.selector;
        s[8] = h.release.selector;
        s[9] = h.pull.selector;
        s[10] = h.sellOut.selector;
        s[11] = h.claimForeign.selector;
        s[12] = h.release.selector;
        s[13] = h.pull.selector;
        s[14] = h.pull.selector;
        targetContract(address(h));
        targetSelector(FuzzSelector(address(h), s));
    }

    /// The contract holds exactly what it owes: escrow (or release credits), unclaimed revenue and retained dust.
    function invariant_balanceEqualsLiabilities() public view {
        uint256 escrow =
            nft.released() ? nft.polOwed() + nft.reserveOwed() + nft.vrfOwed() : nft.liveSupply() * nft.PRICE();
        assertEq(
            address(nft).balance,
            escrow + nft.revenuePerToken() * nft.liveSupply() - h.ghostPaidLive() + nft.retainedRevenue()
                + nft.deferredRevenue()
        );
    }

    /// ETH flows reconcile with an independent ledger kept by the handler.
    function invariant_flowsReconcile() public view {
        assertEq(nft.totalRevenueDeposited(), h.ghostDeposits());
        assertEq(nft.totalRevenueClaimed(), h.ghostRevenuePaid());
        assertEq(
            address(nft).balance,
            h.ghostMintPaid() - h.ghostRefundPaid() - h.ghostReleasePulled() + h.ghostDeposits() - h.ghostRevenuePaid()
        );
        assertEq(nft.liveSupply(), h.ghostMinted() - h.ghostRefunded());
        assertEq(nft.liveSupply(), h.liveIdCount());
        assertLe(nft.liveSupply(), nft.MAX_SUPPLY());
        assertEq(nft.nextTokenId(), h.ghostMinted() + 1);
    }

    /// Finished states never reopen.
    function invariant_terminalStatesStick() public view {
        assertEq(nft.soldOut(), h.everSoldOut());
        assertEq(nft.released(), h.everReleased());
        if (nft.released()) {
            assertFalse(nft.refundsOpen());
            assertTrue(nft.soldOut());
            assertLe(h.ghostReleasePulled(), h.releasedAmount());
            assertEq(nft.polOwed() + nft.reserveOwed() + nft.vrfOwed() + h.ghostReleasePulled(), h.releasedAmount());
            assertEq(nft.deferredRevenue(), 0);
        } else {
            assertEq(nft.polOwed() + nft.reserveOwed() + nft.vrfOwed(), 0);
            // Before release nothing accrues to a refundable token and nothing has been paid out as revenue.
            assertEq(nft.revenuePerToken(), 0);
            assertEq(nft.retainedRevenue(), 0);
            assertEq(nft.totalRevenueClaimed(), 0);
            assertEq(nft.deferredRevenue(), nft.totalRevenueDeposited());
            if (!nft.soldOut()) assertTrue(nft.refundsOpen());
        }
        assertEq(nft.owner(), h.owner());
    }
}
