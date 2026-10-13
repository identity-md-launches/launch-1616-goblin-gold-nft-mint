# ADAPTATION — Goblin Gold NFT launch (Ethereum mainnet, `evm_contracts`)

Launch of **GoblinNFT only**, from commit `fdb50e17659ad331d4f74921677bc110f3e4fec0`, built with the
repository `foundry.toml` (solc 0.8.26, optimizer 200 runs, Cancun, `via_ir = false`,
`bytecode_hash = "none"`). The brief rules **NO SOURCE CHANGES**: the deploy commit's `src/` is used
exactly as it is, and the imported audit's findings are accepted rather than fixed in source.

## What changed

| File | Change | Why |
|---|---|---|
| `test/GoblinNFTLaunch.t.sol` | **New.** Launch rehearsal (`GoblinNFTLaunchTest`) and pinned accepted findings (`GoblinNFTAcceptedFindingsTest`). | Acceptance criteria require every launch fact to be tested; the brief forbids source changes, so the tests are the whole deliverable besides this file. |
| `ADAPTATION.md` | **New.** This file. | Required by the assignment. |

Nothing else changed. `src/`, `script/`, `lib/`, `foundry.toml`, `remappings.txt`, `README.md`,
`report.md` and the existing tests are byte-for-byte the deploy commit. No `launch.json` was written
(the manifest step writes it). `lib/` is vendored as ordinary committed files (302 blobs, no
`.gitmodules`, no submodule), so the offline verifier finds every dependency.

## Launch facts verified at this commit

- **Contract set:** one contract, `GoblinNFT`, at index 0. `GoblinArt` is an `internal`-only library
  and is inlined: the creation code contains no `__$…$__` link placeholder (tested).
- **Constructor:** `GoblinNFT(address owner_)`, nonpayable, one static `address` word.
  Word [0] = `0xA7e99BB7155D7477E0C838E201b16E62B9c0b5Ac`, the project wallet the brief names
  (equal to the launch owner). The constructor passes it straight to OpenZeppelin `Ownable`; it never
  reads `msg.sender` or `tx.origin` for ownership, so the factory cannot become owner (tested with a
  CREATE2 factory stub as deployer).
- **Empty-chain safe:** the constructor makes no external call and requires no address to have code
  (tested: deploys with an EOA owner on a chain holding nothing but the factory stub).
- **Bytecode:** runtime 20,352 bytes (< 24,576, EIP-170); init code 21,044 bytes + 32-byte argument
  (< 49,152, EIP-3860); no `DELEGATECALL` (0xf4), `CALLCODE` (0xf2) or `SELFDESTRUCT` (0xff) outside
  PUSH data (tested with the same scan the protected floor uses). No proxy, initializer, upgrade,
  pause, blacklist, seizure, mint-after-sellout or owner withdrawal exists in the source.
- **Behaviour at deploy:** mint open immediately at 0.001 ETH, 10,000 supply, 20 per wallet, full
  refund open until sellout; the owner's only powers are `setLaunchTargets` (every call restarts the
  7-day refund review) and `renounceOwnership` after release (tested).

## Imported audit findings — reproduction status

All five were checked against the deploy commit. Per the brief, none is fixed in source.

| Id | Severity | Reproduces? | Disposition |
|---|---|---|---|
| `2b4dd1f1…` refundable mints earn full revenue shares | high | **Yes.** The attached proof (`.imd/reads/proofs/Proof_2b4dd1f83ca8.t.sol`, run from `test/scratch/`) fails on this code exactly as described: five fresh wallets mint 100 tokens for 0.1 ETH, a 1 ETH `depositRevenue()` lands, they claim 0.5 ETH and refund 0.1 ETH; honest holders are left 0.5 ETH. | **Accepted by the brief, not fixed.** The brief's headline rule is "NO SOURCE CHANGES: deploy commit fdb50e1 exactly as it is; findings below are accepted, do not fix them in source". The behaviour is pinned in `testAcceptedFinding_RefundableTokensEarnRevenueBeforeSellout` so it is visibly known. **Operational note for the requester:** the exposure exists only while refunds are open (before sellout, during any 7-day review, and from 90 days after sellout until release). In this launch nothing deposits revenue; the depositor (the gacha, a later launch) should deposit holder revenue only after `release()` has closed refunds for good, or accept the dilution. The ledger itself stays exact in every case: the mint escrow is never touched by the cycle, and no ETH beyond what was deposited can leave. |
| `3e4002dd…` post-reveal refund windows let holders refund only commons | low | **Yes.** After sellout and `reveal()`, a `setLaunchTargets` review reopens refunds; a holder refunds its rarity-0 tokens at full price and keeps the rest. No ETH is lost; `release()` uses `liveSupply`. | Accepted (brief lists it among low/info). Pinned in `testAcceptedFinding_SelectiveRefundOfCommonsAfterReveal`. |
| `7ec922f2…` per-wallet cap is per address | info | Yes, by construction (`mintedBy[msg.sender]`). | Accepted trust assumption; no change. |
| `0e617312…` reveal seed from one `blockhash` | info | Yes, by construction; rarity is cosmetic. | Accepted; matches the contract's own comment. |
| `9534247e…` coverage record | info | Verification record, not a defect. Re-run here: build OK, `test/GoblinNFT*.t.sol` 27 passed, runtime 20,352 bytes, no forbidden opcode, no link placeholder. | Nothing to do. |

The brief's own accepted list (review-before-sellout timing, inherited `transferOwnership`, owner-chosen
destinations mitigated by the 7-day review, retained dust and fixed on-chain art, remaining import-audit
info items) is likewise left as designed.

## Out of scope

BagGacha, GenesisVault, Curator, TwapOracle, POLManager and OracleAttestation are not deployed in this
launch and were not reviewed or changed. They remain in `src/` and compile, but the launch deploys only
GoblinNFT. `script/DeployGoblinNFT.s.sol` is a local reference helper with no broadcast and is not used by
the launch.

## Checks run

```
forge build                                   # repository foundry.toml, no overrides
env -i PATH=… HOME=… forge test               # empty environment, no network
forge test --match-path test/scratch/RevenueSnipe.t.sol   # audit proof: FAILS as the audit says (reproduces)
```

Result: build OK; **104 tests passed, 0 failed, 1 skipped** (the opt-in mainnet fork suite skips off a
fork), including the 8 new launch tests and the four 128×64 invariant runs. Slither and Mythril are not
installed on this machine and were not run; `forge lint` reports the same guarded reentrancy warnings
`report.md` already records (effects before interactions, `nonReentrant` on every ETH-sending path).
