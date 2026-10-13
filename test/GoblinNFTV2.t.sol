// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {GoblinNFT} from "../src/GoblinNFT.sol";
import {DeployGoblinNFT} from "../script/DeployGoblinNFT.s.sol";
import {GoblinNFTTest, ReleaseReceiver} from "./GoblinNFT.t.sol";

contract NFTReenter {
    GoblinNFT public nft;
    bool public reject;
    bool public reentered;

    constructor(GoblinNFT nft_) {
        nft = nft_;
    }

    function setReject(bool value) external {
        reject = value;
    }

    receive() external payable {
        if (reject) revert("reject");
        try nft.refund(1) {
            reentered = true;
        } catch {}
    }
}

contract GoblinNFTV2Test is GoblinNFTTest {
    function testDeploymentOwnerIsExplicit() public {
        DeployGoblinNFT factory = new DeployGoblinNFT();
        GoblinNFT instance = factory.deploy(alice);
        assertEq(instance.owner(), alice);
        vm.expectRevert("owner required");
        factory.deploy(address(0));
    }

    /// @dev Before release every deposit is pooled and no token is credited: a later mint shares the pool equally
    ///      with the earlier ones, because the pool is split over the tokens live at release, not at deposit.
    ///      (Post-release deposits never reach a later mint: minting is closed for good at sellout.)
    function testPreReleaseDepositsArePooledAndSharedByTheTokensLiveAtRelease() public {
        vm.prank(alice);
        nft.mint{value: 0.002 ether}(2);
        nft.depositRevenue{value: 9 wei}();
        assertEq(nft.deferredRevenue(), 9);
        assertEq(nft.revenuePerToken(), 0);
        assertEq(nft.pendingRevenue(1), 4); // provisional: 9 / 2
        address bob = makeAddr("bob");
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        nft.mint{value: 0.001 ether}(1);
        assertEq(nft.pendingRevenue(3), 3); // 9 / 3 now that three tokens are live
        nft.depositRevenue{value: 10 wei}();
        assertEq(nft.pendingRevenue(1), 6);
        assertEq(nft.pendingRevenue(2), 6);
        assertEq(nft.pendingRevenue(3), 6);
        assertEq(nft.deferredRevenue(), 19);
        assertEq(nft.retainedRevenue(), 0);
        assertEq(nft.totalRevenueDeposited(), 19);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 3;
        vm.prank(bob);
        assertEq(nft.claimRevenue(ids), 0); // nothing claimable before release; no revert
        assertEq(nft.totalRevenueClaimed(), 0);
        assertEq(address(nft).balance, 0.003 ether + 19);
    }

    function testZeroSupplyDepositsJoinThePoolBeforeReleaseAndAreRetainedAfter() public {
        nft.depositRevenue{value: 11 wei}();
        assertEq(nft.deferredRevenue(), 11);
        assertEq(nft.retainedRevenue(), 0);
        vm.startPrank(alice);
        nft.mint{value: 0.001 ether}(1);
        assertEq(nft.pendingRevenue(1), 11);
        vm.stopPrank();
        nft.depositRevenue{value: 25 wei}();
        assertEq(nft.pendingRevenue(1), 36);
        vm.prank(alice);
        nft.refund(1);
        assertEq(nft.liveSupply(), 0);
        assertEq(nft.pendingRevenue(1), 0);
        assertEq(nft.deferredRevenue(), 36);
        assertEq(nft.retainedRevenue(), 0);
        assertEq(address(nft).balance, 36);
        nft.depositRevenue{value: 4 wei}();
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);
        assertEq(nft.pendingRevenue(2), 40);
        assertEq(nft.deferredRevenue(), 40);
        assertEq(nft.retainedRevenue(), 0);
    }

    function testTransferredRevenueBelongsToCurrentOwnerAndDuplicatesDoNotPayTwice() public {
        _sellOutAndRelease();
        address seller = nft.ownerOf(1);
        address bob = makeAddr("buyer");
        nft.depositRevenue{value: 170_000 wei}(); // 17 wei per live token
        vm.prank(seller);
        nft.transferFrom(seller, bob, 1);
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 1;
        vm.prank(seller);
        vm.expectRevert(GoblinNFT.NotHolder.selector);
        nft.claimRevenue(ids);
        vm.prank(bob);
        assertEq(nft.claimRevenue(ids), 17);
        assertEq(bob.balance, 17);
        assertEq(nft.totalRevenueClaimed(), 17);
        vm.prank(bob);
        vm.expectRevert(GoblinNFT.NothingOwed.selector);
        nft.claimRevenue(ids);
        assertEq(nft.retainedRevenue(), 0);
    }

    /// @dev A refund before release forfeits nothing: the burned token was never credited, and its provisional
    ///      share of the pool simply flows to the remaining holders.
    function testRefundBeforeReleaseForfeitsNothingAndRemainingHoldersSplitThePool() public {
        vm.prank(alice);
        nft.mint{value: 0.003 ether}(3);
        nft.depositRevenue{value: 10 wei}();
        assertEq(nft.pendingRevenue(2), 3);
        uint256 before = alice.balance;
        vm.prank(alice);
        nft.refund(2);
        assertEq(alice.balance - before, 0.001 ether);
        assertEq(nft.retainedRevenue(), 0);
        assertEq(nft.deferredRevenue(), 10);
        nft.depositRevenue{value: 7 wei}();
        assertEq(nft.pendingRevenue(1), 8);
        assertEq(nft.pendingRevenue(3), 8);
        assertEq(nft.pendingRevenue(2), 0);
        assertEq(nft.retainedRevenue(), 0);
        assertEq(address(nft).balance, 0.002 ether + 17);
    }

    /// @dev At release the pool is split in whole wei across the live tokens; the remainder is retained.
    function testReleaseDistributesThePoolExactlyAndRetainsTheRemainder() public {
        uint256 pool = 1 ether + 128 wei;
        nft.depositRevenue{value: 1 ether + 123 wei}();
        _sellOut();
        nft.depositRevenue{value: 5 wei}();
        assertEq(nft.deferredRevenue(), pool);
        // A review-window refund keeps the escrow and the pool exact.
        vm.prank(owner);
        nft.setLaunchTargets(pol, reserve, vrf);
        vm.prank(nft.ownerOf(1));
        nft.refund(1);
        uint256 live = 9_999;
        assertEq(nft.liveSupply(), live);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        if (pool % live > 0) {
            vm.expectEmit(true, true, true, true);
            emit GoblinNFT.RevenueRetained(0, pool % live);
        }
        vm.expectEmit(true, true, true, true);
        emit GoblinNFT.DeferredRevenueDistributed(pool, live);
        nft.release();
        assertEq(nft.deferredRevenue(), 0);
        assertEq(nft.revenuePerToken(), pool / live);
        assertEq(nft.retainedRevenue(), pool % live);
        assertEq(nft.pendingRevenue(1), 0);
        assertEq(nft.pendingRevenue(2), pool / live);
        uint256 pending;
        for (uint256 id = 2; id <= 10_000; ++id) {
            pending += nft.pendingRevenue(id);
        }
        assertEq(pending + nft.retainedRevenue(), pool);
        assertEq(address(nft).balance, live * 0.001 ether + pending + nft.retainedRevenue());
        uint256[] memory ids = new uint256[](1);
        ids[0] = 2;
        address holder = nft.ownerOf(2);
        uint256 before = holder.balance;
        vm.prank(holder);
        assertEq(nft.claimRevenue(ids), pool / live);
        assertEq(holder.balance - before, pool / live);
    }

    function testRepeatedReviewRestartsFullSevenDaysAndOwnersCanTransfer() public {
        _sellOut();
        vm.prank(owner);
        nft.setLaunchTargets(pol, reserve, vrf);
        vm.warp(vm.getBlockTimestamp() + 7 days - 1);
        vm.prank(owner);
        nft.setLaunchTargets(vrf, reserve, pol);
        vm.warp(vm.getBlockTimestamp() + 7 days - 1);
        assertTrue(nft.refundsOpen());
        vm.prank(nft.ownerOf(1));
        nft.refund(1);
        vm.expectRevert(GoblinNFT.ReviewPending.selector);
        nft.release();
        vm.warp(vm.getBlockTimestamp() + 1);
        nft.release();
        assertFalse(nft.refundsOpen());
    }

    function testTargetsRequireCodeInEverySlotAndRenounceOnlyAfterRelease() public {
        vm.startPrank(owner);
        vm.expectRevert(GoblinNFT.NotReleased.selector);
        nft.renounceOwnership();
        vm.expectRevert(GoblinNFT.TargetNotContract.selector);
        nft.setLaunchTargets(alice, reserve, vrf);
        vm.expectRevert(GoblinNFT.TargetNotContract.selector);
        nft.setLaunchTargets(pol, alice, vrf);
        vm.expectRevert(GoblinNFT.TargetNotContract.selector);
        nft.setLaunchTargets(pol, reserve, alice);
        vm.stopPrank();
        _sellOut();
        vm.prank(owner);
        nft.setLaunchTargets(pol, reserve, vrf);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        nft.release();
        vm.prank(owner);
        nft.renounceOwnership();
        assertEq(nft.owner(), address(0));
    }

    function testSharedReleaseTargetAndRevenueExcludedFromSplit() public {
        _sellOut();
        nft.depositRevenue{value: 3 ether}();
        vm.prank(owner);
        nft.setLaunchTargets(pol, pol, pol);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        nft.release();
        assertEq(nft.releaseOwed(pol), 10 ether);
        vm.prank(pol);
        assertEq(nft.claimRelease(), 10 ether);
        assertEq(address(nft).balance, 3 ether);
        assertEq(nft.pendingRevenue(1), 0.0003 ether);
    }

    function test90DayRefundBoundaryAndAllRefundedRelease() public {
        vm.pauseGasMetering(); // 10,000 independent user refunds simulated in one test transaction
        _sellOut();
        uint256 soldAt = nft.soldOutAt();
        vm.warp(soldAt + 90 days - 1);
        assertFalse(nft.refundsOpen());
        vm.warp(soldAt + 90 days);
        assertTrue(nft.refundsOpen());
        nft.depositRevenue{value: 10_001 wei}();
        for (uint256 id = 1; id <= 10_000; ++id) {
            vm.prank(nft.ownerOf(id));
            nft.refund(id);
        }
        vm.resumeGasMetering();
        assertEq(nft.liveSupply(), 0);
        assertEq(nft.deferredRevenue(), 10_001);
        assertEq(nft.retainedRevenue(), 0);
        vm.prank(owner);
        nft.setLaunchTargets(pol, reserve, vrf);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        nft.release();
        // Nobody is live at release: the pool is retained, exactly as a zero-supply deposit is after release.
        assertEq(nft.deferredRevenue(), 0);
        assertEq(nft.retainedRevenue(), 10_001);
        nft.depositRevenue{value: 9 wei}();
        assertEq(nft.retainedRevenue(), 10_010);
        assertEq(nft.polOwed() + nft.reserveOwed() + nft.vrfOwed(), 0);
        assertEq(address(nft).balance, 10_010);
    }

    function testRefundPaymentFailureRollsBackAndReentrancyCannotDoubleRefund() public {
        NFTReenter receiver = new NFTReenter(nft);
        vm.deal(address(receiver), 1 ether);
        vm.prank(address(receiver));
        nft.mint{value: 0.001 ether}(1);
        nft.depositRevenue{value: 31 wei}();
        receiver.setReject(true);
        vm.prank(address(receiver));
        vm.expectRevert(GoblinNFT.TransferFailed.selector);
        nft.refund(1);
        assertEq(nft.liveSupply(), 1);
        assertEq(nft.pendingRevenue(1), 31);
        assertEq(nft.retainedRevenue(), 0);
        receiver.setReject(false);
        vm.prank(address(receiver));
        nft.refund(1);
        assertFalse(receiver.reentered());
        assertEq(nft.retainedRevenue(), 0);
        assertEq(nft.deferredRevenue(), 31);
        assertEq(address(receiver).balance, 1 ether);
    }

    function testFuzzMintWalletCap(uint256 quantity, uint256 second) public {
        quantity = bound(quantity, 1, 20);
        second = bound(second, 1, 21);
        vm.startPrank(alice);
        nft.mint{value: quantity * 0.001 ether}(quantity);
        nft.refund(1);
        if (quantity + second > 20) vm.expectRevert(GoblinNFT.WalletLimit.selector);
        nft.mint{value: second * 0.001 ether}(second);
        assertLe(nft.mintedBy(alice), 20);
        vm.stopPrank();
    }

    function testFuzzRevenueConservation(uint256 n, uint256 amount, uint256 secondAmount, uint256 burned) public {
        n = bound(n, 1, 20);
        amount = bound(amount, 1, 100 ether);
        secondAmount = bound(secondAmount, 1, 100 ether);
        burned = bound(burned, 0, n);
        vm.deal(address(this), amount + secondAmount);
        vm.prank(alice);
        nft.mint{value: n * 0.001 ether}(n);
        nft.depositRevenue{value: amount}();
        for (uint256 id = 1; id <= burned; ++id) {
            vm.prank(alice);
            nft.refund(id);
        }
        nft.depositRevenue{value: secondAmount}();
        uint256 total = amount + secondAmount;
        // Before release the whole deposit sits in the pool; nothing is credited, nothing is retained.
        assertEq(nft.deferredRevenue(), total);
        assertEq(nft.retainedRevenue(), 0);
        assertEq(nft.revenuePerToken(), 0);
        uint256 pending;
        for (uint256 id = burned + 1; id <= n; ++id) {
            pending += nft.pendingRevenue(id);
        }
        uint256 live = n - burned;
        assertEq(pending, live == 0 ? 0 : (total / live) * live);
        assertEq(address(nft).balance, live * 0.001 ether + total);
        if (live > 0) {
            uint256[] memory ids = new uint256[](live);
            for (uint256 i; i < ids.length; ++i) {
                ids[i] = burned + i + 1;
            }
            vm.prank(alice);
            assertEq(nft.claimRevenue(ids), 0);
            assertEq(nft.totalRevenueClaimed(), 0);
            assertEq(address(nft).balance, live * 0.001 ether + total);
        }
    }
}
