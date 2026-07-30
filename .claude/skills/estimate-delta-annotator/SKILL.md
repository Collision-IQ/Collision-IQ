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

## The one rule that fixes the failure mode

**Never place an annotation at a coordinate you invented.** Every mark must be
anchored to a coordinate that was MEASURED from the document itself, and every
placement must be VERIFIED against a rendered image before delivery. If you
cannot measure it, don't mark the text — write a keyed note in measured
whitespace instead.

The placement pipeline below is the expansion of that sentence. It contains no
RO numbers, no carrier names, no page counts, no example values — it applies to
any document pair. Every workflow step that places ink is governed by it.

## Placement pipeline (extract → resolve → classify → place → render → verify → repair)

1. **EXTRACT — coordinates come from the PDF text layer, never from reasoning.**
   Parse the target PDF with a layout-aware extractor (pdfplumber / PyMuPDF words
   API). For every token you may later mark, record its bbox `[x0, top, x1, bottom]`
   in PDF points. Group tokens into rows by shared baseline (tolerance ~2pt). Store
   per row: section header, operation, description, part number, and the bbox of
   EVERY numeric cell (price, labor, paint, qty, rate, hours). If a needed cell has
   no extractable bbox, mark the row `bbox=null` — that row is only eligible for
   margin notes, never for strikes/highlights on the value.

2. **RESOLVE COLUMNS — measure, don't assume.** Column x-ranges differ per
   estimating platform, per template, even per page. Derive each value column's
   x-range from the union of the bboxes actually extracted for that column on that
   page (or, if extraction gave nothing, by rasterizing the page and clustering
   dark-pixel columns inside the row band). Pad the measured range by 3–6pt on both
   sides so suffix glyphs (`M`, `T`, `hrs`, `/hr`, `Incl.`, user-defined labor
   digits) are covered. Never reuse column x-ranges across documents or hardcode
   them.

3. **CLASSIFY — full-document keyword matching (direction-agnostic).** Match
   subject↔competing lines by canonical operation key across the ENTIRE other
   document (never by line number, position, or section). Classes: MATCHED
   (underline), VALUE_DELTA (strike/highlight the differing cell, stamp the other
   document's value), QTY_SHORTFALL (occurrences beyond the other document's count
   treated as MISSED), MISSED (no counterpart), plus reverse-pass items that exist
   only on the competing document (report them; never silently drop). Totals
   categories (hours, rates) are compared cell-by-cell the same way. Every stamped
   value is copied verbatim from extracted data — a value you cannot point to in
   extraction output does not get stamped.

4. **PLACE — two placement modes only.**
   a. *On-text marks* (underline / strike / highlight / value stamp): allowed ONLY
   on a bbox returned by step 1 or measured in step 2. The stamp text for a
   replaced value is drawn adjacent to the bbox; compute its rendered width (font
   metrics) and confirm the rectangle it will occupy does not intersect any other
   extracted token bbox on that row. If it would, fall back to mode (b).
   b. *Keyed margin notes*: for anything without a safe bbox (hour gaps when
   per-line hour cells didn't extract, MISSED items, multi-line findings), write
   `Ln <n>: <finding>` in page whitespace. Whitespace is DISCOVERED, not assumed:
   rasterize the ORIGINAL page and select a candidate region (bottom margin, header
   band, inter-table gap, wide intra-row gap) whose pixel content is empty. A
   region qualifies only if the original page has zero dark pixels inside the exact
   rectangle the note will occupy (note width = char count × font width; include
   the highlight pad). Stack multiple notes with a fixed step; when a band fills,
   split into columns or merge findings into one line — never overflow into the
   footer or the next content block.

5. **RENDER**, then 6. **VERIFY — machine-check, not vibes.** Render the annotated
   PDF to images. For EVERY on-text mark, verify programmatically:
   - dark (text) pixels exist INSIDE the highlight/strike rectangle (the mark
     actually covers a value), and
   - no dark pixels of the target value remain in a ~20pt strip immediately LEFT
     or RIGHT outside the rectangle at that row (the value isn't half-covered).
   For EVERY note, verify the same rectangle on the ORIGINAL render contains zero
   dark pixels (the note sits on true whitespace). Treat any failure as a defect,
   not a cosmetic issue.

7. **REPAIR — adjust from measurement, iterate to zero.** For each failed check,
   re-measure (cluster dark-pixel columns in the row band to find the true extent
   of the value; find the true end of an overlapping label), move or widen the mark
   by the measured amount, re-render, and re-verify. Loop until every check passes.
   Only then deliver.

### Hard prohibitions

- No coordinate from memory, estimation, or another document/page "that looked
  similar".
- No annotation on a row whose value bbox is null — margin note only.
- No delivery without the render-and-verify loop completing at zero failures.
- No invented stamped values or citations: stamped numbers come from extraction
  output; OEM/legal citations come from a retrieved document or verified search
  result, else the flag reads "verify" instead of citing.

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
  Stack multiple with a fixed step, but only in whitespace DISCOVERED per
  placement-pipeline step 4b — verify the note's rectangle is empty on the
  original render before writing into it. Skip pure procedure lines (scans,
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
in the **OEM color** (`"color":"blue","hl":"cyan"`) citing the position. To avoid
covering line text, place OEM notes in the page **bottom margin**, keyed to line
number, e.g. `OEM (Ln 23): MB requires new OEM part (MBUSA parts stmt)`; optionally
add a blue `underline` on that line's price to tie it. The bottom margin is a
candidate region, not a guarantee — qualify the exact note rectangle against the
original render per placement-pipeline step 4b before writing (footers and legal
text often occupy it), and stack with a fixed step only within the verified band.

Sourcing order: (1) search the user's **Google Drive** OE-docs library
(`search_files`, e.g. `fullText contains 'Mercedes position statement bumper'`)
and attach/link the matching statement; (2) if not found, run **Serper**
(`scripts/oem_search.py "<make> <topic> position statement"`, needs
`SERPER_API_KEY`) — or the built-in web search if the key is unset — and cite the
source URL; (3) fall back to the bundled reference summary. Never invent a
citation — if unsupported, flag `OEM: verify position statement` instead.

Also consider **jurisdictional law** (see the reference file's jurisdictional
section) using the owner's/shop's state from the estimate header — e.g.
aftermarket-parts disclosure/consent or OEM-procedure requirements. Law changes,
so verify the current statute (Serper / web search, or a legal doc in Google
Drive) before quoting it in a dispute. This OEM pass is the input to an **OEM citation density report**: aim to attach the strongest citation (OEM procedure/position statement,
then ADAS requirement, then applicable law) to as many flagged items as possible.

### 6. Build instructions & render
Combine all annotations into one JSON `{"annotations":[...]}` and run:
```bash
python scripts/annotate_pdf.py "<target>.pdf" /tmp/instructions.json "<target> annotated.pdf"
```

### 7. Verify before delivering — machine-check every mark, then repair to zero
Run placement-pipeline steps 5–7 on EVERY page that carries ink (not a sample):
render the annotated PDF, programmatically check each on-text mark (dark pixels
inside the rectangle; none of the value left half-covered in the ~20pt strips
beside it) and each note (its rectangle empty on the ORIGINAL render). Repair
failures by re-measuring — never by nudging a guessed offset — and loop until
zero failures. A human read-back of the renders is a final sanity pass on top,
not a substitute:
```bash
pdftoppm -png -r 110 "<target> annotated.pdf" /tmp/check
```
Confirm stamped values are legible and clear the `hrs`/`/hr` units and OEM flags
read blue (distinct from red cost gaps). Then summarize for the user: count of
under-valued lines, labor/rate gaps, missing items, and OEM flags — and hand over
the PDF.

## Edge cases
- **More than two estimates**: compare pairwise; ask which pairing if ambiguous.
- **Scanned/flattened PDFs**: extractor needs real text; if it returns no priced
  lines, tell the user to supply a text-based estimate (or OCR first).
- **Don't invent values or citations.** Every stamped number comes from extracted
  data; every OEM cite comes from the reference file, Google Drive, or Serper/web.
  When unsure, leave it unmarked and mention it.
