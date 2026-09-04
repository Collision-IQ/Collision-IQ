"""Bipartite line matching between two ledgers / row sets.

Priority:  1. exact part number (whitespace stripped, case-folded)
           2. (operation class, side, normalized description) token overlap >= 0.6 within the same CCC group
           3. (sublet/manual, dollar amount)
Clear-coat lines are excluded from line matching and compared as a section aggregate
(guide-computed on both platforms; per-line on CCC, one line on Mitchell).
Section-only resolution never produces a MISSING; it resolves UNKNOWN (matcher precondition rule).
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field
from .vocab import norm_desc, ccc_group
from .nomenclature import canonicalize, strip_note

OP_CLASS = {
    "Repl": "replace", "Remove / Replace": "replace", "R&I": "ri", "Remove / Install": "ri",
    "Rpr": "repair", "Repair": "repair", "Blnd": "blend", "Blend": "blend", "Refn": "refinish", "Refinish Only": "refinish",
    "O/H": "overhaul", "Overhaul": "overhaul", "Adj": "adjust", "Check / Adjust": "adjust", "Algn": "align", "Align": "align",
    "Subl": "sublet", "#": "manual", "Additional Labor": "manual", "Additional Operation": "manual", "Additional Cost": "manual",
}


@dataclass
class Item:
    key: str                 # 'L12' etc
    group: str
    op_class: str
    side: str
    desc: str
    desc_norm: str
    part_no: str
    price: float | None
    misc_amt: float | None
    labor: dict              # ems code -> hrs (inc excluded)
    is_clear_coat: bool
    ref: object = None
    is_profile_item: bool = False       # original Line / Row


def _pn(p: str) -> str:
    """Part-number key: alphanumerics only, upper case (CCC drops hyphens, Mitchell prints them)."""
    return re.sub(r"[^0-9A-Z]", "", (p or "").upper())


ADDON_RE = re.compile(r"^(add for|overlap|add to edge|add for edging|add for underside)", re.I)


def items_from_ledger(led) -> list[Item]:
    out = []
    for L in led.lines:
        if L.is_note: continue
        # CCC prints refinish add-ons (underside, edging, overlap) as their own lines under the panel; fold them
        if led.platform == "ccc" and ADDON_RE.search(L.description) and out and not L.part_no and "clear coat" not in L.description.lower():
            for lab in L.labor:
                if lab.inc: continue
                code = {"Body": "LAB", "Refinish": "LAR", "Paint": "LAR"}.get(lab.type, lab.type)
                out[-1].labor[code] = round(out[-1].labor.get(code, 0) + lab.hrs, 1)
            continue
        side, dn = norm_desc(L.description)
        labor = {}
        for lab in L.labor:
            if lab.inc: continue
            code = {"Body": "LAB", "Refinish": "LAR", "Paint": "LAR", "Mechanical": "LAM", "Structural": "LAS", "Frame": "LAF",
                    "Diagnostic": "LAD", "Electrical": "LAE", "Glass": "LAG"}.get(lab.type, lab.type)
            labor[code] = round(labor.get(code, 0) + lab.hrs, 1)
        grp = ccc_group(L.section, L.description) if led.platform == "mitchell" else L.section
        out.append(Item(f"L{L.line_no}", grp, OP_CLASS.get(L.operation, "other"), side, L.description, dn,
                        _pn(L.part_no) if L.part_no not in ("New", "Sublet") else "",
                        L.price, L.misc_amt, labor, "clear coat" in L.description.lower(), L,
                        bool(re.search(r"paint\s*/?\s*materials|paint supplies", L.description, re.I))))
    return out


def items_from_rows(rows: list[dict]) -> list[Item]:
    out = []
    for r in rows:
        side, dn = norm_desc(r["desc_src"])
        labor = {}
        for lab in r["labor"]:
            if lab["inc"]: continue
            labor[lab["ems"]] = round(labor.get(lab["ems"], 0) + lab["hrs"], 1)
        out.append(Item(f"L{r['src_line']}", r["group"], OP_CLASS.get(r["op_ccc"], "other"), side, r["desc_src"], dn,
                        _pn(r["part_no"]), r["price"], r["misc_amt"], labor,
                        "clear coat" in r["desc_src"].lower(), r,
                        bool(re.search(r"paint\s*/?\s*materials|paint supplies", r["desc_src"], re.I))))
    return out


def _overlap(a: str, b: str) -> float:
    """Token overlap scored against the shorter description, gated by the longer one
    (so 'air bag' cannot claim 'driver air bag' from 'disable & enable air bag system')."""
    ta, tb = set(a.split()) - {"&", "-", "+"}, set(b.split()) - {"&", "-", "+"}
    if not ta or not tb: return 0.0
    inter = len(ta & tb)
    if inter / max(len(ta), len(tb)) < 0.4: return 0.0
    return inter / min(len(ta), len(tb))


@dataclass
class Match:
    a: Item | None
    b: Item | None
    how: str            # 'part_no' | 'desc' | 'amount' | 'unmatched_a' | 'unmatched_b'
    score: float = 0.0


def match(a_items: list[Item], b_items: list[Item], same_group_required: bool = True) -> list[Match]:
    a_items = [i for i in a_items if not i.is_clear_coat and not i.is_profile_item]
    b_items = [i for i in b_items if not i.is_clear_coat and not i.is_profile_item]
    used_b, out = set(), []
    # pass 1: part number
    b_by_pn = {}
    for j, b in enumerate(b_items):
        if b.part_no: b_by_pn.setdefault(b.part_no, []).append(j)
    pending = []
    for a in a_items:
        if a.part_no and a.part_no in b_by_pn:
            j = next((k for k in b_by_pn[a.part_no] if k not in used_b), None)
            if j is not None:
                used_b.add(j); out.append(Match(a, b_items[j], "part_no", 1.0)); continue
        pending.append(a)
    # pass 2: description within op class (+ group if required)
    still = []
    for a in pending:
        best, bj = 0.0, None
        for j, b in enumerate(b_items):
            if j in used_b: continue
            if same_group_required and a.group != b.group and "UNMAPPED" not in (a.group, b.group): continue
            if a.side != b.side: continue
            if a.op_class != b.op_class and "other" not in (a.op_class, b.op_class) and "manual" not in (a.op_class, b.op_class) \
                    and not ({a.op_class, b.op_class} <= {"replace", "refinish", "sublet"}) \
                    and not ({a.op_class, b.op_class} <= {"repair", "align"}): continue
            s = _overlap(a.desc_norm, b.desc_norm)
            if s > best: best, bj = s, j
        if bj is not None and best >= 0.6:
            used_b.add(bj); out.append(Match(a, b_items[bj], "desc", best))
        else:
            still.append(a)
    # pass 2b: nomenclature — same line, different database name (MOTOR vs CEG).
    # Descriptions are note-stripped, re-normalized and rewritten through the
    # nomenclature table; a match additionally requires the numbers to agree
    # (identical labor-hour sets) unless the op classes were already equivalent
    # under pass-2 rules. Empty side is a wildcard here (Mitchell prints some
    # sided parts unsided: 'Frt Bumper Clip').
    def _op_ok(a, b):
        return a.op_class == b.op_class or "other" in (a.op_class, b.op_class) or "manual" in (a.op_class, b.op_class) \
            or ({a.op_class, b.op_class} <= {"replace", "refinish", "sublet"}) \
            or ({a.op_class, b.op_class} <= {"repair", "align"})
    still2 = []
    for a in still:
        ca = canonicalize(norm_desc(strip_note(a.desc))[1], a.group)
        best, bj = 0.0, None
        for j, b in enumerate(b_items):
            if j in used_b: continue
            if same_group_required and a.group != b.group and "UNMAPPED" not in (a.group, b.group): continue
            if a.side and b.side and a.side != b.side: continue
            numbers_agree = bool(a.labor) and a.labor == b.labor or \
                (a.price is not None and a.price == b.price) or (a.misc_amt is not None and a.misc_amt == b.misc_amt)
            if not (_op_ok(a, b) or numbers_agree): continue
            cb = canonicalize(norm_desc(strip_note(b.desc))[1], b.group, a.group)
            s = _overlap(ca, cb)
            if s > best: best, bj = s, j
        if bj is not None and best >= 0.6:
            used_b.add(bj); out.append(Match(a, b_items[bj], "nomenclature", best))
        else:
            still2.append(a)
    still = still2
    # pass 3: manual/sublet by amount
    for a in still:
        amt = a.misc_amt or a.price
        bj = None
        if amt:
            for j, b in enumerate(b_items):
                if j in used_b: continue
                if (b.misc_amt or b.price) == amt and a.op_class in ("manual", "sublet", "other") and b.op_class in ("manual", "sublet", "other") \
                        and _overlap(a.desc_norm, b.desc_norm) >= 0.3:
                    bj = j; break
        if bj is not None:
            used_b.add(bj); out.append(Match(a, b_items[bj], "amount", 0.5))
        else:
            out.append(Match(a, None, "unmatched_a"))
    for j, b in enumerate(b_items):
        if j not in used_b: out.append(Match(None, b, "unmatched_b"))
    return out
