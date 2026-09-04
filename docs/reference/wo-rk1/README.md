> **Reference implementation — published without its fixtures.**
>
> This is the WO-RK1 Python packet, kept here as the reference the shipping
> TypeScript modules under `src/lib/rekey/` are checked against. It is not
> wired into the build and nothing imports it.
>
> Two things were removed before it was committed, because this repository is
> public and the packet was built on real repair orders:
>
> * **`fixtures/` is not here.** Those files are unredacted claim documents —
>   vehicle owners' names and address, personal phone numbers, license plates,
>   policy and claim numbers, and named adjusters' work emails. None of it
>   belongs in a public repository.
> * **VINs and claim numbers were redacted** from the text that remains, and
>   read `<VIN-REDACTED-...>` / `<CLAIM-REDACTED>`.
>
> So **the test suite described below does not run as published** — it asserts
> redacted identifiers against fixtures that are absent. The fixture-derived
> numbers in the tests are left intact deliberately: they are the record of what
> each document actually produced, and they are the evidence behind the
> TypeScript port. Run the suite from the original packet, not from here.
>
> `samples/` and the WO-RK1 work-order documents were left out for the same
> reason; they print the VINs and claim numbers on their first page.

# Collision IQ — Rekey, EMS Verification & Cross-Platform Review (WO-RK1 v2)

Python package for three jobs:

| Command | Input | Output |
|---|---|---|
| `rekey`  | Mitchell PDF | CCC-ordered **Rekey Sheet** (PDF), ledger + rows JSON, and a **CIECA EMS 2.01 file set** (14 dBase tables + memo stub) carrying the same lines, prices, hours, rates and totals |
| `verify` | Mitchell PDF + the shop's CCC EMS export of the rekeyed estimate | **EMS Verification** report — profile check, line-by-line match, totals to the penny; PASS only at $0.00 unexplained |
| `review` | any two estimates (Mitchell PDF or EMS prefix) | **Cross-platform review** — rates, labor differential over matched operations, clear-coat aggregate, unmatched lines, and the P-page **bridge** (lost costs under both guides) |

```
python -m collision_iq.cli rekey  fixtures/RO_21011/Mitchell_Estimate_21011.pdf out/
python -m collision_iq.cli verify fixtures/RO_21011/Mitchell_Estimate_21011.pdf out/RO_..._ems/<CLAIM-REDACTED> out/
python -m collision_iq.cli review fixtures/RO_21011/Mitchell_Estimate_21011.pdf fixtures/RO_21011/ab7f6e93 out/ --label-a "Mitchell SOR S2" --label-b "CCC preliminary"
python -m collision_iq.tests.run_tests          # 9 fixture tests (pytest optional)
```
Dependencies: `pdfplumber`, `reportlab`. No network.

## What this is not
It does **not** produce a CCC `.AWF`. AWF is CCC's proprietary OLE workfile with internal MOTOR database keys; it is undocumented, its container did not open with standard OLE tooling, and reverse-engineering it would breach CCC's terms and risk corrupting a shop's CCC database. Estify does not hand shops an AWF either — it delivers through CCC's partner channel and the lines arrive as manual entries. The EMS set produced here is the open-standard equivalent: same content, importable where the shop's CCC edition exposes EMS import, and in every case the authoritative reference the verification pass reconciles against.

## Module map
```
normalize.py        overprint normalization (token[0::2]==token[1::2]; min_len=4 data / 2 structural)
mitchell_ledger.py  Mitchell PDF -> Ledger.  Header-derived bands, S\d + 1-3 digit anchor, changelog partition
                    by the 'CEG' header column (continuation pages included), section = line-band text with no
                    anchor, footer = repeated header / 'Page N of M', vendor columns from 'Line' header x-positions
ems.py              CIECA EMS 2.01 reader/writer (self-describing dBase III), CCC-EMS -> Ledger, fail-closed gate
ems_schema.py       14 table schemas captured from a CCC ONE 5.61 export
vocab.py            Mitchell<->CCC operation / part-type / labor-type / section maps (platform vocabulary only)
rekey.py            Ledger -> CCC-ordered rows; refinish-only folding; part / sublet / cost / labor classification
totals.py           Profile + CCC-style expected totals (rates, materials cap, tax by category, LKQ markup)
ceg_ppages.py       Mitchell CEG Procedure 28 rules (transcribed), MOTOR seed, clear-coat formula, lost-cost engine
nomenclature.py     MOTOR<->CEG synonym table (group-scoped, fixture-proven) + print-artifact note-strip
matching.py         bipartite line matcher (part no -> description -> nomenclature -> amount); clear coat & materials excluded
ems_verify.py       Module B
crossplatform.py    dispute review + bridge
reports.py          the three PDFs
cli.py / tests/     entry points and RO 21011 regression fixtures
```

## Rules that came out of the fixture (all document-shape, none carrier-specific)
* **Clear coat is a formula, not a line.** Mitchell CEG: 40 % of the first refinish panel, 20 % of each additional (+40/20 for jamb/edge/underside), rounded once on the aggregate. Reproduced exactly (3.1 h). CCC/MOTOR stamps the same arithmetic per line, excludes blends, nets overlap, and applies the first-panel rate to flexible parts; reproduced exactly (2.9 h with the per-line stamps CCC printed). Therefore: key the aggregate as **one** manual refinish line (distributing rounds to 3.2), and **compare clear coat as a section aggregate** — never line by line.
* **Paint materials close.** CCC computes rate × refinish hours with a cap; set the CCC profile to Mitchell's per-unit rate and the number matches ($701.40). The profile block prints first on the sheet and is checked first in verification. (Corrects an earlier assumption that materials could not reconcile.)
* **Taxed dollars are parts, untaxed dollars are sublet booked to labor.** Mitchell books a taxed sublet (flex additive) in Taxable Parts and untaxed sublets (car cover, corrosion, scans) inside taxable labor. Classifying by the Tax column, not by the part-type label, closes parts to $6,594.49 and labor to $3,325.00.
* **LKQ markup must be zeroed.** The shop profile carried 25 %; Mitchell recycled prices are net.
* **Overprint dedupe must stay at min_len=4 for data.** `33` collapsed to `3` at min_len=2 and mis-keyed a vendor.

## Paired-VIN database fixture (next)
Write the same CCC estimate in Mitchell (same VIN, options, lines; labor untouched) and export both. `review` on that pair isolates pure MOTOR-vs-CEG time differences in section 2 (labor differential over matched operations), because scope is held constant; sections 5/6 should be near-empty and the bridge will show only guide-vocabulary gaps. That pair becomes fixture F-RK2 and the acceptance test for the matcher (≥ 95 % of lines paired by part number or description).

## Guide sources
Mitchell CEG Procedure Explanations: https://static.mymitchell.com/static/Webhelp/ppages/ceg/1033/Content/ceg020000.htm (Procedure 28, pages ceg022803 / ceg022804 transcribed in `ceg_ppages.py`). MOTOR entries are a seed marked `verified=False`; reconcile with the build's existing MOTOR source.


## F-RK2 results (paired VIN <VIN-REDACTED-F-RK2> — same estimate, CCC vs Mitchell, labor untouched)
Holdout caught four universality defects, all fixed and now under test:
1. A shop Mitchell profile prints a **CEG (database time) column in the live table** — the v1 changelog rule keyed on that column and partitioned every line page away. Changelog marker is now the `Supp/` column (and absence of Qty/Tax). The CEG column is captured as `Labor.db_hrs`.
2. Mitchell prints the **extended** price on multi-quantity lines (`4 @ $1.98` → $7.92); ledger now stores unit price + qty + `ext_price`.
3. **Sublet markup** — Mitchell "Parts Adjustments" ($273.86 = 25 % of $1,095.45 sublet-type parts). Profile now carries `sublet_markup_pct`; gross closes at $12,496.54.
4. **Part-number keys**: CCC drops hyphens (`521190X948` vs `52119-0X948`); keys are now alphanumerics only.
Also: Mitchell's native EMS 2.0 export (suffixed `9508501A.AD1 / 9508501V.VEH`, `OP5/OP6/OP13`, `PAE`, `T_ADDLBR`, hr-rate-with-threshold materials) reads correctly; the PDF ledger matches it line for line.

What the pair shows (see `samples/F-RK2_1259209948_crossplatform_review.pdf`): gross +$358.38 on Mitchell, of which **+$326.43 is OEM price on the same 24 part numbers** (20 of 24 differ) — the parts database, not labor, drives most of the gap. Body labor over 55 matched operations: Mitchell +1.8 h; refinish −0.6 h (CCC blends the aluminium fenders at 1.8 each, Mitchell at 0.8 = 40 % of a 2.0 CEG panel); clear coat 2.6 vs 2.5. Mitchell's own clear-coat aggregate rounds differently between the two fixtures (round-once on 21011, per-line on this one); the validator reports `within_rounding` at |Δ| ≤ 0.1 until a third fixture settles it. Matcher (v3, with the nomenclature table) pairs 77 lines (was 64); every nomenclature pair agrees on hours or price by construction. The 5 remaining Mitchell-side unmatched are scope artifacts, not naming: CCC folds the parking-sensor adds onto the bumper line, Cover Car is an untaxed sublet CCC books differently, and Upr Frt Body Seal has no CCC counterpart at the same hours.
