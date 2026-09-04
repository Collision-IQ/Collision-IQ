"""Module B - EMS Verification.

Compare the shop's CCC EMS export of a rekeyed estimate against the Mitchell ledger it was keyed
from.  Read-only.  Fail-closed gates first (EMS self-identification, line records, VIN / claim).
Pass criterion: every totals row at $0.00 / 0.0 h and no line findings.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field, asdict
from .mitchell_ledger import Ledger
from .totals import Profile, expected_totals
from . import ems as E
from .matching import items_from_rows, items_from_ledger, match
from .ceg_ppages import printed_clear_coat


@dataclass
class Finding:
    kind: str          # profile | identity | missing_in_ccc | extra_in_ccc | value_delta | totals
    ref: str
    detail: str
    expected: object = None
    actual: object = None
    delta: object = None


@dataclass
class VerifyReport:
    status: str                       # PASS | FAIL | BLOCKED
    gate: str = ""
    identity: dict = field(default_factory=dict)
    profile: list = field(default_factory=list)
    totals: list = field(default_factory=list)
    lines: list = field(default_factory=list)
    summary: dict = field(default_factory=dict)

    def to_dict(self): return asdict(self)


def _claim_core(c: str) -> str:
    return re.sub(r"-\d{1,2}$", "", (c or "").strip())


def verify(mitchell: Ledger, profile: Profile, ems_prefix: str) -> VerifyReport:
    S = E.read_ems(ems_prefix)
    ok, msg = E.gate(S)
    if not ok:
        return VerifyReport("BLOCKED", gate=msg)
    ccc = E.ems_to_ledger(S)
    rep = VerifyReport("PASS", gate=msg)
    # identity gate
    vin_ok = mitchell.vin.strip().upper() == ccc.vin.strip().upper()
    clm_ok = _claim_core(mitchell.claim_no) == _claim_core(ccc.claim_no)
    rep.identity = {"vin_mitchell": mitchell.vin, "vin_ccc": ccc.vin, "vin_match": vin_ok,
                    "claim_mitchell": mitchell.claim_no, "claim_ccc": ccc.claim_no, "claim_match": clm_ok}
    if not (vin_ok and clm_ok):
        rep.status = "BLOCKED"; rep.gate = "identity mismatch - comparison blocked"; return rep

    # profile check (reported first: a wrong profile explains every downstream delta)
    for code, rate in profile.rates.items():
        act = next((r["LBR_RATE"] for r in S["pfl"] if r["LBR_TYPE"].strip() == code), None) if S.has("pfl") else None
        if act is not None and abs(float(act) - rate) > 0.005:
            rep.profile.append(asdict(Finding("profile", f"rate {code}", "labor rate differs", rate, float(act), round(float(act) - rate, 2))))
    if S.has("pfm"):
        mapa = next((r for r in S["pfm"] if r["MATL_TYPE"].strip() == "MAPA"), None)
        if mapa and abs(float(mapa["CAL_LBRRTE"]) - profile.paint_rate) > 0.005:
            rep.profile.append(asdict(Finding("profile", "paint materials rate", "profile rate differs", profile.paint_rate, float(mapa["CAL_LBRRTE"]))))
    if S.has("pfp"):
        pal = next((r for r in S["pfp"] if r["PRT_TYPE"].strip() == "PAL"), None)
        if pal and abs(float(pal["PRT_MKUPP"]) - profile.lkq_markup_pct) > 0.0001:
            rep.profile.append(asdict(Finding("profile", "LKQ markup", "recycled-part markup differs", profile.lkq_markup_pct, float(pal["PRT_MKUPP"]))))
    if S.has("pft") and abs(float(S["pft"][0]["TY1_RATE1"]) / 100 - profile.tax_rate) > 0.00005:
        rep.profile.append(asdict(Finding("profile", "tax rate", "sales tax differs", profile.tax_rate, float(S["pft"][0]["TY1_RATE1"]) / 100)))

    # lines
    exp = expected_totals(mitchell, profile)
    a = items_from_rows(exp["rows"]); b = items_from_ledger(ccc)
    for m in match(a, b, same_group_required=False):
        if m.how == "unmatched_a":
            rep.lines.append(asdict(Finding("missing_in_ccc", m.a.key, m.a.desc)))
        elif m.how == "unmatched_b":
            rep.lines.append(asdict(Finding("extra_in_ccc", m.b.key, m.b.desc)))
        else:
            ea, eb = m.a, m.b
            if (ea.price or 0) != (eb.price or 0):
                rep.lines.append(asdict(Finding("value_delta", f"{ea.key}~{eb.key}", f"price: {ea.desc}", ea.price, eb.price, round((eb.price or 0) - (ea.price or 0), 2))))
            if (ea.misc_amt or 0) != (eb.misc_amt or 0) and not ((ea.misc_amt or 0) == (eb.price or 0)):
                rep.lines.append(asdict(Finding("value_delta", f"{ea.key}~{eb.key}", f"sublet amount: {ea.desc}", ea.misc_amt, eb.misc_amt)))
            for code in sorted(set(ea.labor) | set(eb.labor)):
                ha, hb = ea.labor.get(code, 0.0), eb.labor.get(code, 0.0)
                if abs(ha - hb) > 0.049:
                    rep.lines.append(asdict(Finding("value_delta", f"{ea.key}~{eb.key}", f"{code} hours: {ea.desc}", ha, hb, round(hb - ha, 1))))
            pa = ea.ref["part_type_ems"] if isinstance(ea.ref, dict) else ""
            pb = eb.ref.part_type if hasattr(eb.ref, "part_type") else ""
            if pa and pb and pa != pb and not (pa == "PAO" and pb == ""):
                rep.lines.append(asdict(Finding("value_delta", f"{ea.key}~{eb.key}", f"part type: {ea.desc}", pa, pb)))
    # clear coat as an aggregate
    cc_m, _ = printed_clear_coat(mitchell); cc_c, cc_lines = printed_clear_coat(ccc)
    if abs(cc_m - cc_c) > 0.049:
        rep.lines.append(asdict(Finding("value_delta", "clear coat (aggregate)", f"Mitchell single line vs CCC per-line adds {cc_lines}", cc_m, cc_c, round(cc_c - cc_m, 1))))

    # totals
    t = ccc.totals
    def trow(name, expv, actv, hrs=False):
        d = None if actv is None else round((actv - expv), 1 if hrs else 2)
        rep.totals.append({"row": name, "expected": expv, "actual": actv, "delta": d})
        if actv is None or abs(d) > (0.049 if hrs else 0.005):
            rep.summary.setdefault("totals_off", []).append(name)
    lb = exp["labor"]["by_type"]
    for code, name in (("LAB", "Body"), ("LAR", "Paint"), ("LAM", "Mechanical")):
        trow(f"{name} hours", lb.get(code, {}).get("hrs", 0.0), t.units.get(name if name != "Paint" else "Paint", t.units.get("Refinish")), hrs=True)
        trow(f"{name} amount", lb.get(code, {}).get("amt", 0.0), t.labor_amount.get(name, t.labor_amount.get("Refinish")))
    trow("Sublet amount", round(exp["labor"]["sublet_amt"] + exp["parts"]["by_type"].get("PAS", {}).get("amt", 0.0), 2), t.sublet.get("ALL"))
    trow("Parts (taxable)", exp["parts"]["total_amt"], t.parts_taxable)
    trow("Paint materials", exp["materials"]["paint_amt"], t.paint_materials)
    trow("Tax", exp["tax"], t.tax_total)
    trow("Gross total", exp["gross"], t.gross_total)

    rep.summary.update({"line_findings": len(rep.lines), "profile_findings": len(rep.profile),
                        "expected_gross": exp["gross"], "actual_gross": t.gross_total,
                        "unexplained": round((t.gross_total or 0) - exp["gross"], 2)})
    if rep.lines or rep.profile or rep.summary.get("totals_off"):
        rep.status = "FAIL"
    return rep
