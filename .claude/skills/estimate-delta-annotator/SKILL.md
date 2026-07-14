---
name: estimate-delta-annotator
description: >-
  Compares two collision-repair estimates (shop/preliminary vs. insurer
  supplement/SOR) and produces one annotated PDF of the lower-cost estimate that
  bridges the two appraisals. Cost pass strikes under-valued prices, labor hours,
  and rates and stamps the higher estimate's value (red/yellow), underlines
  matches, and notes missing items. OEM pass flags aftermarket/used parts, skipped
  scans/calibrations, one-time-use reuse, and warranty/safety language that
  contradict OEM position statements (blue/cyan), citing the statement and
  jurisdictional law. Use whenever the user wants to compare, reconcile, or annotate
  two estimates, build a delta / cost-gap or OEM citation density report, mark up an
  SOR or supplement, check OEM position statements, or justify a supplement.
  Triggers: delta, differences, cost gap, supplement review, reconcile estimates,
  annotate estimate, OEM position statement, aftermarket vs OEM, ADAS calibration,
  jurisdictional law, bridge the appraisal gap.
---

# Estimate Delta Annotator

Body shops and insurers rarely agree line-for-line. Given two estimates for the
same repair — a **shop/preliminary estimate** and an **insurer supplement (SOR /
Supplement of Record)** — this skill marks up the **lower-cost** one so a reviewer
sees, at a glance, where it falls short and why. Output is a single annotated PDF
carrying two categories of markup:

- **Cost gaps (red / yellow)** — under-valued prices, labor hours, and rates, plus
  items missing from the lower estimate.
- **OEM / warranty / safety flags (blue / cyan)** — aftermarket or used parts,
  skipped scans/calibrations, reused one-time parts, and disclosure language that
  contradicts OEM position statements.

## Scripts

- `scripts/extract_estimate.py "<pdf>" --out x.json` — structured line items **and**
  ESTIMATE TOTALS with coordinates, plus the parsed grand total.
- `scripts/annotate_pdf.py "<target>.pdf" instructions.json "<out>.pdf"` — applies
  the markup. Annotation types: `underline`, `replace`, `highlight`, `note`; each
  takes optional `color` (`red`|`blue`) and `hl` (`yellow`|`cyan`).

## Workflow

### 1. Extract both estimates
```bash
python scripts/extract_estimate.py "<estimate A>.pdf" --out /tmp/a.json
python scripts/extract_estimate.py "<estimate B>.pdf" --out /tmp/b.json
```
Line records carry `price_bbox` and `row_top`; totals records carry `hrs_bbox` and
`rate_bbox`. Pass these coordinates straight to the annotator — never guess them.

### 2. Pick the target (auto-detect by total)
The **higher-`grand_total`** estimate is the **source** of the values you stamp; the
**lower-`grand_total`** estimate is the **target** you annotate. This holds even
when the lower estimate has more lines (a supplement can carry extra mechanical
work yet still total less). Tell the user which file you chose and cite both totals.
If totals tie or one is `null`, ask which file is the shop estimate.

### 3. COST pass — line items
For each **priced** line on the target, find its counterpart on the source. Match on
**part number first** (strongest signal), then normalized **description + operation +
section**. Respect side/qualifier tokens (LT vs RT, "w/o GLE63"). The two estimates
use different software, so line order and numbers won't correspond — match on
meaning. Some target lines have no source counterpart (extra supplement work);
leave those alone.

- equal price (within $0.01) → `underline` (color red)
- different price → `replace`, `new_text` = the **source** price (`$278.20`);
  write it even if lower — it documents the discrepancy.
- source line with **no** target match → `note` (red/yellow) near the target's
  matching section header (`row_top`), text like `H'Lamp bracket $105.30 .7b`.
  Stack multiple by adding ~12 to `top`. Skip pure procedure lines (scans,
  transport, masking, alignment, cleanup) — they're on both under different wording.

### 4. COST pass — ESTIMATE TOTALS (labor hours & rates)
Compare each labor category (`totals[]`: Body Labor, Paint Labor, Mechanical Labor,
Paint Supplies) between source and target. For any differing **hours** or **rate**,
`highlight` the target's `hrs_bbox` / `rate_bbox` and set `new_text` to the source
value. This surfaces rate disputes (e.g. $60/hr vs $75/hr) that don't show at the
line level. If a category exists on one estimate only, note it rather than highlight.

### 5. OEM COMPLIANCE pass
Read `references/oem_position_statements.md`. Scan the **target** estimate's line
items and its bottom-of-document legal/disclosure text for the triggers listed
there: aftermarket/used markers (`A/M`, `LKQ`, `RECOND`, `NAGS`, `OPT/ALT OEM`,
`CAPA`), ADAS work missing pre/post scans or calibration, reused one-time-use
parts, and warranty/availability/like-kind-quality language. For each, add a `note`
in the **OEM color** (`"color":"blue","hl":"cyan"`) citing the position. To avoid covering line text, place OEM notes in the
  page **bottom margin** (top ~= page height - 85, stacking +13 each) and key
  each to its line number, e.g. `OEM (Ln 23): MB requires new OEM part (MBUSA
  parts stmt)`; optionally add a blue `underline` on that line's price to tie it.

Sourcing is "bundled now, Egnyte later": cite the summarized statement + public
source from the reference file. If an **Egnyte** connector is authorized, first
search the user's `collisionacademy.egnyte.com` OE docs for the make + topic and
attach/link the actual statement, preferring it over the summary. Never invent a
citation — if unsupported, flag `OEM: verify position statement` instead.

Also consider **jurisdictional law** (see the reference file's jurisdictional
section) using the owner's/shop's state from the estimate header — e.g.
aftermarket-parts disclosure/consent or OEM-procedure requirements. Law changes,
so verify the current statute (web search or the Egnyte legal library) before
quoting it in a dispute. This OEM pass is the input to an **OEM citation density
report**: aim to attach the strongest citation (OEM procedure/position statement,
then ADAS requirement, then applicable law) to as many flagged items as possible.

### 6. Build instructions & render
Combine all annotations into one JSON `{"annotations":[...]}` and run:
```bash
python scripts/annotate_pdf.py "<target>.pdf" /tmp/instructions.json "<target> annotated.pdf"
```

### 7. Verify before delivering
Render a few pages and read them back:
```bash
pdftoppm -png -r 110 -f 3 -l 6 "<target> annotated.pdf" /tmp/check
```
Confirm strikes land on the right numbers, stamped values are legible and clear the
`hrs`/`/hr` units, notes don't cover other text, and OEM flags read blue (distinct
from red cost gaps). Nudge `top`/`x` and re-run if anything overlaps. Then summarize
for the user: count of under-valued lines, labor/rate gaps, missing items, and OEM
flags — and hand over the PDF.

## Edge cases
- **More than two estimates**: compare pairwise; ask which pairing if ambiguous.
- **Scanned/flattened PDFs**: extractor needs real text; if it returns no priced
  lines, tell the user to supply a text-based estimate (or OCR first).
- **Don't invent values or citations.** Every stamped number comes from extracted
  data; every OEM cite comes from the reference file or the user's Egnyte library.
  When unsure, leave it unmarked and mention it.
