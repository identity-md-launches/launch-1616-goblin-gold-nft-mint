# Worker validation · Goblin Gold

Date: 2026-10-13. Status: **Complete for the stated scope**, with the explicit coverage limits below. This is the implementing worker's evidence, not an independent audit or network certification.

## Scope and assumptions

The prior website attempt stopped for a missing WalletConnect project ID and left no frontend files. This task builds the requested Goblin Gold mint/holder page using only injected wallets. It preserves all existing Solidity source, dependency files, build configuration, launch manifest and deployment. Only the verified NFT is connected; the other contracts in the repository are not presented as live deployments.

The implemented visual idea is a compact, dark mint counter beside the contract's hidden pixel goblin, with goblin-green actions and gold display text. The first action is mint/connect. There is one page, relative asset URLs, hash navigation and no backend, analytics, remote fonts or wallet project ID. External UI links go only to the supplied Etherscan explorer. Internal section links stay on the page.

## Checks actually run

| Check | Result |
| --- | --- |
| `npm ci --prefix web --offline --cache /tmp/goblin-npm-cache --no-audit --no-fund` | Passed from the lockfile and the populated local npm cache; no registry access required for this reinstall |
| `npm run typecheck --prefix web` | Passed, TypeScript 5.9.3, no errors |
| `npm test --prefix web` | 4 tests passed: lifetime/supply/sellout caps; 9,240 quantity/cap combinations; exact wei formatting; provider account/error validation |
| `npm run build --prefix web` | Passed using Vite 7.3.7; final static export in root `dist/`; main JS about 507.52 kB / 155.09 kB gzip, local font 10.22 kB |
| `npm run test:browser --prefix web` | 18 recorded scenario groups passed using the actual production export under `/preview/`; Chromium 141 and Playwright WebKit 26.0 |
| `npm run verify:contract --prefix web` with the supplied RPC relay | Canonical ABI hash matched the pinned `abiHash`. Chain ID 1 and all 20,653 runtime bytes matched compiled GoblinNFT exactly |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline` | All 16 checks passed on the final export. Also ran the normal online probe during implementation: all 16 passed |
| `npm audit --prefix web --cache /tmp/goblin-npm-cache --json` | Final result: 0 vulnerabilities, including development dependencies |
| Live browser read-only check through supplied relay | Chromium and WebKit rendered actual chain data, no page errors; no signing or broadcast |
| Scope/packaging inspection | Existing protected configuration/dependencies and contract sources unchanged; no submodule; local runtime assets present; no WalletConnect/Reown SDK dependencies or connection integration; raw deliverable file total about 3.02 MB, below 8 MiB |

Build warning: Vite reports the main minified JavaScript chunk slightly exceeds its default 500 kB advisory threshold. It builds successfully; gzip size is about 155 kB. This warning was retained, rather than raising the threshold. No performance timing under throttled mobile hardware is claimed.

Browser execution used `PLAYWRIGHT_BROWSERS_PATH=/tmp/goblin-playwright`. The supplied browser connector returned `Transport closed`; therefore the same built export was inspected using directly controlled Playwright browsers and screenshots. WebKit initially lacked host libraries. Required Ubuntu libraries were downloaded and extracted into `/tmp/goblin-webkit-deps/root`, with `LD_LIBRARY_PATH` set to its library directory. The temporary downloaded WebKit launch wrapper was adjusted to preserve that library path. Both engines then launched and passed. None of this runtime installation is included in the repository.

The replayable interaction suite is `web/test/browser.mjs`. It compiles/reads the existing Solidity runtime for its test-only RPC fixture and starts/closes its own foreground static preview. It never uses real wallet accounts or sends real transactions.

### Interaction coverage

1. No-wallet guidance, quantity controls, exact ETH total and main action on the first 390×844 screen; Escape closes the chooser and returns focus.
2. Real clipboard write/read of the contract address and exact Etherscan destination.
3. Wallet announcement arriving after page load.
4. MetaMask, Rabby and Coinbase Wallet announcements; deduplication; only the chosen provider receives requests; rejected connection, already-pending request, rejected network switch and retry.
5. Mint allowance cap, review total, exact destination/account/calldata/value, signing rejection, pending state and confirmed receipt.
6. Transfer-derived ownership, current-owner verification, on-chain JSON/SVG metadata, unclaimable pre-release revenue and burn confirmation/cancel.
7. Account changes update allowance and collection; provider disconnect resets the page session.
8. Chain changes invalidate a reviewed action; a silent account change is caught by pre-send checks and sends no transaction.
9. RPC outage keeps previous data labeled with its read block, disables stale writes, and recovers through Retry.
10. Legacy `window.ethereum` mobile provider, empty collection and explicit local disconnect.
11. Post-release selected-token claim uses the exact IDs and zero transaction value; closed refunds are disabled.
12. Reverted receipts display failure, not success.
13. Confirmed refund uses the reviewed token ID and sends zero ETH.
14. Delayed confirmation (clock advanced in the test) checks the same transaction hash on retry and does not resend.
15. `soldOut` remains authoritative even when refunds reduce live supply below maximum.
16. Wrong runtime code disables transactions; retry recovers after correct code is returned.
17. Layout at 320, 390, 720, 960 and 1440 pixels; reduced motion; modal keyboard containment; default-state 200% text reflow at 390; axe checks on the default page and wallet chooser, with zero WCAG A/AA violations reported.
18. WebKit mobile injected-wallet connection, review, simulated signing and receipt-confirmed mint.

All interaction signing, receipts and holder inventory in that suite are fixtures. The illustrative 123-token supply and Goblin #1 appear **only in browser tests**, never as production fallback data.

### Live observation

A separate read-only browser run loaded Ethereum at block **26,185,833** through the worker-provided relay for the supplied public source `https://ethereum-rpc.publicnode.com`:

- Live supply: 0 / 10,000; mint open; price 0.001 ETH.
- Escrow held; refunds open; collection unrevealed.
- Deposited, claimed and deferred revenue: 0 ETH.
- No page errors in Chromium or WebKit.
- At 390×844, the main action's lower edge was 565.30px in Chromium and 559px in WebKit: visible on the first screen.

These are observations at that block, not hard-coded promises about later state. Public runtime fallback is `https://eth.drpc.org` as supplied in the network input. No other RPC or private endpoint is embedded in the site.

## Better Interface review: all six domains

| Domain | Coverage and evidence | Limits |
| --- | --- | --- |
| Accessibility | Checked native buttons/links/inputs/details/dialog, names, bound labels, heading hierarchy, skip link, keyboard containment/Escape/focus return, visible focused chooser screenshot, disabled reasons and live/error regions. Automated axe default-page and chooser scans passed | No screen-reader session, physical mobile device or browser-native zoom test |
| Layout | Checked first-screen mint at 390, production subpath assets, normal reading order, five widths, no horizontal overflow, modal bounds and default-state 200% root text enlargement. Rechecked enlargement fixes | RTL, localization and every possible content length/viewport were not tested |
| Writing | Checked action labels, amount/gas language, refund consequence, retry guidance and truthful unknown/provisional/pending/success states. No promotional claims about gacha availability or guaranteed revenue | Actual wallet-extension prompts are outside site control |
| Typography | Checked local font loading, six sizes per measured width, two families, three weights, numeric alignment, heading hierarchy, selectable/wrapping addresses and 16px inputs. Viewed mobile/desktop screenshots | System Arial/Helvetica fallback can differ by platform; only bundled Latin display characters are provided |
| Colors | Checked role tokens and rendered page/button pairs. Final taste contrast check passed; axe found no default/chooser contrast violations | No claim that every wallet-supplied overlay or every physical display was tested; dark-only design |
| UI | Checked hover/focus/disabled/loading/empty/error/retry/review/pending/success states, confirmation before burn, pointer targets, normal-flow controls, native disclosures and reduced-motion rules. No endless animations | No 10%-speed animation-panel session; transaction replacements reviewed in code, not exercised through a real wallet |

Theme switching, rich editors, uploads, localization, authentication passwords and a server-side data layer are **Not applicable** to this page. No missing component was invented just to fill a review domain.

Measured rendered WCAG 2 contrast pairs on the live Chromium page:

| Pair | Foreground / background | Ratio |
| --- | --- | --- |
| Body / page | `#f0efdc` / `#10140f` | 16.02:1 |
| Secondary text / page | `#b2bdab` / `#10140f` | 9.53:1 |
| Primary label / green fill | `#10140f` / `#b7ee77` | 13.74:1 |

These measurements describe those opaque rendered pairs only. The probe also reported that all sampled text met 4.5:1 (3:1 for large text). Four inline/navigation controls in the offline state were below the comfortable 44px target recommendation but met the probe's 24px/spacing criterion; the main and icon buttons are at least 44px high.

## Findings and fixes

| Severity / domain | Source | Evidence, correction and recheck |
| --- | --- | --- |
| Medium · writing/UI | `web/src/chain.ts:127` | Provider errors may be plain EIP-1193 objects, so string-only classification misses code 4001. Added numeric-code handling, including pending-request -32002. Rejection/retry browser assertions now pass |
| Medium · accessibility/layout | `web/src/styles.css:45`, `:61`, `:112` | At 390px and 200% root text, the header overflowed and fixed-width state labels compressed values. Enabled header/quantity wrapping and flexible definition-list columns. Re-ran screenshot and no-overflow assertion successfully |
| Low · writing/accessibility | `web/src/App.tsx:179` | Heading text used a CSS-only separating space around a hidden mobile line break. Added a real text-space so text extraction and the accessible heading read “Mint your goblin.” |
| Medium · dependency hygiene | `web/package.json:18`, `web/package.json:28`, `web/package-lock.json` | Initial added viem/Vite versions produced npm advisories (including transitive ws). Updated only this task's newly created frontend dependencies to viem 2.57.5 / Vite 7.3.7, regenerated the new lockfile, and re-ran typecheck/build/browser tests. Final full audit: 0 vulnerabilities |

Test-harness repairs are not counted as product findings: the mock RPC initially called `toLowerCase()` on numeric arguments and failed to advance its synthetic head for a pending receipt. Both fixtures were corrected before recording successful interaction results.

## Evidence locations and limitations

Temporary screenshots were generated and inspected at:

- `test/scratch/taste/shots/390.png`, `1440.png` and full-page counterparts.
- `test/scratch/browser/layout-320.png`, `layout-390.png`, `layout-720.png`, `layout-960.png`, `layout-1440.png`.
- `test/scratch/browser/wallet-keyboard-390.png`, `pending-390.png`, `text-200-percent.png`.
- `test/scratch/browser/live-chromium-390.png`, `live-webkit-390.png`.

Machine-readable temporary results are `test/scratch/browser/results.json`, `live-results.json`, `test/scratch/taste/taste.json` and `test/scratch/npm-audit-final.json`. `test/scratch/` is removed by the network before submission; this document preserves the results, not the temporary runtime or screenshots.

No live mint, refund, claim, reveal or release was signed. No actual MetaMask/Rabby/Coinbase extension UI, hardware wallet or physical wallet browser was tested; injected-provider behavior was simulated according to EIP-1193/EIP-6963. Reveal/release readiness and transaction construction were reviewed against the pinned source; those future lifecycle actions were not broadcast. Long historical scans, real RPC rate limits, reorgs and large transferred-in collections were not load-tested. Collection scans are all-or-error and offer retry.

Sharing metadata and the local 1200×630 PNG are present, and the image was visually inspected. A deployed origin was not supplied, so `og:image` is relative; actual social-crawler unfurls at the eventual hosting URL remain unverified. No publishing command was run.

Standards consulted: [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) and [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193). Better Interface and documentation guidance attribution/licenses are retained in `DESIGN.md` and `docs/design-guidance-LICENSE.txt`.
