# Keying into Mitchell — scope

**Status:** scope only. Nothing here is built. Today every sheet this build
produces keys into CCC, whichever platform's estimate was uploaded.

## The answer first

The input half is already done and costs nothing: the vocabulary's alias lists
carry **both** platforms' words today, which is how one reader translates either
print. What is single-valued is the OUTPUT — every table names its answer as a
CCC term.

The expensive half is not the tables. It is that the CCC-target mapping is a
**many-to-one projection, and it cannot be inverted**. Measured on the two real
Mitchell estimates here, Mitchell's `Front Bumper` and `Grille` both map to CCC's
`FRONT BUMPER & GRILLE`, and its `Additional Operations` maps to
`MISCELLANEOUS OPERATIONS` on one estimate and `VEHICLE DIAGNOSTICS` on the
other. Going the other way, a CCC group does not say which Mitchell section a
line belongs in — that is a per-line decision from the line's own wording.

So a Mitchell target needs its own section taxonomy and its own routing rules,
built from Mitchell documents. That is the gate, and it is an evidence gate
before it is an engineering one: the two estimates in this repository are both
front-impact, and between them they show **20 Mitchell section names**. Nobody
knows how many there are in total, and inventing the rest would be exactly the
fabrication this build refuses everywhere else.

## What already exists

| Piece | State |
| --- | --- |
| Reading either print | Done. Mitchell row anchors and the CCC column header both detected; `sourcePlatform` names which wrote the source. |
| Alias lists | Done, and bi-platform: `REMOVE REPLACE` (Mitchell) and `REPL` (CCC) are aliases of the same entry, on all 10 operations. |
| Part-type words | Done both ways for the types these documents use: `NEW`/`EXISTING`/`SUBLET`, plus `AFTERMARKET NEW`, `AFTERMARKET CERTIFIED`, `QUAL RECYCLED PART`. |
| EMS reading and writing | Platform-neutral. The Mitchell export reads with zero errors; the writer's tables are CIECA, not CCC. |
| Verification | Platform-neutral. It compares a sheet against any EMS export; only the gate insists the keyed side be CCC. |
| Totals categories | Keyed by EMS code, so they are already shared. |

## What a Mitchell target needs

### 1 · An output name per target, on every table (small, evidenced)

Each entry names one answer today. It needs one per target. The Mitchell words
are already measured off the real prints:

| CCC term | Mitchell term |
| --- | --- |
| `Repl` | Remove Replace |
| `R&I` | Remove Install |
| `Rpr` | Repair |
| `Refn` | Refinish Only |
| `Blnd` | Blend |
| `O/H` | Overhaul |
| `Aim` | Check Adjust |
| `Algn` | Align |
| `Subl` | Sublet |
| `Manual` | Additional Operation **or** Additional Cost |

Nine of the ten invert cleanly. `Manual` does not: Mitchell splits it by what
the line carries — `Additional Cost` on the materials line that prints $912.00
with no hours, `Additional Operation` on Clear Coat and Cover Car, which bill
hours. That is a rule, not a lookup, and it is the shape of everything below.

Part types invert cleanly for the five these documents use. `CAPA A/M` and
`Recond` have no Mitchell word in evidence here, and would be left unresolved
rather than guessed.

### 2 · The section taxonomy (the gate)

The 20 Mitchell section names these two estimates print, with what they map to
today:

```
Information Labels → INFORMATION LABELS      Front Bumper ┐
Front Lamps        → FRONT LAMPS             Grille       ┴→ FRONT BUMPER & GRILLE
Hood               → HOOD                    Front Fender → FENDER
Cooling            → COOLING                 Air Cleaner  → ENGINE / TRANSAXLE
Electrical         → ELECTRICAL              Rear Bumper  → REAR BUMPER
Front Door         → FRONT DOOR              Air Bag System → RESTRAINT SYSTEMS
A/C Heater Ventilation → AIR CONDITIONER & HEATER
Rocker Pillars Floor   → PILLARS, ROCKER & FLOOR
Front Inner Structure  → RADIATOR SUPPORT (or FRAME, by the line's wording)
Additional Costs Materials → MISCELLANEOUS OPERATIONS
Additional Operations      → MISCELLANEOUS OPERATIONS or VEHICLE DIAGNOSTICS
Special Manual Entry       → VEHICLE DIAGNOSTICS
```

Three of those are already one-to-many in the direction we have. Reversed, the
build would have to decide, per line, which Mitchell section a CCC group's line
belongs in — the same job `descriptionRouting` does today for
`FRONT INNER STRUCTURE`, but for the whole taxonomy rather than one group.

**This needs documents.** Both estimates here are front hits; nothing in them
shows Mitchell's rear, interior, glass or mechanical sections. Ten Mitchell
estimates across different impact areas would enumerate the list the way two CCC
exports enumerated CCC's — from the documents' own headings, not from a guess.

### 3 · The operation codes are NOT shared

Worth stating because it is counter-intuitive. Both platforms write CIECA
`LBR_OP` codes, and the ones they share agree — `OP11` replace, `OP2` R&I, `OP9`
repair, `OP0` manual. But:

- Mitchell writes `OP5` overhaul, `OP6` refinish, `OP8` aim, `OP13` materials,
  `OP14` clear coat. **CCC writes no code at all** on its own overhaul and aim
  lines — both are null in its export.
- CCC writes `OP11` on a refinish line (`Prep unprimed bumper`, labor type LAR),
  which Mitchell would code `OP6`.

So the op-code column is per-platform, and the three entries whose
`laborOpCode` is null today (`Refn`, `O/H`, `Aim`) are null because CCC leaves
them null — not because the code does not exist.

### 4 · What the rows are called — DONE

The four `…Ccc` fields have been renamed. The straight rename collided: step 1
had already added `operationTarget` and `partTypeTarget` holding the target
platform's WORD, while the old `operationCcc` / `partTypeCcc` are the KEY the
verification, the EMS codes and the writer all match on. Two different things
cannot share one name, so the split is named:

| Was | Now | What it holds |
| --- | --- | --- |
| `sectionCcc` | `sectionTarget` | The group the line is keyed under. Still CCC's group whatever the target — the gate in §2 is exactly why, and `targetGaps` states it. |
| `descriptionCcc` | `descriptionTarget` | The description an estimator types. Nomenclature, normalized, never translated. |
| `operationCcc` | `operationCanonical` | CCC's term as the canonical key. The word to display is `operationTarget`. |
| `partTypeCcc` | `partTypeCanonical` | CCC's term as the canonical key. The word to display is `partTypeTarget`. |

The sheet, the report and the panel display the target's word and fall back to
the canonical term where no document has shown this build that platform's word;
the row's own flag (`operation: not translated`, `part type: not translated`)
says which happened. This changes the downloaded ledger JSON, which is a
published artifact — the field names move, no value does.

## What does not change

The readers. The EMS reader and writer. The verification machinery, the
identity gate, the totals categories, the row matcher, the merge that takes the
source's own export. All of it is either platform-neutral already or keyed by
CIECA code.

## Sequence, and effort

1. **Target on the sheet, one output name per table** — the parameterization,
   the resolvers, the nine evidenced operations and five part types, with an
   unknown left unresolved. ~2 days. Verifiable on the documents in hand.
2. ~~**The naming decision** (§4)~~ — done; the fields carry the split.
3. **Gather Mitchell estimates** across impact areas and enumerate the section
   taxonomy from their own headings. The gate; no code until it is done.
4. **Section routing, CCC group → Mitchell section**, description-driven, built
   the way `descriptionRouting` already is. ~3 days once the taxonomy exists.
5. **Open the verification gate to a Mitchell keyed side** — one condition, once
   a sheet can target Mitchell. Half a day, and the machinery behind it is
   already proven against the real Mitchell export.

Roughly a week of engineering, gated on step 3, which is document collection
rather than code.

## Worth asking before any of it

Who rekeys a CCC estimate into Mitchell? A Mitchell shop taking a carrier's CCC
estimate is a real population, and it is the mirror of the case this build
already serves. But nothing in this repository measures how often it happens,
and the fourth quadrant is the only one of the four that needs any of the above
— the other three work today.

## Open verification items

- Mitchell's full section list, and whether its order is fixed the way CCC's is.
- The Mitchell words for `CAPA A/M` and `Recond`, which no document here prints.
- Whether Mitchell's `Additional Cost` / `Additional Operation` split is exactly
  "carries a charge" versus "carries hours", or something narrower.
- Whether `OP5` / `OP6` / `OP8` are Mitchell's own or CIECA codes CCC declines
  to write — a second CCC export with an overhaul line would settle it.
