# Goblin Gold

A static, mobile-first mint site for the existing GoblinNFT on Ethereum mainnet. The site uses only injected EIP-1193 wallets, with EIP-6963 discovery for multiple extensions and a `window.ethereum` fallback for mobile wallet browsers. There is no WalletConnect/Reown integration, project ID, backend or analytics.

The production website is **`dist/index.html`**. Its assets use relative URLs, so the export works at a static-hosting subpath. Source, a pinned npm lockfile and the complete export are included. This assignment does not deploy or change any contract.

## Install, preview and rebuild

Use Node 22.18 or later and npm 10 or later:

```sh
npm ci --prefix web
npm run typecheck --prefix web
npm test --prefix web
npm run build --prefix web
npm run preview --prefix web
```

Open the local URL printed by Vite. For development, use `npm run dev --prefix web`. Building writes to repository-root `dist/` and replaces the previous export. Serve that directory over HTTP(S); JavaScript modules and wallet providers need a web origin, rather than opening the HTML as a `file:` URL. The source has no environment-variable or secret requirement.

An initial `npm ci` needs npm registry access unless the packages are already cached. Once dependencies are installed, typechecking and the production build use only local files. No package cache, `node_modules`, dependency archive or vendored registry belongs in the submission. Keep the existing Solidity configuration and vendored contracts unchanged.

## What the site does

- Reads supply, price, wallet limits, refund/reveal/release state, targets and revenue directly from GoblinNFT. Public reads refresh every 20 seconds while the page is visible. Failures are shown explicitly and disable transactions.
- Discovers installed wallets without requesting accounts until the visitor chooses one. Supports MetaMask, Rabby and Coinbase Wallet extensions through their injected providers; mobile users see “open this page in your wallet's built-in browser”. Network switching is explicit. Disconnect removes this page's wallet session; it does not revoke permissions inside the wallet.
- Mints 1–20 goblins, further capped by remaining supply and the wallet's lifetime allowance. Shows exact ETH totals plus gas before asking the wallet to sign. The contract's permanent `soldOut` flag controls closure even after refunds lower supply.
- Reconstructs holdings from incoming `Transfer` events starting at the deployment block, verifies current `ownerOf` and checks the total against `balanceOf`. It splits RPC ranges on failure and never treats a partial scan as a complete collection. Metadata and art come from `tokenURI`. Collection refresh is manual and also follows confirmed transactions; large histories can take time. Twelve tokens load per page.
- Offers burn-and-refund with a destructive confirmation, selected-token revenue claims after release, and permissionless reveal and escrow release when their on-chain conditions allow them. Provisional revenue before release is labeled and cannot be claimed in the UI. Owner administration, donations, token transfers and the project's separately deployed gacha are outside this mint site's scope.
- Verifies Ethereum chain ID and the exact deployed runtime hash before enabling transactions, checks the active account/network again immediately before sending, and simulates each transaction. Pending, rejected, reverted, replaced and delayed confirmations have distinct states. Transaction links go to Etherscan. A delayed confirmation blocks another submission until it is resolved; reloads do not persist pending transactions, so check wallet activity before retrying after a reload.

## Deployment and ABI provenance

| Item | Pinned value |
| --- | --- |
| Network | Ethereum mainnet, chain ID 1 |
| Contract | `0xc5d5f314da6d4a433f9bf897a2cc24a537576cb1` |
| Deployment block | `26185634` |
| Source commit supplied by deployment input | `dbd66796c56c6df8ab9b5d58686b86ef1111ae5d` |
| Canonical ABI Keccak-256 | `af84d2d588bf03ccf014727bd109abbef4df473f33466faa090b7df6d44b9de7` |
| Runtime Keccak-256 | `270daf73d98f9a0aab6b102e725ad745edb2412306782d222e1cf495c6951f85` |

`web/src/generated/GoblinNFT.ts` contains the full ABI derived with `forge inspect --offline GoblinNFT abi --json`. Canonicalization recursively sorts object keys and preserves array order before hashing compact JSON. The observed deployment has 20,653 runtime bytes and matches the locally compiled contract byte for byte.

With the repository's existing Foundry/compiler available:

```sh
npm run verify:contract --prefix web
npm run verify:contract --prefix web -- --rpc https://ethereum-rpc.publicnode.com
```

The optional second command performs read-only chain and bytecode checks. The worker used the supplied contributor relay for these checks. Browser runtime RPCs are the two public endpoints supplied with the assignment: `https://ethereum-rpc.publicnode.com` and `https://eth.drpc.org`. Only the NFT address is hard-coded as an application contract; destinations are read from its state. No transaction was broadcast during development.

## Interaction and design validation

The browser test suite serves the **built export** under `/preview/`, supplies test-only RPC responses and injected wallets, and exercises the site without keys or real transactions:

```sh
npm exec --prefix web -- playwright install chromium webkit
npm run test:browser --prefix web
```

The browser suite uses the existing Foundry build to obtain the runtime fixture. Its browser dependencies may need OS libraries (`playwright install-deps`) on a new machine. Screenshots and detailed test results go under `test/scratch/browser/`; they are temporary validation output, not site assets.

Validation passed: production build, TypeScript check, 4 logic tests, 18 browser scenario groups and all 16 pinned design-probe checks. Chromium and WebKit both completed a simulated mint. No live transaction or physical wallet device was tested. The build retains a 500 kB chunk-size advisory (about 155 kB gzip). Actual results and scope limitations are recorded in [docs/VALIDATION.md](docs/VALIDATION.md). The design tokens and responsive component system are documented in [DESIGN.md](DESIGN.md). Original contract documentation is retained in [docs/CONTRACTS.md](docs/CONTRACTS.md) as historical source documentation; its earlier assignment/deployment statements do not describe this website task.

The bundled Pixelify Sans font is licensed under [SIL OFL](web/src/fonts/OFL.txt). The unrevealed goblin artwork reproduces `GoblinArt.hiddenSvg()` from this repository. The favicon is a separate pixel brand mark. `web/assets/share.svg` is the editable source for the bundled PNG share card. Design guidance attribution and licenses are in [docs/design-guidance-LICENSE.txt](docs/design-guidance-LICENSE.txt).
