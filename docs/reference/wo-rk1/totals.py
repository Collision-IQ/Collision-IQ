"""CCC-style totals computed from rekey rows under a profile.
This is the arithmetic CCC ONE performs after the sheet is keyed, so the sheet can print the
expected totals page and Module B can compare an EMS export against them."""
from __future__ import annotations
from dataclasses import dataclass, field
from .mitchell_ledger import Ledger
from .vocab import LABOR_TYPE
from . import rekey


@dataclass
class Profile:
    rates: dict = field(default_factory=dict)      # EMS labor code -> $/hr  e.g. {'LAB': 61.0, 'LAR': 61.0, 'LAM': 100.0}
    paint_rate: float = 0.0                        # $ per refinish hour
    paint_cap_dollars: float = 9999.0
    tax_rate: float = 0.0
    tax_labor: bool = True
    tax_parts: bool = True
    tax_materials: bool = True
    lkq_markup_pct: float = 0.0
    sublet_markup_pct: float = 0.0                 # Mitchell 'Parts Adjustments' on sublet-type parts
    source: str = ""

    @classmethod
    def from_ledger(cls, led: Ledger) -> "Profile":
        t = led.totals
        rates = {LABOR_TYPE.get(k, k): v for k, v in t.rates.items()}
        cap = (t.paint_rate or 0) * (t.paint_rate_max_units or 0) if t.paint_rate_max_units else 9999.0
        prof = cls(rates=rates, paint_rate=t.paint_rate or 0.0, paint_cap_dollars=round(cap, 2) if cap else 9999.0,
                   tax_rate=t.tax_rate or 0.0, source=f"{led.platform} totals page")
        if t.parts_adjustments:
            rows, _ = rekey.build_rows(led, True)
            base = sum((r.price or 0) * (r.qty or 1) for r in rows if r.kind == "part" and r.part_type_ems == "PAS")
            if base:
                prof.sublet_markup_pct = round(t.parts_adjustments / base, 4)
        return prof


def expected_totals(led: Ledger, profile: Profile) -> dict:
    rows, hints = rekey.build_rows(led, profile.tax_labor)
    r2 = lambda x: round(x + 1e-9, 2)
    labor_by = {}
    for row in rows:
        for lab in row.labor:
            if lab["inc"]: continue
            b = labor_by.setdefault(lab["ems"], {"hrs": 0.0, "amt": 0.0, "tax": 0.0})
            b["hrs"] = round(b["hrs"] + lab["hrs"], 1)
    for code, b in labor_by.items():
        b["amt"] = r2(b["hrs"] * profile.rates.get(code, 0.0))
    sublet_amt = sum(row.misc_amt or 0 for row in rows if row.misc_amt)
    labor_amt = r2(sum(b["amt"] for b in labor_by.values()))
    labor_taxable = labor_amt + sublet_amt if profile.tax_labor else 0.0
    labor_tax = r2(labor_taxable * profile.tax_rate)
    for code, b in labor_by.items():
        b["tax"] = r2(b["amt"] * profile.tax_rate) if profile.tax_labor else 0.0

    parts_by = {}
    other_costs = 0.0
    for row in rows:
        if row.kind == "part":
            amt = r2((row.price or 0) * (row.qty or 1))
            if row.part_type_ems == "PAL": amt = r2(amt * (1 + profile.lkq_markup_pct))
            if row.part_type_ems == "PAS": amt = r2(amt * (1 + profile.sublet_markup_pct))
            b = parts_by.setdefault(row.part_type_ems or "PAO", {"amt": 0.0, "tax": 0.0}); b["amt"] = r2(b["amt"] + amt)
        elif row.kind == "cost":
            other_costs = r2(other_costs + (row.price or 0))
        elif row.kind == "sublet":
            b = parts_by.setdefault("SUBLET", {"amt": 0.0, "tax": 0.0}); b["amt"] = r2(b["amt"] + (row.misc_amt or 0))
    parts_amt = r2(sum(b["amt"] for k, b in parts_by.items() if k != "SUBLET"))
    parts_tax = r2(parts_amt * profile.tax_rate) if profile.tax_parts else 0.0
    for k, b in parts_by.items():
        b["tax"] = r2(b["amt"] * profile.tax_rate) if (profile.tax_parts and k != "SUBLET") or (k == "SUBLET" and profile.tax_labor) else 0.0

    paint_hrs = labor_by.get("LAR", {"hrs": 0.0})["hrs"]
    paint_amt = r2(min(paint_hrs * profile.paint_rate, profile.paint_cap_dollars))
    costs_taxable = (paint_amt + other_costs) if profile.tax_materials else 0.0
    costs_tax = r2(costs_taxable * profile.tax_rate)
    tax = r2(labor_tax + parts_tax + costs_tax)
    gross = r2(labor_amt + sublet_amt + parts_amt + paint_amt + other_costs + tax)
    return {
        "rows": [r.to_dict() for r in rows], "profile_hints": hints,
        "labor": {"by_type": labor_by, "total_hrs": round(sum(b["hrs"] for b in labor_by.values()), 1),
                  "total_amt": labor_amt, "sublet_amt": r2(sublet_amt), "total_tax": labor_tax},
        "parts": {"by_type": parts_by, "total_amt": parts_amt, "total_tax": parts_tax},
        "materials": {"paint_hrs": paint_hrs, "paint_rate": profile.paint_rate, "paint_amt": paint_amt,
                      "paint_tax": r2(paint_amt * profile.tax_rate) if profile.tax_materials else 0.0},
        "other_costs": other_costs, "other_costs_tax": r2(other_costs * profile.tax_rate) if profile.tax_materials else 0.0,
        "tax": tax, "gross": gross,
    }
