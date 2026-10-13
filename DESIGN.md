# Goblin Gold design

## Overview

A one-page Ethereum mint and holder interface. The requested dark, goblin-green and gold identity is carried by pixel typography, the contract's unrevealed pixel artwork and a square, restrained control system. The mint comes first; holder tools and contract explanations follow. No marketing hero separates the visitor from the main action.

Canonical styles are in `web/src/styles.css`; page and component implementations are in `web/src/App.tsx`. The visual direction was inferred from the supplied brief, rather than an existing frontend, because the preceding website task stopped before producing one.

## Colors

Colors use sRGB hex values. Components use role tokens mapped to the small primitive palette in `:root`:

| Role token | Value | Use |
| --- | --- | --- |
| `--bg` | `#10140f` | Page and text on primary buttons |
| `--surface` | `#191f17` | Empty collection, art frame and dialogs |
| `--hover` | `#252e21` | Neutral button hover, progress track, disabled primary |
| `--border` | `#48553e` | Structural dividers and control boundaries |
| `--text` | `#f0efdc` | Main text |
| `--muted` | `#b2bdab` | Supporting copy, timestamps and disabled labels |
| `--accent` / `--accent-hover` | `#b7ee77` / `#cdf6a1` | Primary action fills |
| `--ornament` / `--focus` | `#eac875` | Gold brand/art details, progress, notices and focus ring |
| `--error` / `--error-bg` | `#ffa59b` / `#34221e` | Errors and burn/refund confirmation |

Green emphasizes the single mint action. Gold is a brand ornament and focus indicator; labels and native control shapes identify interaction separately. Status always has visible words, not color alone. The contract's artwork retains its original navy, black and yellow palette; it is not recolored. The dialog backdrop is `#060905d9`, and token images use a white 10% inset outline.

The design is intentionally dark-only. Forced-colors rules retain native-readable control boundaries and a `Highlight` focus ring. Measured contrast and its scope are recorded in the validation report.

## Typography

- **Pixelify**, weight 600, for brand and headings. `web/src/fonts/pixelify-latin.woff2` is a locally bundled 400–700 variable font, subset to U+0020–U+00FF from the Google Fonts font; its OFL license is adjacent. `font-display: swap`; fallback is Courier New, then monospace.
- **Arial, Helvetica, sans-serif** for readable controls, amounts and prose. Regular 400, semibold 600 and bold 700 are the three requested weights; actual sans rendering uses the visitor's system font.
- Six semantic sizes: `--text-sm` 14px, `--text-body` 16px, `--text-lg` 20px, `--text-title` 24px, `--text-section` 36px, and `--text-display` 88px. Display steps to 72px at 960px wide and 48px at 720px. All sizes are rem-based and grow with text enlargement.
- Headings use line-height 1.08, balanced wrapping and tracking of -0.04em for h1 / -0.025em for h2. Body line-height is 1.55. There are no tracked capital labels or monospaced prose blocks.
- Supply, quantity, ETH amounts and definition-list values use tabular digits. Addresses and long exact-wei values wrap; addresses remain selectable in full. Inputs are 16px at the default root size.

## Layout

The `.shell` is at most 1168px wide, with 48px desktop side margins. At 960px the margins become 32px; at 720px, 20px; below 360px, 16px. Spacing tokens use 4, 8, 12, 16, 24, 32, 48 and 64px.

Desktop mint and contract sections use two equal flexible columns separated by 9%; the mint gap narrows to 6% at 960px. At 720px both become one column, with the mint form before the artwork. Desktop header navigation hides on the smaller layout; all sections remain available by scrolling and internal links. The header wraps when enlarged text needs another row.

The token grid has four columns, three at 960px, two at 720px and one below 360px. Quantity and toolbar rows wrap. Definition-list labels and values share flexible space rather than forcing labels to stay on one line. Forms and critical actions remain in normal document flow. There are no fixed overlays obscuring page content; a native modal is the one deliberate exception.

The exported site was checked at 320, 390, 720, 960 and 1440px, plus 200% root text size at 390px. These rendered checks and browser limitations are documented separately. No localization or RTL layout is advertised.

## Elevation and depth

The interface is flat. Tonal surfaces group the empty state, artwork, tokens and modal. One-pixel borders mark controls and section boundaries; there are no drop shadows or gradients. Gold corner brackets frame the artwork without implying it is clickable. Native `dialog.showModal()` puts the dialog in the browser's top layer and makes the underlying page inert.

## Shapes

Controls use 4px corners, dialogs 8px, and artwork/token surfaces remain square. The brand icon uses a small rounded outer square and a pixel face. The art frame has 20px corner ornaments with 2px edges. Native control outlines remain rectangular and do not clip content.

## Components

| Component or pattern | Source | Behavior |
| --- | --- | --- |
| `Icon` | `web/src/App.tsx` | Shared 24-unit SVG paths, 1.7px current-color strokes; decorative and hidden from assistive technology |
| `Modal` | `web/src/App.tsx` | Native modal dialog with title association, keyboard containment, Escape/close and focus return. Closing is locked during wallet submission or unresolved transaction confirmation |
| `.primary`, `.secondary`, `.text-button`, `.icon-button` | `web/src/styles.css` | Main, neutral, text and compact actions; 44px minimum targets, 52px main action, descriptive names for icon buttons |
| Mint form / `.stepper` | `web/src/App.tsx` | Labeled numeric input, bounded increment/decrement, exact total and contract-derived cap. Loading, wrong-chain, sold-out, allowance, stale-data and pending states |
| Wallet chooser | `web/src/App.tsx`, `web/src/wallet.ts` | Lists announced providers plus legacy injection; refresh discovery, selected address, local disconnect, rejection/retry and empty-wallet guidance. It renders provider names as text and does not load provider icon URLs |
| Holder collection / `.token` | `web/src/App.tsx`, `web/src/chain.ts` | Verified ownership, on-chain image and traits, revenue selection, burn/refund review and paginated loading. Empty, loading and failed full-scan states are distinct |
| `.notice`, `.error`, `.success` | `web/src/styles.css` | Persistent local messages with text and border cues; live status regions for routine updates and alerts for errors |
| Contract details | `web/src/App.tsx` | Full selectable address, copy action, live definition list and native `details` disclosures for rules, reveal and release |

Buttons have neutral hover feedback only on devices that support hover. Under `prefers-reduced-motion: no-preference`, background/color/press transitions take 120ms and pressed controls scale to 0.96. Reduced motion removes these transitions; there are no entrance effects or endless animations. The 2px gold `:focus-visible` ring has a 4px offset.

## Do's and don'ts

Use `.shell`, the existing spacing tokens and a semantic section heading for any future page section. Place controls next to the data they change. Reuse a neutral action for secondary tasks; reserve a filled green action for the main task in that view. Keep exact amounts as bigint-derived strings and label unknown or provisional data explicitly.

Keep wallet detection passive until a visitor requests access. Never turn a loading value into a fake zero, show a provisional share as claimable, or imply a transaction succeeded before a receipt is checked. Use a destructive confirmation before a burn. Keep all runtime artwork and fonts local and retain native button, label, disclosure and dialog semantics.

Design guidance was adapted from Jakub Krehel's **Better Interface**, MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation structure was adapted from Paul Bakaus's **Impeccable**, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. Included license texts are retained in `docs/design-guidance-LICENSE.txt`.
