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
| `help.cccis.com` → *Setting Up File Import Directories* | The import folder is configured at **Configure → Machine Settings → File Import**, with **Import Type = CIECA/EMS Files** and a folder path. Separate from the EXPORT directories, which are configured on their own page — a machine set up only to export has no import path at all. |
| `help.cccis.com` → *Overview - File Import and Export Settings* | **Contradicts the two pages above.** What CCC ONE can IMPORT is listed as "Part Update XML files, Workfile Copy, **EMS files (assignments)**" — assignments, parenthetically, with no mention of estimates. What it can EXPORT is listed as "**EMS version 2.01 estimate files**, EMS part price changes data to other applications, **Workfile Copy - AWF estimate files**". On this page an EMS *estimate* is an export only, and the estimate file that comes back IN is the AWF. |
| `help.cccis.com` → *Setting up EMS* / *Adding and Removing EMS Paths* | The **CCC ONE Data Transfer application must be running on the device** where the import directories are configured; it is what processes files found there. EMS must be enabled in Machine Settings before any of it applies. |

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
- **What has to be true on the shop's machine**, which is where this was mistaken for a
  product limit rather than a setup one:
  1. EMS enabled in **Configure → Machine Settings**.
  2. A **File Import** directory with **Import Type = CIECA/EMS Files**. Export
     directories are configured separately; a machine set up only to export has no
     import path, and dropping files anywhere else does nothing.
  3. The **CCC ONE Data Transfer application running** on that device — it is the thing
     that watches the folder.
  4. The tables **unzipped into the folder**. This build downloads a ZIP; CCC watches
     for the files themselves.
  A successful estimate import shows in Workfiles with Updates reading **"EMS Estimate"**
  (an assignment reads "EMS Assignment" — a different thing, and the distinction matters
  when reading whether an import worked).
- **Effort:** the writer is the work — a dBase III table writer, the field map per
  table (`.env .veh .lin .ttl .stl .ad1 .ad2 .pf*`), and the round-trip harness.
  Roughly a week of focused work to a first import, most of it in the `.lin` field map.
- **Risk, and unsettled — CCC's own pages disagree.** Two of them say an EMS *estimate*
  imports and give it its own Workfiles status; a third lists importable files as "EMS
  files (assignments)" and puts EMS 2.01 estimate files on the export side, with the
  AWF workfile copy as the estimate file that comes back in. The shop's account matches
  the third: EMS out to IA platforms, AWF in to CCC. And no page found says either way
  whether an EMS estimate authored by a THIRD-PARTY application — which is what this
  build produces — is treated like one CCC wrote.

  So this path is **contested, not proven**, and nothing in the build may assert
  otherwise. It has also never been tested on the machine in question: its Machine
  Settings show import enabled with the **CIECA/EMS Files directory empty**, so no EMS
  file has ever had a folder to land in there. One import against a configured install
  settles it. Until then the writer claims only that it produces a valid EMS 2.01
  export, which is true whoever reads it.

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
