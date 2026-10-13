// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {GoblinNFT} from "../src/GoblinNFT.sol";
import {GoblinArt} from "../src/GoblinArt.sol";

/// @dev Stands in for the launch factory: deploys arbitrary init code with CREATE2 so that `msg.sender` inside the
///      GoblinNFT constructor is a contract that must never end up as its owner.
contract LaunchFactoryStub {
    function deploy(bytes memory code, bytes32 salt) external returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create2(0, add(code, 32), mload(code), salt)
        }
        require(deployed != address(0) && deployed.code.length > 0, "constructor failed");
    }
}

contract LaunchReleaseReceiver {
    receive() external payable {}
}

/// @title GoblinNFT mainnet launch rehearsal
/// @notice Pins the facts the evm_contracts launch of commit fdb50e1 relies on, without changing any source:
///         the single constructor word is the project wallet, the factory never becomes owner, the constructor
///         touches no other contract, the runtime fits EIP-170 and carries no DELEGATECALL/CALLCODE/SELFDESTRUCT,
///         and mint is open at the deploy block with the advertised terms.
contract GoblinNFTLaunchTest is Test {
    /// @dev Constructor word [0] of the launch manifest: the project wallet named by the brief.
    address constant PROJECT_OWNER = 0xA7e99BB7155D7477E0C838E201b16E62B9c0b5Ac;
    bytes32 constant SALT = keccak256("goblin-gold-launch-rehearsal");

    LaunchFactoryStub factory;
    GoblinNFT nft;

    function setUp() public {
        vm.chainId(1);
        factory = new LaunchFactoryStub();
        bytes memory initCode = abi.encodePacked(type(GoblinNFT).creationCode, abi.encode(PROJECT_OWNER));
        assertLe(initCode.length, 49_152, "init code exceeds EIP-3860");
        nft = GoblinNFT(factory.deploy(initCode, SALT));
    }

    function testFactoryDeploymentGivesOwnershipToTheProjectWalletNotTheFactory() public view {
        assertEq(nft.owner(), PROJECT_OWNER, "owner must be the constructor word");
        assertTrue(nft.owner() != address(factory), "factory must never own the launch");
        assertTrue(nft.owner() != address(this), "deployer of the factory must never own the launch");
        assertEq(nft.name(), "Goblin Gold");
        assertEq(nft.symbol(), "GOBLIN");
    }

    function testConstructorNeedsNoOtherContract() public {
        // The launch checks rehearse the constructor on an empty chain. Deploy at a fresh address on a chain where
        // nothing but the stub exists and with an owner that has no code: it must still succeed.
        bytes memory initCode = abi.encodePacked(type(GoblinNFT).creationCode, abi.encode(PROJECT_OWNER));
        assertEq(PROJECT_OWNER.code.length, 0, "owner is an EOA on this chain");
        address again = factory.deploy(initCode, keccak256("second-salt"));
        assertEq(GoblinNFT(again).owner(), PROJECT_OWNER);
    }

    function testRuntimeIsBoundedAndHasNoEscapeOpcodes() public view {
        bytes memory code = address(nft).code;
        assertGt(code.length, 0, "missing runtime");
        assertLe(code.length, 24_576, "runtime exceeds EIP-170");
        for (uint256 j = 0; j < code.length; ++j) {
            uint8 op = uint8(code[j]);
            if (op >= 0x60 && op <= 0x7f) {
                j += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xf4, "DELEGATECALL in runtime");
            assertTrue(op != 0xf2, "CALLCODE in runtime");
            assertTrue(op != 0xff, "SELFDESTRUCT in runtime");
        }
    }

    function testGoblinArtIsInlinedNotLinked() public pure {
        // A public/external library would leave a `__$...$__` placeholder in the creation code. GoblinArt is
        // internal, so the creation code must be fully resolved before the launch hashes and deploys it.
        bytes memory code = type(GoblinNFT).creationCode;
        for (uint256 i = 0; i + 1 < code.length; ++i) {
            assertFalse(code[i] == "_" && code[i + 1] == "_", "unlinked library placeholder");
        }
    }

    function testMintIsOpenAtTheDeployBlockWithTheAdvertisedTerms() public {
        assertEq(nft.PRICE(), 0.001 ether);
        assertEq(nft.MAX_SUPPLY(), 10_000);
        assertEq(nft.MAX_PER_WALLET(), 20);
        assertEq(nft.TARGET_REVIEW_PERIOD(), 7 days);
        assertEq(nft.REFUND_REOPEN_DELAY(), 90 days);
        assertFalse(nft.soldOut());
        assertTrue(nft.refundsOpen(), "full refund is open from deploy until sellout");

        address minter = makeAddr("first-minter");
        vm.deal(minter, 1 ether);
        vm.prank(minter);
        nft.mint{value: 0.02 ether}(20);
        assertEq(nft.liveSupply(), 20);
        assertEq(nft.ownerOf(1), minter);
        assertEq(address(nft).balance, 20 * nft.PRICE());

        vm.prank(minter);
        vm.expectRevert(GoblinNFT.WalletLimit.selector);
        nft.mint{value: 0.001 ether}(1);
    }

    function testOwnerHasNoWayToMoveMintEscrowBeforeRelease() public {
        address minter = makeAddr("minter");
        vm.deal(minter, 1 ether);
        vm.prank(minter);
        nft.mint{value: 0.005 ether}(5);
        uint256 escrow = address(nft).balance;

        // The only owner entry points: naming targets (which moves nothing) and renouncing (blocked until release).
        address pol = address(new LaunchReleaseReceiver());
        address reserve = address(new LaunchReleaseReceiver());
        address vrf = address(new LaunchReleaseReceiver());
        vm.prank(PROJECT_OWNER);
        nft.setLaunchTargets(pol, reserve, vrf);
        assertEq(address(nft).balance, escrow);
        vm.prank(PROJECT_OWNER);
        vm.expectRevert(GoblinNFT.NotReleased.selector);
        nft.renounceOwnership();
        // Targets cannot pull anything before release() has credited them.
        vm.prank(pol);
        vm.expectRevert(GoblinNFT.NothingOwed.selector);
        nft.claimRelease();
        assertEq(address(nft).balance, escrow);
        // Not the owner: the only privileged call reverts.
        vm.prank(minter);
        vm.expectRevert();
        nft.setLaunchTargets(pol, reserve, vrf);
    }
}

/// @title Reproduced audit findings: the one fixed in source, and the accepted ones pinned as documented behaviour
/// @notice The brief deploys commit fdb50e1 with the smallest change a reproduced finding required. The fixed
///         finding (ddc7c88f, merged from the imported audit's 2b4dd1f8) is asserted here in its reporter's own
///         scenario; the accepted ones are reproduced so a later reader sees the behaviour is known, not missed.
///         If a pinned test ever fails, the contract's behaviour changed and ADAPTATION.md must be revisited.
contract GoblinNFTAuditFindingsTest is Test {
    address constant PROJECT_OWNER = 0xA7e99BB7155D7477E0C838E201b16E62B9c0b5Ac;
    GoblinNFT nft;

    function setUp() public {
        nft = new GoblinNFT(PROJECT_OWNER);
    }

    function _mintFromWallets(uint256 base, uint256 wallets) internal returns (uint256 firstId) {
        firstId = nft.nextTokenId();
        for (uint256 i = 0; i < wallets; ++i) {
            address m = address(uint160(base + i));
            vm.deal(m, 0.02 ether);
            vm.prank(m);
            nft.mint{value: 0.02 ether}(20);
        }
    }

    /// @dev Finding ddc7c88f (medium; imported audit 2b4dd1f8, high) — FIXED. Revenue that arrives before release()
    ///      is pooled and credited only at release, over the tokens live then. A mint / deposit / claim / refund
    ///      cycle therefore claims nothing and leaves the honest holders the whole deposit.
    function testFixedFinding_RefundableMintCannotCaptureHolderRevenue() public {
        _mintFromWallets(0x1000, 5); // 100 honest tokens
        uint256 attackerFirst = _mintFromWallets(0x2000, 5); // 100 attacker tokens, 0.1 ETH in
        assertEq(nft.liveSupply(), 200);

        address depositor = makeAddr("depositor");
        vm.deal(depositor, 1 ether);
        vm.prank(depositor);
        nft.depositRevenue{value: 1 ether}();
        assertEq(nft.deferredRevenue(), 1 ether);
        assertEq(nft.revenuePerToken(), 0, "nothing is credited before release");

        uint256 attackerOut;
        for (uint256 i = 0; i < 5; ++i) {
            address bot = address(uint160(0x2000 + i));
            uint256[] memory ids = new uint256[](20);
            for (uint256 j = 0; j < 20; ++j) {
                ids[j] = attackerFirst + i * 20 + j;
            }
            vm.prank(bot);
            assertEq(nft.claimRevenue(ids), 0, "a refundable token claims nothing");
            for (uint256 j = 0; j < 20; ++j) {
                vm.prank(bot);
                nft.refund(ids[j]);
            }
            attackerOut += bot.balance;
        }
        assertEq(attackerOut, 0.1 ether, "the attacker leaves with exactly its mint ETH");
        assertEq(nft.liveSupply(), 100);
        uint256 honestPending;
        for (uint256 id = 1; id <= 100; ++id) {
            honestPending += nft.pendingRevenue(id);
        }
        assertEq(honestPending, 1 ether, "honest holders keep the whole deposit");
        assertEq(nft.retainedRevenue(), 0);
        assertEq(address(nft).balance, 100 * nft.PRICE() + nft.deferredRevenue());
    }

    /// @dev Finding 4d6edfe8 (info) — resolved by the same change: refund() can no longer forfeit revenue, since
    ///      nothing is credited to a token while it is refundable. The burned token's provisional share stays in
    ///      the pool for the remaining holders.
    function testFixedFinding_RefundForfeitsNoRevenue() public {
        vm.pauseGasMetering();
        _mintFromWallets(0x10000, 500);
        vm.resumeGasMetering();
        assertTrue(nft.soldOut());
        vm.deal(address(this), 11 ether);
        nft.depositRevenue{value: 10 ether}();
        assertEq(nft.pendingRevenue(1), 0.001 ether);
        address pol = address(new LaunchReleaseReceiver());
        vm.prank(PROJECT_OWNER);
        nft.setLaunchTargets(pol, pol, pol);
        address holder = nft.ownerOf(1);
        uint256 before = holder.balance;
        vm.prank(holder);
        nft.refund(1);
        assertEq(holder.balance - before, nft.PRICE());
        assertEq(nft.retainedRevenue(), 0, "nothing forfeited");
        assertEq(nft.deferredRevenue(), 10 ether, "the pool is untouched");
        assertEq(nft.pendingRevenue(1), 0);
        uint256 pool = 10 ether;
        assertEq(nft.pendingRevenue(2), pool / 9_999, "remaining holders share the pool");
        vm.warp(block.timestamp + 7 days);
        nft.release();
        assertEq(nft.revenuePerToken(), pool / 9_999);
        assertEq(nft.retainedRevenue(), pool % 9_999);
        // After release, deposits accrue at once and refunds are closed for good.
        nft.depositRevenue{value: 9_999 * 2 wei}();
        assertEq(nft.pendingRevenue(2), pool / 9_999 + 2);
        vm.prank(nft.ownerOf(2));
        vm.expectRevert(GoblinNFT.RefundsClosed.selector);
        nft.refund(2);
    }

    /// @dev Finding 8d38acb2 (low, accepted): sellout flips only inside mint(), and a refund front-running the
    ///      selling-out mint keeps liveSupply below 10,000. Liveness only: every holder stays refundable at full
    ///      price and nothing is lost; the honest minters of the last tokens should submit via a private relay.
    function testAcceptedFinding_RefundCanDeferSellout() public {
        vm.pauseGasMetering();
        _mintFromWallets(0x10000, 499); // 9,980 live; the griefer at 0x10000 holds ids 1..20
        vm.resumeGasMetering();
        address griefer = address(uint160(0x10000));
        address honest = makeAddr("honest");
        vm.deal(honest, 0.02 ether);
        vm.prank(griefer);
        nft.refund(1); // front-runs the selling-out mint
        vm.prank(honest);
        nft.mint{value: 0.02 ether}(20);
        assertEq(nft.liveSupply(), 9_999);
        assertFalse(nft.soldOut());
        vm.expectRevert(GoblinNFT.NotSoldOut.selector);
        nft.release();
        assertEq(griefer.balance, nft.PRICE());
        assertTrue(nft.refundsOpen(), "nobody is locked in while sellout is deferred");
    }

    /// @dev Finding b0ebc1e8 (info, accepted): an EIP-7702 delegated EOA carries 23 bytes of code, so the code-size
    ///      check in setLaunchTargets accepts it. The check proves only that a destination has code, not that it is
    ///      safe or immutable; the 7-day refund review is the real protection and README says so.
    function testAcceptedFinding_DelegatedEoaPassesTheCodeSizeCheck() public {
        address eoa = makeAddr("delegated-eoa");
        vm.etch(eoa, abi.encodePacked(hex"ef0100", address(new LaunchReleaseReceiver())));
        assertEq(eoa.code.length, 23);
        vm.prank(PROJECT_OWNER);
        nft.setLaunchTargets(eoa, eoa, eoa);
        assertEq(nft.polTarget(), eoa);
        assertTrue(nft.refundsOpen(), "the review window opens on every target change");
    }

    /// @dev Finding 9c24d1d4 (info, accepted by the brief's "each call restarts the 7-day review"): an owner that
    ///      re-sets targets at least every 7 days keeps release() unreachable. Refunds stay open the whole time, so
    ///      the only effect is that the split waits for the owner to stop; no ETH is locked.
    function testAcceptedFinding_OwnerCanRestartTheReviewIndefinitely() public {
        vm.pauseGasMetering();
        _mintFromWallets(0x10000, 500);
        vm.resumeGasMetering();
        address pol = address(new LaunchReleaseReceiver());
        for (uint256 i = 0; i < 20; ++i) {
            vm.prank(PROJECT_OWNER);
            nft.setLaunchTargets(pol, pol, pol);
            vm.warp(block.timestamp + 6 days);
            vm.expectRevert(GoblinNFT.ReviewPending.selector);
            nft.release();
            assertTrue(nft.refundsOpen());
        }
        vm.warp(block.timestamp + 1 days);
        nft.release();
        assertTrue(nft.released());
    }

    /// @dev Finding 3e4002dd (low, accepted): refunds reopen during a post-sellout review after reveal(), so a
    ///      holder can refund only its common goblins at full price. Nobody loses ETH; the surviving collection
    ///      skews toward higher rarity and the released escrow shrinks by PRICE per refunded common.
    function testAcceptedFinding_SelectiveRefundOfCommonsAfterReveal() public {
        vm.pauseGasMetering(); // 500 independent mint transactions simulated in one test transaction
        _mintFromWallets(0x10000, 500);
        vm.resumeGasMetering();
        assertTrue(nft.soldOut());
        assertFalse(nft.refundsOpen(), "refunds close at sellout");

        vm.roll(block.number + 2);
        nft.reveal();
        assertTrue(nft.revealed());

        address pol = address(new LaunchReleaseReceiver());
        vm.prank(PROJECT_OWNER);
        nft.setLaunchTargets(pol, pol, pol);
        assertTrue(nft.refundsOpen(), "review reopens refunds with traits public");

        address holder = address(uint160(0x10000)); // owns ids 1..20
        uint256 refunded;
        for (uint256 id = 1; id <= 20; ++id) {
            GoblinArt.Traits memory t = nft.traitsOf(id);
            if (t.rarity == 0) {
                vm.prank(holder);
                nft.refund(id);
                ++refunded;
            }
        }
        assertGt(refunded, 0, "fixed seed yields at least one common among twenty");
        assertEq(holder.balance, refunded * nft.PRICE());
        for (uint256 id = 1; id <= 20; ++id) {
            // Every surviving token of this holder is non-common; every common one is burned.
            try nft.ownerOf(id) returns (address o) {
                assertEq(o, holder);
                assertGt(nft.traitsOf(id).rarity, 0);
            } catch {
                vm.expectRevert(GoblinNFT.NonexistentToken.selector);
                nft.traitsOf(id);
            }
        }
        vm.warp(block.timestamp + 7 days);
        nft.release();
        assertEq(nft.polOwed() + nft.reserveOwed() + nft.vrfOwed(), (10_000 - refunded) * nft.PRICE());
    }
}
