"""Estimating-guide procedure rules ("P-pages") for cross-platform dispute review.

Two guides share one interface:

* MITCHELL_CEG  - transcribed from Mitchell's published CEG Procedure Explanations
                  (https://static.mymitchell.com/static/Webhelp/ppages/ceg/1033/Content/ceg020000.htm,
                  Procedure 28 Refinish; pages ceg022803 / ceg022804).  Authoritative for
                  Mitchell-written estimates.
* MOTOR_CCC     - CCC / MOTOR Guide to Estimating.  The build already carries the full MOTOR
                  source; the entries below are a SEED covering the refinish operations that
                  matter for cross-platform review and must be reconciled against that source.

Two things this module does:

1. `clear_coat_hours()` reproduces the guide's clear-coat calculation from the estimate's
   refinish lines so a printed aggregate (Mitchell) or the sum of per-line adds (CCC) can be
   validated rather than trusted.
2. `lost_costs()` lists not-included operations the guide allows for the operations that are
   actually on the estimate but which no line claims -> "lost cost" candidates for a dispute
   review, cited to the guide.

Nothing here references a carrier, shop, make or RO.
"""
from __future__ import annotations
from dataclasses import dataclass, field
import re

CEG_URL = "https://static.mymitchell.com/static/Webhelp/ppages/ceg/1033/Content/"


@dataclass(frozen=True)
class NotIncluded:
    key: str
    operation: str            # human label
    guide: str                # 'MITCHELL_CEG' | 'MOTOR_CCC'
    citation: str             # page / section reference
    trigger: str              # when this candidate applies (evaluated by lost_costs)
    detect: tuple             # lowercase tokens that mean the estimate already claims it
    allowance: str = ""       # guide-stated allowance, if any
    verified: bool = True     # False for MOTOR seed entries pending reconciliation


@dataclass
class ClearCoatRule:
    guide: str
    first_panel_pct: float = 0.40
    first_panel_extra_pct: float = 0.40     # jamb / interior / edge / underside on first panel
    additional_pct: float = 0.20
    additional_extra_pct: float = 0.20
    cap_hours: float | None = 2.5           # new undamaged parts only
    cap_exclusions: tuple = ("bumper cover", "fascia", "ground effect", "underside", "edge", "jamb", "interior", "entryway")
    citation: str = ""
    flexible_at_first_pct: bool = False   # MOTOR seed: flexible parts (bumper cover, grille) each at first-panel pct
    exclude_blend: bool = False           # MOTOR seed: blend time already carries clear; no add
    exclude_manual: bool = True           # manual (#) refinish-labor lines are never panels


# --------------------------------------------------------------------------- Mitchell CEG
CEG_REFINISH_INCLUDED = (
    "Solvent wash", "Scuff panel and clean",
    "Mask adjacent panels up to 36 inches or substitute with cover vehicle (bag) complete",
    "Prime or seal as required", "Final sanding and clean", "Mix materials",
    "Adjust spray equipment", "Apply color", "Clean equipment",
)

CEG_CLEAR_COAT = ClearCoatRule(
    guide="MITCHELL_CEG",
    citation=CEG_URL + "ceg022804.htm  (Procedure 28, Clear Coat/Two Stage Refinish)",
)

MITCHELL_CEG: list[NotIncluded] = [
    NotIncluded("blend", "Blend into adjacent panel(s) or nearest breaking point", "MITCHELL_CEG",
                CEG_URL + "ceg022803.htm (Refinish Not Included)", "refinish_present", ("blend",)),
    NotIncluded("tint", "Color match or tinting", "MITCHELL_CEG",
                CEG_URL + "ceg022803.htm (Refinish Not Included)", "refinish_present", ("tint", "color match", "colour match")),
    NotIncluded("anti_corrosion", "Applying anti-corrosion / rust-resistant materials", "MITCHELL_CEG",
                CEG_URL + "ceg022803.htm (Refinish Not Included)", "panel_replaced_or_repaired",
                ("corrosion", "cavity wax", "rust", "anti-corr")),
    NotIncluded("anti_chip", "Additional application of soft chip primers or anti-chip undercoats", "MITCHELL_CEG",
                CEG_URL + "ceg022803.htm (Refinish Not Included)", "lower_panel_refinished", ("chip", "anti-chip", "gravel")),
    NotIncluded("sand_buff", "Finish sand and buff", "MITCHELL_CEG",
                CEG_URL + "ceg022803.htm (Refinish Not Included)", "refinish_present",
                ("sand & buff", "sand and buff", "finish sand", "polish", "buff", "de-nib", "denib")),
    NotIncluded("bagging", "Subsequent vehicle bagging when required", "MITCHELL_CEG",
                CEG_URL + "ceg022803.htm (Refinish Not Included)", "multi_stage_refinish",
                ("car cover", "bag vehicle", "bagging", "cover vehicle", "mask for primer"),
                allowance="add .2 hour for each application & removal"),
    NotIncluded("mask_interior", "Mask interior to prevent overspray damage", "MITCHELL_CEG",
                CEG_URL + "ceg022803.htm (Refinish Not Included)", "jamb_or_edge_refinished",
                ("mask interior", "mask jamb", "mask for refinish", "mask openings")),
    NotIncluded("protective_coating", "Removal of protective coatings", "MITCHELL_CEG",
                CEG_URL + "ceg022803.htm (Refinish Not Included)", "new_panel_installed",
                ("protective coating", "transit coating", "remove coating")),
    NotIncluded("raw_substrate", "Removal of release agent from OEM raw plastic (raw substrate prep)", "MITCHELL_CEG",
                CEG_URL + "ceg022815.htm (Raw Substrate Prep)", "bumper_cover_refinished",
                ("raw substrate", "release agent", "adhesion promoter", "prep raw", "unprimed")),
    NotIncluded("fpb", "Feather, prime & block on repaired / welded-adjacent panels", "MITCHELL_CEG",
                CEG_URL + "ceg022803.htm (Refinish Not Included)", "panel_repaired",
                ("feather", "prime & block", "prime and block", "fpb")),
    NotIncluded("gravel_guard", "Gravel guard refinish", "MITCHELL_CEG",
                CEG_URL + "ceg022803.htm (Refinish Not Included)", "lower_panel_refinished",
                ("gravel guard", "chip guard", "texture"),
                allowance="add .5 hour first major panel, .3 hour each additional panel"),
    NotIncluded("paint_materials", "Paint and materials (not included in refinish time)", "MITCHELL_CEG",
                CEG_URL + "ceg022803.htm (Refinish Not Included)", "refinish_present",
                ("paint/materials", "paint materials", "paint supplies")),
]

# --------------------------------------------------------------------------- MOTOR seed (CCC)
MOTOR_CLEAR_COAT = ClearCoatRule(
    guide="MOTOR_CCC", citation="MOTOR Guide to Estimating - Refinish: Clear Coat (seed; reconcile with build's MOTOR source)",
    flexible_at_first_pct=True, exclude_blend=True)

MOTOR_CCC: list[NotIncluded] = [
    NotIncluded("blend", "Blend adjacent panels", "MOTOR_CCC", "MOTOR G-pages Refinish Not Included", "refinish_present", ("blend",), verified=False),
    NotIncluded("tint", "Color tint", "MOTOR_CCC", "MOTOR G-pages Refinish Not Included", "refinish_present", ("tint", "color match"), verified=False),
    NotIncluded("sand_buff", "Color sand and buff", "MOTOR_CCC", "MOTOR G-pages Refinish Not Included", "refinish_present",
                ("sand & buff", "sand and buff", "finish sand", "polish", "buff", "de-nib", "denib"), verified=False),
    NotIncluded("mask_interior", "Mask jambs / interior for overspray", "MOTOR_CCC", "MOTOR G-pages Refinish Not Included", "jamb_or_edge_refinished",
                ("mask interior", "mask jamb", "mask for refinish", "mask openings"), verified=False),
    NotIncluded("flex_additive", "Flex additive for flexible parts", "MOTOR_CCC", "MOTOR G-pages Refinish Not Included", "bumper_cover_refinished",
                ("flex additive", "flex agent"), verified=False),
    NotIncluded("anti_corrosion", "Anti-corrosion / cavity wax on replaced welded panels", "MOTOR_CCC", "MOTOR G-pages Body Not Included", "panel_replaced_or_repaired",
                ("corrosion", "cavity wax", "rust", "anti-corr"), verified=False),
    NotIncluded("fpb", "Feather, prime & block on repaired panels", "MOTOR_CCC", "MOTOR G-pages Refinish Not Included", "panel_repaired",
                ("feather", "prime & block", "prime and block", "fpb"), verified=False),
    NotIncluded("raw_substrate", "Prep raw / unprimed plastic (adhesion promoter)", "MOTOR_CCC", "MOTOR G-pages Refinish Not Included", "bumper_cover_refinished",
                ("raw substrate", "release agent", "adhesion promoter", "prep raw", "unprimed"), verified=False),
    NotIncluded("haz_waste", "Hazardous waste disposal", "MOTOR_CCC", "MOTOR G-pages Not Included", "refinish_present",
                ("hazardous", "haz waste"), verified=False),
    NotIncluded("paint_materials", "Paint and materials", "MOTOR_CCC", "MOTOR G-pages Not Included", "refinish_present",
                ("paint/materials", "paint materials", "paint supplies"), verified=False),
]

GUIDES = {"MITCHELL_CEG": (MITCHELL_CEG, CEG_CLEAR_COAT), "MOTOR_CCC": (MOTOR_CCC, MOTOR_CLEAR_COAT)}
PLATFORM_GUIDE = {"mitchell": "MITCHELL_CEG", "ccc": "MOTOR_CCC"}


# --------------------------------------------------------------------------- clear coat
@dataclass
class RefinishPanel:
    line_no: int
    description: str
    hours: float
    is_extra: bool = False        # jamb / interior / edge / underside add
    is_bumper_cover: bool = False
    is_flexible: bool = False
    is_new_undamaged: bool = False


EXTRA_RE = re.compile(r"\b(underside|edge|edging|jamb|interior|inside)\b", re.I)
BUMPER_RE = re.compile(r"\b(bumper cover|fascia|bumper cvr|air dam|valance|upper cover|lower cover)\b", re.I)
FLEXIBLE_RE = re.compile(r"\b(bumper cover|fascia|bumper cvr|air dam|valance|upper cover|lower cover|grille)\b", re.I)
OVERLAP_RE = re.compile(r"\boverlap\b", re.I)


def clear_coat_hours(panels: list[RefinishPanel], rule: ClearCoatRule) -> dict:
    """Reproduce the guide's aggregate clear-coat time.

    First major panel (first non-extra refinish line in estimate order) at first_panel_pct;
    its own extras at first_panel_extra_pct; every other refinish line at additional_pct.
    Returns {'hours', 'per_line': [(line_no, pct, hrs)], 'cap_applied', 'cap_basis_hours'}.
    Rounding is done once on the aggregate (Mitchell's convention); per-line rounded values are
    also returned because CCC stamps them per line.
    """
    per_line = []
    first_seen = False
    first_line = None
    for p in panels:
        if p.hours <= 0:
            continue
        if rule.flexible_at_first_pct and p.is_flexible and not p.is_extra:
            pct = rule.first_panel_pct
            if not first_seen:
                first_seen = True; first_line = p.line_no
        elif not first_seen and not p.is_extra:
            pct = rule.first_panel_pct
            first_seen = True
            first_line = p.line_no
        elif p.is_extra and first_line is not None and p.line_no == first_line:
            pct = rule.first_panel_extra_pct
        elif p.is_extra:
            pct = rule.additional_extra_pct
        else:
            pct = rule.additional_pct
        per_line.append((p.line_no, pct, p.hours * pct))
    raw = sum(h for _, _, h in per_line)
    # cap: applies to the new-undamaged, non-excluded subset only
    cap_basis = sum(h for (ln, _, h), p in zip(per_line, [q for q in panels if q.hours > 0])
                    if p.is_new_undamaged and not p.is_bumper_cover and not p.is_extra)
    cap_applied = bool(rule.cap_hours is not None and cap_basis > rule.cap_hours)
    if cap_applied:
        raw -= (cap_basis - rule.cap_hours)
    return {
        "guide": rule.guide,
        "hours": round(raw + 1e-9, 1),
        "hours_unrounded": round(raw, 3),
        "per_line": [(ln, pct, round(h + 1e-9, 1)) for ln, pct, h in per_line],
        "per_line_sum": round(sum(round(h + 1e-9, 1) for _, _, h in per_line), 1),
        "cap_applied": cap_applied,
        "cap_basis_hours": round(cap_basis, 2),
        "citation": rule.citation,
    }


def panels_from_ledger(ledger, rule: ClearCoatRule | None = None) -> list[RefinishPanel]:
    """Refinish (LAR) panel lines in estimate order, both platforms:
    Mitchell: labor.type == 'Refinish' with the 'C' flag; the aggregate clear-coat line itself is excluded.
    CCC:      LAR lines excluding 'Add for Clear Coat', manual (#/OP0) refinish-labor lines, and (MOTOR) blends;
              'Overlap ...' lines (negative LAR) net against the preceding panel."""
    rule = rule or GUIDES[PLATFORM_GUIDE[ledger.platform]][1]
    out = []
    prev_part_op = ""
    for L in ledger.lines:
        if L.operation not in ("Refinish Only", "Blend", "Blnd") and (L.part_no or L.operation in ("Remove / Replace", "Repl", "Repair", "Rpr")):
            prev_part_op = L.operation
        d = L.description.lower()
        for lab in L.labor:
            if lab.type not in ("Refinish", "Paint"):
                continue
            if "clear coat" in d:
                continue
            if ledger.platform == "mitchell" and not lab.clear_coat_calc:
                continue
            if ledger.platform == "ccc":
                if OVERLAP_RE.search(d) and out:
                    out[-1].hours = round(out[-1].hours + lab.hrs, 1)   # lab.hrs is negative
                    continue
                if rule.exclude_manual and L.operation == "#":
                    continue
                if rule.exclude_blend and L.operation in ("Blnd", "Blend"):
                    continue
                if lab.hrs <= 0:
                    continue
            out.append(RefinishPanel(
                line_no=L.line_no, description=L.description, hours=lab.hrs,
                is_extra=bool(EXTRA_RE.search(L.description)),
                is_bumper_cover=bool(BUMPER_RE.search(L.description)),
                is_flexible=bool(FLEXIBLE_RE.search(L.description)),
                is_new_undamaged=((L.operation if L.operation not in ("Refinish Only",) else prev_part_op) in ("Remove / Replace", "Repl")
                                  and not bool(EXTRA_RE.search(L.description))),
            ))
    return out


def printed_clear_coat(ledger) -> tuple[float, list[int]]:
    """Clear-coat hours the estimate actually carries: Mitchell aggregate line or CCC per-line adds."""
    total, lines = 0.0, []
    for L in ledger.lines:
        if "clear coat" in L.description.lower():
            for lab in L.labor:
                if lab.type in ("Refinish", "Paint"):
                    total += lab.hrs; lines.append(L.line_no)
    return round(total, 1), lines


def validate_clear_coat(ledger) -> dict:
    guide = PLATFORM_GUIDE[ledger.platform]
    rule = GUIDES[guide][1]
    calc = clear_coat_hours(panels_from_ledger(ledger, rule), rule)
    printed, lines = printed_clear_coat(ledger)
    calc.update({"printed_hours": printed, "printed_lines": lines,
                 "delta": round(printed - calc["hours"], 1),
                 "status": "match" if abs(printed - calc["hours"]) < 0.051
                           else "within_rounding" if abs(printed - calc["hours"]) < 0.151 else "divergent"})
    return calc


# --------------------------------------------------------------------------- lost costs
def _triggers(ledger) -> dict[str, list[int]]:
    t: dict[str, list[int]] = {k: [] for k in (
        "refinish_present", "panel_replaced_or_repaired", "panel_repaired", "new_panel_installed",
        "bumper_cover_refinished", "jamb_or_edge_refinished", "lower_panel_refinished", "multi_stage_refinish")}
    refinish_lines = 0
    for L in ledger.lines:
        d = L.description.lower()
        has_ref = any(l.type in ("Refinish", "Paint") and l.hrs > 0 for l in L.labor)
        if has_ref:
            refinish_lines += 1
            t["refinish_present"].append(L.line_no)
            if BUMPER_RE.search(d): t["bumper_cover_refinished"].append(L.line_no)
            if EXTRA_RE.search(d): t["jamb_or_edge_refinished"].append(L.line_no)
            if re.search(r"\b(rocker|valance|air dam)\b|\b(lower|lwr)\s+(door|quarter|qtr|body)", d): t["lower_panel_refinished"].append(L.line_no)
        if L.operation in ("Repair", "Rpr"):
            t["panel_repaired"].append(L.line_no); t["panel_replaced_or_repaired"].append(L.line_no)
        if L.operation in ("Remove / Replace", "Repl") and re.search(r"\b(panel|fender|hood|door|quarter|rocker|pillar|roof|rail|apron|support)\b", d):
            t["new_panel_installed"].append(L.line_no); t["panel_replaced_or_repaired"].append(L.line_no)
    if refinish_lines >= 2:
        t["multi_stage_refinish"] = list(t["refinish_present"])
    return t


@dataclass
class LostCost:
    key: str
    operation: str
    guide: str
    citation: str
    allowance: str
    triggered_by: list[int]
    claimed_by: list[int]
    status: str            # 'claimed' | 'lost' | 'n/a'
    verified_rule: bool


def lost_costs(ledger, guide: str | None = None) -> list[LostCost]:
    guide = guide or PLATFORM_GUIDE[ledger.platform]
    entries, _ = GUIDES[guide]
    trig = _triggers(ledger)
    descs = [(L.line_no, L.description.lower()) for L in ledger.lines]
    out = []
    for e in entries:
        fired = trig.get(e.trigger, [])
        claimed = [ln for ln, d in descs if any(tok in d for tok in e.detect)]
        if e.key == "paint_materials" and (ledger.totals.paint_materials or 0) > 0 and not claimed:
            claimed = ["totals"]
        if e.key == "blend":
            claimed += [L.line_no for L in ledger.lines if L.operation in ("Blend", "Blnd") and L.line_no not in claimed]
        if not fired:
            status = "n/a"
        elif claimed:
            status = "claimed"
        else:
            status = "lost"
        out.append(LostCost(e.key, e.operation, e.guide, e.citation, e.allowance, fired, claimed, status, e.verified))
    return out
