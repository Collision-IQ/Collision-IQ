# Collision IQ — WO-RK1 consolidated packet v3 (4 Sep 2026)

Additive on v2. One logical change: the MOTOR<->CEG part-nomenclature table (`nomenclature.py`)
plus a matcher pass that uses it, and the F-RK3 clear-coat fixture slot.

## Changes since v2
| Area | Change | Why (fixture) |
|---|---|---|
| `nomenclature.py` (new) | MOTOR<->CEG synonym table (7 entries, all proven on F-RK2, group-scoped), `strip_note` for CCC ' - <note>' / truncated '(...' print artifacts | F-RK2 unmatched remainder was naming, not scope |
| `matching.py` | pass 2b "nomenclature": note-strip + canonicalize, empty side = wildcard, op relaxed only when labor-hour sets or prices are identical | 13 new pairs, all score 1.00, F-RK2 64 -> 77 pairs (27/18 -> 14/5 unmatched) |
| `tests/test_nomenclature.py` (new) | 4 tests: numbers-agree invariant, known pairs, totals unchanged (gross 358.38 / parts 326.43), scope + note-strip gates | — |
| `tests/test_fixture_frk3.py` (new) | self-activating slot for the third clear-coat fixture; SKIPs with instructions until `fixtures/F-RK3_*/` exists | round-once (21011) vs per-line (F-RK2) still unsettled |
| `samples/` | F-RK2 cross-platform review regenerated with the new matcher | — |

Totals-level findings are unchanged by design (asserted): the nomenclature pass may only
convert unmatched lines into pairs whose numbers already agree; it cannot move a dollar.
Remaining F-RK2 unmatched are genuine scope artifacts: CCC folds 'Add w/Parking Sensor'
onto the bumper line, 'Cover Car' is an untaxed sublet CCC books differently, and
'Upr Frt Body Seal' has no CCC counterpart at the same hours.

18 tests (17 + 1 fixture slot), all passing.


---

# Collision IQ — WO-RK1 consolidated packet (4 Sep 2026)

Supersedes the first packet (3 Sep, RO 21011 only, 9 tests). Every change is additive.

## Contents
- `collision_iq/` — package (13 modules), fixtures `RO_21011` and `F-RK2_1259209948`, tests (13, all passing)
- `samples/` — RO 21011 rekey sheet, EMS verification, cross-platform review; F-RK2 cross-platform review
- `WO-RK1_v2_rekey_sheet_and_ems_verification.md` — work order with the F-RK2 addendum; `WO-RK1_v1_original.md` for history

## Changes since the first packet
| Area | Change | Why (fixture) |
|---|---|---|
| `mitchell_ledger.py` | Changelog marker = `Supp/` column (not `CEG`); CEG column read as `Labor.db_hrs`; unit price + qty + `ext_price` on multi-qty lines; `Parts Adjustments`; claim/estimate-ID regexes for shop-profile prints | F-RK2: shop profile prints CEG time in the live table; `4 @ $1.98` extended prices; $273.86 sublet markup |
| `ems.py` | Reader accepts Mitchell EMS 2.0 layout (suffixed `A.AD1`/`V.VEH`, `OP5/OP6/OP13`, `PAE`, `T_ADDLBR`, hr-rate-with-threshold materials, tax from `pfl`); platform from `EST_SYSTEM`; PAS row includes untaxed sublet | F-RK2 Mitchell native EMS |
| `totals.py` / `rekey.py` | `Profile.sublet_markup_pct`; taxed sublet-type dollars typed `PAS` with markup; untaxed sublet bucketed separately | F-RK2 gross closes at $12,496.54 |
| `matching.py` | Part-number key alphanumerics only; CCC refinish add-on lines (`Add for Underside`, overlap) fold onto their panel; repair↔align and manual↔any op equivalence; noise-token stripping | F-RK2 pairs 36 → 64 |
| `vocab.py` | `NOISE_TOKENS`, hyphen/slash splitting, more abbreviations | F-RK2 |
| `crossplatform.py` / `reports.py` | Parts price differential over same-part-number pairs | F-RK2: +$326.43 on 24 shared part numbers |
| `ceg_ppages.py` | Clear-coat status `within_rounding` (≤0.1 h) | Mitchell rounds once on 21011, per line on F-RK2 |
| `ems_verify.py` | Sublet totals row includes PAS parts | round-trip regression |
| `tests/test_fixture_frk2.py` | 4 new tests | — |

## Run
```
python -m collision_iq.tests.run_tests
python -m collision_iq.cli rekey  collision_iq/fixtures/RO_21011/Mitchell_Estimate_21011.pdf out/
python -m collision_iq.cli review collision_iq/fixtures/F-RK2_1259209948/CCC/4b53232a "collision_iq/fixtures/F-RK2_1259209948/Mitchell/Mitchell Estimate 1259209948.pdf" out/ --label-a "CCC (MOTOR)" --label-b "Mitchell (CEG)"
```
