# ADAPTATION — Goblin Gold NFT launch (Ethereum mainnet, `evm_contracts`)

Launch of **GoblinNFT only**, from commit `fdb50e17659ad331d4f74921677bc110f3e4fec0`, built with the
repository `foundry.toml` (solc 0.8.26, optimizer 200 runs, Cancun, `via_ir = false`,
`bytecode_hash = "none"`). `GoblinArt` is an `internal`-only library inlined into it.

The brief rules "NO SOURCE CHANGES … findings below are accepted". Its accepted list names only
low/info items and "remaining import-audit **info** items". The imported audit's **high** finding
(`2b4dd1f8`, refundable mints earn full revenue shares) is on neither list, and the independent
review reopened the work for it (`ddc7c88f`, medium) with a proof this revision is held to. The
acceptance criteria say a reproduced audit finding is fixed with a test, so this revision makes the
one source change that finding requires and nothing else. Everything the brief does accept is left
exactly as it was.

## What changed in this revision

| File | Change | Why |
|---|---|---|
| `src/GoblinNFT.sol` | Revenue deposited **before `release()`** is pooled in a new `deferredRevenue` counter instead of being credited per token. `release()` splits the pool in whole wei over the tokens live at that moment (`_distributeDeferredRevenue`, remainder to `retainedRevenue`, event `DeferredRevenueDistributed`; pool retained if nobody is live). Deposits after release accrue exactly as before. `pendingRevenue()` shows the provisional share `deferredRevenue / liveSupply` before release. `claimRevenue()` returns 0 before release instead of reverting `NothingOwed` (nothing has accrued, so there is nothing to settle; after release the revert is unchanged). `refund()` drops the "retain the token's unclaimed revenue" step, which can no longer be reached (nothing is credited while a token is refundable). | Finding `ddc7c88f` / audit `2b4dd1f8` (reproduced, proof held): while refunds are open a token was a free option on every deposit — mint, take a pro-rata share, refund at full price. The reviewer's proof `Proof_ddc7c88f13b0.t.sol` and the audit's `Proof_2b4dd1f83ca8.t.sol` both fail on the deploy commit and pass on this tree. The audit itself proposed "start accrual at release"; this is that. |
| `test/GoblinNFTLaunch.t.sol` | `GoblinNFTAcceptedFindingsTest` became `GoblinNFTAuditFindingsTest`: the test that pinned the old exploit (attacker leaves with 0.6 ETH) now asserts the fix (attacker leaves with its 0.1 ETH, honest holders keep the whole 1 ETH); new tests for finding `4d6edfe8` (refund forfeits nothing) and pins for the three accepted advisory findings (`8d38acb2`, `b0ebc1e8`, `9c24d1d4`). Launch rehearsal tests unchanged. | Every change must be tested; accepted findings are pinned so a later reader sees they are known. |
| `test/GoblinNFT.t.sol` | `_sellOutAndRelease()` helper; `testRevenue` also checks the pool before and after release. | Pre-release deposits are now pooled. |
| `test/GoblinNFTV2.t.sol` | The five tests that asserted per-token crediting of pre-release deposits, forfeiture on refund, and `NothingOwed` on a pre-release claim were rewritten for the new rule (pool shared equally by the tokens live at release, refund forfeits nothing, pre-release claim is a 0 no-op). New `testReleaseDistributesThePoolExactlyAndRetainsTheRemainder`. The 90-day test now expects the pool to be retained when nobody is live at release. | Those tests encoded the exploitable behaviour. |
| `test/GoblinNFT.invariant.t.sol`, `test/GoblinEscrow.invariant.t.sol` | Independent ledgers track `deferredRevenue`; pre-release refunds pay exactly `PRICE` and forfeit nothing; the pool is folded into the accumulator at release. 128×64 runs each. | Ledger conservation is re-proved under the new rule. |
| `test/BagGachaV2.t.sol` | `testDayOneRevenueBeforeSelloutAndMintRemainsRefundable` expects the gacha's day-one holder share to sit in the pool (claim returns 0, refund pays only the mint price). | BagGacha is not in this launch, but its test deposits into GoblinNFT and must keep passing. |
| `README.md` | Revenue section rewritten for the pool; notes for the three accepted advisory findings (sellout can be deferred by a refund, 7702/proxy destinations pass the code-size check, owner can keep restarting the review). | Documentation must match the deployed code and the accepted trust assumptions. |
| `ADAPTATION.md` | This file. | Required. |

Not changed: `src/GoblinArt.sol`, every other `src/` file, `script/`, `lib/`, `foundry.toml`,
`remappings.txt`, `report.md`. No `launch.json` was written. `lib/` stays vendored as ordinary files.

## Launch facts re-verified on this tree

- **Contract set:** one contract, `GoblinNFT`, index 0. Creation code has no `__$…$__` placeholder.
- **Constructor:** `GoblinNFT(address owner_)`, nonpayable, one `address` word =
  `0xA7e99BB7155D7477E0C838E201b16E62B9c0b5Ac` (the project wallet, equal to the launch owner); never
  `msg.sender`/`tx.origin`; no external call, safe on the empty rehearsal chain (tested).
- **Bytecode:** runtime 20,653 bytes (< 24,576); init code 21,345 bytes (< 49,152); no `DELEGATECALL`,
  `CALLCODE` or `SELFDESTRUCT` outside PUSH data (tested with the protected floor's scan). No proxy,
  initializer, upgrade, pause, blacklist, seizure, mint-after-sellout or owner withdrawal.
- **Behaviour at deploy:** unchanged — mint open at 0.001 ETH, 10,000 supply, 20 per wallet, full refund
  until sellout, 7-day review on every `setLaunchTargets`, 90-day fallback, 50/40/10 pull release,
  renounce only after release. The only behavioural change is *when* holder revenue becomes claimable.

## Reviewer findings (this revision)

| Id | Severity | Reproduced? | Disposition |
|---|---|---|---|
| `ddc7c88f…` refundable tokens take a full share of holder revenue | medium | **Yes** — both proofs failed on the starting tree exactly as reported. | **Fixed** in `src/GoblinNFT.sol` as above; both proofs pass; `testFixedFinding_RefundableMintCannotCaptureHolderRevenue`. |
| `8d38acb2…` a refund front-running the selling-out mint defers sellout | low | Yes (`testAcceptedFinding_RefundCanDeferSellout`). | **Accepted**, not changed: liveness only, every holder stays refundable at full price, costs the griefer gas per attempt. Counting sellout on cumulative mints or adding a release deadline would change the brief's mint/sellout rules ("mint has no deadline", "release after sellout"), which the reviewer itself marks out of scope. Documented in README. |
| `b0ebc1e8…` EIP-7702 delegated EOA passes `TargetNotContract` | info | Yes (`testAcceptedFinding_DelegatedEoaPassesTheCodeSizeCheck`). | **Accepted**, as the finding requests: README now says the code-size check proves only that a destination has code, and names proxies and 7702 delegations; the 7-day refund review is the protection. |
| `9c24d1d4…` owner can restart the 7-day review indefinitely | info | Yes (`testAcceptedFinding_OwnerCanRestartTheReviewIndefinitely`). | **Accepted**: it is the brief's own "each call restarts the 7-day review" design; refunds stay open throughout. Documented in README as a trust assumption. |
| `4d6edfe8…` `refund()` forfeits the token's entire unclaimed revenue | info | Yes on the starting tree. | **Resolved by the same fix**: nothing is credited while a token is refundable, so `refund()` has nothing to forfeit (`testFixedFinding_RefundForfeitsNoRevenue`); the retention step was removed from `refund()`. |

## Imported audit findings

| Id | Severity | Reproduces? | Disposition |
|---|---|---|---|
| `2b4dd1f8…` refundable mints earn full revenue shares | high | **Yes.** | **Fixed** (same root cause as `ddc7c88f`; its proof passes). |
| `3e4002dd…` post-reveal refund windows let holders refund only commons | low | Yes. | Accepted (brief lists it among low/info); pinned in `testAcceptedFinding_SelectiveRefundOfCommonsAfterReveal`. No ETH is lost; `release()` uses `liveSupply`. |
| `7ec922f2…` per-wallet cap is per address | info | Yes, by construction. | Accepted trust assumption. |
| `0e617312…` reveal seed from one `blockhash` | info | Yes, by construction; rarity is cosmetic. | Accepted; matches the contract's own comment. |
| `9534247e…` coverage record | info | Verification record. | Re-run on this tree: see below. |

## Out of scope

BagGacha, GenesisVault, Curator, TwapOracle, POLManager and OracleAttestation are not deployed in this
launch and were not reviewed or changed. The gacha (a later launch) may call `depositRevenue()` from day
one as before; the ETH now waits in the pool until `release()`.

## Checks run

```
forge build                                   # repository foundry.toml, no overrides
forge fmt --check
env -i PATH=… HOME=… forge test               # empty environment, no network
forge build --sizes                           # GoblinNFT runtime 20,653 bytes
forge test --match-path 'test/scratch/Proof_*'   # both reviewer/audit proofs: PASS (failed on the starting tree)
```

Result: build OK; **111 tests passed, 0 failed, 1 skipped** (the opt-in mainnet fork suite skips off a
fork), including both proofs run from `test/scratch/`, the rewritten launch/finding tests and the four
128×64 invariant runs. Slither and Mythril are not installed on this machine and were not run.
