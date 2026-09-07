# Applying a rekey to CCC — scope

**Status:** scope only. Nothing here is built. WO-RK1 §1 (no AWF generated, read or
reverse-engineered) stands unless it is explicitly revised.

## The answer first

A machine write-back to CCC is buildable, and this repository already holds most of
the payload. But **it does not produce what "apply the rekey to CCC" implies.** Every
line it writes lands in CCC as a *manual* line: no CCC database record behind it, no
CCC labor time, no parts price update. On the estimate measured here, the shop's own
work is **64 database-backed lines out of 93** — a write-back would convert all 93 to
manual and the estimator would have to re-select the database entries to get them
back. That ceiling is the same for every path below, because it comes from what the
ledger can know, not from the transport.

Second finding, from CCC's own documentation: the path I named last (Secure Share BMS)
is not the nearest one. **CCC ONE imports EMS estimates from a watched folder** — an
open CIECA format this repository already reads fluently, with a byte-level reference
specimen of the target system's own output to test against. It reaches the same
ceiling sooner and with no commercial gate, on desktop CCC ONE only.

## Evidence this scope is built on

| Document | What it proves |
| --- | --- |
| `CCC_V_Mitchell/Mitchell/1259209948.xml` | A real CIECA BMS `VehicleDamageEstimateAddRq` v5.2.28, Mitchell-authored, for the estimate we rekey. 93 `DamageLineInfo`, full `ProfileInfo` rate table, `RepairTotalsInfo` matching the printed totals to the cent. |
| `CCC_V_Mitchell/CCC/4b53232a.*` | The CCC EMS export of the same claim keyed in CCC — 14 dBase tables, already parsed by `src/lib/rekey/emsReader.ts` and verified against the sheet at 82 exact rows. |
| Both estimate PDFs | The printed form of each, already fixtures in this repository. |
| `help.cccis.com` → *Importing EMS Assignments and Estimates* | CCC ONE imports EMS assignments **and EMS estimates** automatically from the configured folder; the workfile Updates status reads "EMS Estimate". Importing EMS from other estimating applications is **not yet supported on cccone.com**. |

## What the ledger already carries

The rekey ledger is a better starting point than it looks: it was built to speak CCC's
vocabulary, and BMS is that vocabulary written down. Measured against the 48 distinct
per-line elements in the reference BMS:

**Carried today, directly**

| BMS element | Ledger field |
| --- | --- |
| `LineNum` | `sourceLine` |
| `LineDesc` | `descriptionTarget` |
| `LineHeaderDesc` | `sectionTarget` (the CCC group) |
| `ManualLineInd` | `operationCanonical === "Manual"`, the `manual line` flag |
| `LaborInfo/LaborType` | `labor[].type` — LAB, LAR, LAM, LAS |
| `LaborInfo/LaborOperation` | `laborOpCode` — OP11, OP2, OP9, OP4, OP0 |
| `LaborInfo/LaborHours` | `labor[].hours` |
| `LaborInfo/LaborInclInd` | `labor[].included` |
| `LaborInfo/*JudgmentInd` | `labor[].judgment`, the `judgment` flag |
| `PartInfo/PartType` | `partTypeEms` — PAN, PAA, PAL, PAC, PAR, PAS |
| `PartInfo/PartNum` | `partNumber` |
| `PartInfo/PartPrice` | `price` |
| `PartInfo/Quantity` | `qty` |
| `PartInfo/TaxableInd` | `taxable` |
| `PartInfo/PriceInclInd` | the `Incl.` flag |
| `SubletInfo/*` | `misc.sublet`, `partTypeCanonical === "Sublet"` |
| `OtherChargesInfo/OtherChargesType` + `Price` | `misc.amount` and the profile-routed cost labels |
| `LineMemo` | `notes` |
| `ProfileInfo/RateInfo` | the whole profile block — LAB/LAR/LAM rates, MAPA rate, the 25% sublet markup |
| `RepairTotalsInfo` | `expectedTotals` / `derivedTotals`, which already close at $0.00 |

**Derivable with work**

`ParentLineNum` (the folded refinish rows already record their parent line in a note),
`MaterialType` and `PaintStagesNum` (clear-coat and two-stage handling exists but is
not typed), `LineItemCategoryCode`.

**Cannot be supplied — and this is the ceiling**

`VendorRefNum`, `DatabaseLaborHours`, `LaborHoursCalc`, `OEMPartPrice`,
`PartSourceCode`, `UniqueSequenceNum`, `AutomatedEntry`, `LineStatusCode`,
`AppliedAdjustment`, `AfterMarketUsage`, `OrderByApplicationInd`, `GlassPartInd`.

These are the receiving database's own identity fields. `VendorRefNum` is the
estimating database's record id for that part or operation — `203597` for the cooler
caution label, `900500` for a manually typed line. `DatabaseLaborHours` is what the
database says the operation takes, against which the estimator's number is an
override. We are translating *another* system's estimate; we hold no CCC database id
and no CCC labor time, and inventing either would be fabricating evidence.

## What that means in practice

A write-back writes 93 lines with `ManualLineInd = 1` and `VendorRefNum` empty or
manual. In CCC that estimate:

- carries no database labor times, so nothing recalculates when the estimator changes
  an operation;
- carries no parts price updates and no MyPriceLink;
- is marked, in CCC's own audit trail, as manually entered throughout;
- still needs a human pass to re-select database parts and operations if the shop
  wants a normal CCC estimate rather than a typed one.

Against the shop's real CCC file — 64 of 93 lines database-backed, 36 carrying
database labor times — that is a materially different artifact. It is not nothing: it
saves the typing, preserves the group, operation, part type and taxability decisions
the sheet makes, and it cannot mistype a price. But it is *pre-population*, not a
rekey, and it should be named that way to the user.

## Paths

### A · Write an EMS estimate that CCC ONE imports (recommended first)

Generate CIECA EMS v2.01 tables from the ledger and drop them in the shop's configured
EMS import folder; CCC ONE picks them up and creates the workfile.

- **Format:** open, published, already read by `emsReader.ts`. No reverse engineering.
- **Test oracle available today:** write the tables, read them back with our own
  reader, and run the existing verification pass against the source sheet. A
  round-trip that reports zero findings is the acceptance criterion, and we have a
  real CCC-authored export of this very claim to diff field-by-field against.
- **Gate:** none commercially. Desktop CCC ONE only — CCC states EMS import from other
  estimating applications is not yet supported on cccone.com.
- **Effort:** the writer is the work — a dBase III table writer, the field map per
  table (`.env .veh .lin .ttl .stl .ad1 .ad2 .pf*`), and the round-trip harness.
  Roughly a week of focused work to a first import, most of it in the `.lin` field map.
- **Risk:** CCC may accept an EMS *assignment* more completely than an EMS *estimate*;
  unverified until we try one against a real CCC ONE install.

### B · Outbound BMS through Secure Share

Emit a `VehicleDamageEstimateAddRq` and deliver it through the CCC ONE partner API.

- **Format:** BMS, which the reference document specifies exactly and which
  `bmsEstimateNormalizer.ts` already parses inbound (982 lines of field mapping to
  reuse in reverse).
- **Gate:** a CCC partner agreement. Secure Share as this repository uses it today is
  strictly inbound — `src/app/api/integrations/ccc-secure-share/intake/route.ts` says
  so in its header: *"No CCC write-back, no scraping, no credentials."* Whether a
  partner may push an estimate **into** a workfile is a question for CCC, not one this
  scope can answer from documentation.
- **Effort:** the writer is comparable to path A; the schedule is dominated by the
  partner process, not by engineering.
- **Why it is still worth pursuing:** it is the modern, supported, web-and-desktop
  path, and CCC has signalled EMS as legacy since 2018 even as it keeps supporting it.

### C · AWF

Out of scope and staying there. Proprietary and unpublished; CCC's own documentation
warns that touching an AWF outside CCC ONE corrupts it; WO-RK1 §1 forbids it; and a
subtly wrong workfile copy writes bad data into a live file with no one reading it on
the way in.

## Recommended sequence

1. **Name the deliverable honestly in the product first.** Whatever we build, it
   pre-populates; it does not rekey. One line of UI copy, no engineering.
2. **Build the EMS writer behind a flag** (path A), with the round-trip harness as its
   test. It is the only path whose correctness we can prove in this repository today.
3. **Ask CCC the two questions** that decide path B: may a Secure Share partner write
   an estimate into a workfile, and is EMS estimate import coming to cccone.com. Both
   are emails, not engineering.
4. **Revisit BMS** once either answer lands.

## Open verification items

- Whether CCC ONE's EMS **estimate** import accepts a full line set, or only the
  subset it accepts on an assignment. Not confirmable without a CCC ONE install.
- Whether cccone.com will support EMS estimate import, and when.
- Whether Secure Share permits inbound estimate writes under any partner tier.
- The reference BMS books the sublet calibrations as `PartType PAE`, while this
  repository maps a printed "Sublet" to `PAS`. Both appear in CIECA part-type
  families; which one CCC expects on an imported line is unverified, and the sheet
  should not be changed on the strength of one document.
- Whether an imported manual line can later be "upgraded" to a database line in CCC
  without re-entry. If it can, the ceiling above is lower than it looks.
