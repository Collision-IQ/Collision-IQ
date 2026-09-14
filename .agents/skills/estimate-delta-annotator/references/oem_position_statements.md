# OEM Position Statements — detection triggers & citations

This reference lets the skill flag items on the **lower (insurer) estimate** that
contradict OEM position statements, warranty terms, part availability, or safety
guidance — the "why" behind a supplement. Each flag should name the position and,
where possible, cite a source the shop can attach.

## How to use this file

1. During the estimate review, scan the lower estimate's line items (and the
   boilerplate legal/disclosure text) for the **triggers** below.
2. When a trigger fires, add a `note` annotation in the **OEM color**
   (`"color":"blue","hl":"cyan"`) near the offending line, e.g.
   `OEM: MB requires new OEM structural parts — see position stmt`.
3. Sourcing (per user config — "bundled now, Google Drive later"):
   - **Bundled**: cite the position summarized here + its public source.
   - **Google Drive**: search the OE-docs library (`search_files`,
     `fullText contains '...'`) and attach/link the matching PDF; prefer the
     user's own document over the summary here.
   - **Serper / web**: `scripts/oem_search.py "<make> <topic> position statement"`
     (needs `SERPER_API_KEY`), or the built-in web search, to find the public
     statement or statute; cite the source URL.
4. Never assert a position statement exists for a make/topic you can't support.
   If unsure, flag the item as "verify OEM position" rather than inventing a cite.

## Estimate abbreviations that signal non-OEM parts

These appear in the `oper`/`desc`/`part` fields or the estimate legend. Any of
them on a **structural or safety** part is a strong flag:

- `A/M` — Aftermarket part (non-OEM)
- `LKQ` — Like Kind & Quality (used/salvage)
- `RECOND`, `Recore` — reconditioned / recored
- `NAGS` — aftermarket glass (National Auto Glass Specifications)
- `OPT OEM`, `ALT OEM` — alternate-sourced OEM (may be discounted/gray-market)
- `CAPA` — certified aftermarket (still non-OEM)
- `USED`, `RCY` — used / recycled

## General triggers (most makes)

| Trigger on lower estimate | Position typically taken | Public source to cite |
|---|---|---|
| Aftermarket/used **structural** parts (rails, apron, radar/sensor brackets, reinforcements) | Most OEMs require **new OEM** structural parts; aftermarket/used can compromise crash performance & ADAS aim | OEM position stmt via OEM1Stop.com; I-CAR RTS |
| ADAS part R&R/replace (radar, front camera, surround-view, headlamp) **without** pre- and post-repair scan | OEMs require pre/post scans to detect DTCs | Most-makes scan position stmts (OEM1Stop) |
| ADAS sensor/camera/headlamp replaced or aimed **without** calibration line | Static/dynamic calibration required after R&I/replacement or alignment | OEM calibration position stmts (OEM1Stop); I-CAR |
| One-time-use fasteners/parts reused (bolts, nuts, absorbers, clips, rivets) marked "Incl." or omitted | OEM requires replacement, not reuse | OEM repair procedures; estimate's own "Part cannot be reused/reinstalled" NOTE |
| Blend/refinish or overlap deductions that undercut OEM refinish procedure | OEM refinish procedures; not a "included" op | OEM refinish position stmts |
| Aftermarket bumper reinforcement / crash parts on ADAS-equipped bumper | Non-OEM may alter sensor geometry | OEM ADAS + parts position stmts |

## Mercedes-Benz specific (relevant to GLE / this claim family)

- **Parts**: Mercedes-Benz USA position: use **genuine MB (OEM) parts**; aftermarket,
  used, or reconditioned parts are not approved and may affect fit, safety systems,
  and warranty. Flag any `A/M`/`LKQ`/`RECOND` MB part, especially structural,
  sensor-bracket, or absorber items.
- **Diagnostics**: MB requires **pre- and post-repair diagnostic scans** on
  collision-damaged vehicles. Flag ADAS work lacking a scan line.
- **Calibration**: MB requires calibration of driver-assistance components (radar,
  multipurpose camera, surround-view) after removal, replacement, or alignment.
  Flag replaced/aimed sensors, cameras, or headlamps with no calibration line.
- **One-time-use**: MB designates many fasteners/absorbers as replace-once. The
  estimate's own `NOTE: Part cannot be reused/reinstalled` lines corroborate this —
  cite them directly when the lower estimate omits the replacement.

## Legal / disclosure language to scan (bottom of estimate)

Insurer estimates carry boilerplate that can *support* the shop's position — quote
it back:

- "**LIKE KIND AND QUALITY**" / aftermarket-parts warranty clauses: the insurer, not
  the OEM, warrants A/M parts — leverage against safety-critical A/M usage.
- "**Parts availability / vehicle should not be left for repairs until parts are
  available**": supports OEM-parts lead time & storage.
- "**AFTERMARKET CRASH PART … warranty equal to or better than existing warranty**":
  if an A/M part voids the OEM warranty, this clause is contradicted.
- Any statement that appraisal reflects only "visible damage" — supports supplements
  for related/hidden OEM-required operations.

## Output style for OEM flags

Keep flags short and citable. Prefer:
`OEM: <make> requires <requirement> — <short source>`
Examples:
- `OEM: MB requires new OEM structural part (see MBUSA parts stmt)`
- `OEM: MB pre/post scan required — no scan on this ADAS line`
- `OEM: calibration required after sensor R&I (MBUSA ADAS stmt)`
- `OEM: one-time-use — estimate's own note says part cannot be reused`

## Jurisdictional law (feeds the OEM citation density report)

Beyond OEM position statements, applicable **state law** can support requiring OEM
parts/procedures or disclosure. Use the vehicle owner's / repair facility's state
(from the estimate header). Laws change — when law is material to a dispute, verify
the **current** statute via web search or the user's Google Drive legal folder before
citing; don't rely on a remembered section number.

General principles most states share (verify specifics per state):
- **Aftermarket parts disclosure/consent** — insurers must identify non-OEM parts on
  the estimate and often obtain the owner's informed consent; parts must be "like
  kind and quality." An A/M substitution without disclosure/consent is a flag.
- **Right to choose repairer / anti-steering** — owner may choose the shop.
- **Betterment / OEM procedures** — several states + the Unfair Claims Settlement
  Practices framework support paying for manufacturer-required procedures (scans,
  calibrations) when documented as necessary.

**Pennsylvania (this claim: Malvern / Berwyn, PA)** — starting points to verify:
- PA Motor Vehicle Physical Damage Appraiser Act (63 P.S.) and the appraiser
  regulations (31 Pa. Code) governing how appraisals are written.
- PA Unfair Insurance Practices Act / unfair claims settlement regulations.
- Aftermarket/non-OEM parts disclosure & consent expectations.
Confirm exact citations and current text at runtime before quoting in a dispute.

### OEM citation density report (framing)

The OEM pass is also the input to an **OEM citation density report** whose goal is to
improve repair operations using OEM procedures, position statements, ADAS
requirements, and jurisdictional law. For each flagged item, aim to attach the
strongest available citation in this order: (1) the OEM repair procedure or position
statement for the make, (2) ADAS/scan/calibration requirement, (3) applicable
jurisdictional law. "Density" = how many line items on the estimate carry at least
one such citation — higher coverage = a stronger, better-documented supplement.
