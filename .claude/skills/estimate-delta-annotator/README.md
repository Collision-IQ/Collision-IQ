# estimate-delta-annotator (Claude Code project skill)

Compares two collision-repair estimates and produces one annotated PDF of the
lower-cost estimate: cost gaps (under-valued prices, labor hours, and rates) in
red/yellow, and OEM/warranty/safety flags (aftermarket/used parts, skipped
scans/calibrations, one-time-use reuse) in blue/cyan with position-statement and
jurisdictional-law citations.

## How to use it

No setup or command needed — Claude Code auto-discovers this skill because it lives
in `.claude/skills/`. In a Claude Code session **inside this repo**, just ask
naturally with the two estimate PDFs available, e.g.:

- "Compare these two estimates and annotate the SOR."
- "Run the delta on claim 21999 — shop estimate vs. the insurer supplement."
- "Mark up the lower estimate and flag anything that contradicts OEM position statements."

To force it explicitly: `/estimate-delta-annotator`.

If you opened the session before this skill was added, start a fresh session so it
re-scans skills.

## What it does (auto)

1. Extracts both estimates (line items + ESTIMATE TOTALS with coordinates).
2. Auto-detects the higher estimate by grand total; annotates the lower one.
3. Cost pass — strikes under-valued line prices and stamps the higher value,
   underlines matches, notes missing items, and flags labor-hour/rate gaps in
   ESTIMATE TOTALS.
4. OEM pass — flags aftermarket/used parts, missing scans/calibrations, and
   one-time-use reuse in the page bottom margin, citing the position statement
   (bundled reference; pulls from the Collision Academy Egnyte library once that
   connector is authorized).

## Contents

- `SKILL.md` — the skill definition and workflow Claude follows.
- `scripts/extract_estimate.py` — PDF -> structured JSON (needs `pdfplumber`).
- `scripts/annotate_pdf.py` — applies markup (needs `reportlab`, `pypdf`).
- `references/oem_position_statements.md` — OEM triggers, citations, and PA
  jurisdictional-law pointers that feed the OEM citation density report.

## Requirements

Python 3 with `pdfplumber`, `reportlab`, and `pypdf`. If missing, install once:

```bash
pip install pdfplumber reportlab pypdf
```

## Input notes

- Works on text-based estimate PDFs (CCC ONE, Mitchell, Audatex). Scanned/flattened
  PDFs need OCR first — the extractor returns no priced lines otherwise.
- Column geometry assumes letter-size estimates; the scripts measure actual token
  positions, so minor layout drift is tolerated.
