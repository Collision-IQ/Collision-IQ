"""Ledger -> CCC-ordered rekey rows (the content of the Rekey Sheet and of the EMS lin table).

Row classification (document-shape, platform-neutral):
  note    : Mitchell 900501 rows / description-only rows           -> rendered as notes, not keyed
  cost    : 'Additional Cost' operation                             -> Paint/Materials becomes a PROFILE setting,
                                                                       everything else a manual $ row
  part    : has a price and the estimate marks it taxable           -> part row (includes taxed manual $ lines)
  sublet  : has a price, not marked taxable                          -> sublet row (MISC_AMT, OP16), taxed as labor
  labor   : everything else
Refinish-only lines fold into the immediately preceding emitted row when they share a description token.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field, asdict
from .vocab import OPERATION, PART_TYPE, LABOR_TYPE, ccc_group, group_rank, norm_desc
from .mitchell_ledger import Ledger, Line


@dataclass
class Row:
    src_line: int
    supp_tag: str | None
    section_src: str
    group: str
    desc_src: str
    desc_ccc: str
    op_src: str
    op_ccc: str
    lbr_op: str
    kind: str
    part_type_src: str = ""
    part_type_ccc: str = ""
    part_type_ems: str = ""
    part_no: str = ""
    part_no_src: str = ""
    vendor: str = ""
    qty: int | None = None
    price: float | None = None
    price_judgment: bool = False
    tax: bool = False
    misc_amt: float | None = None
    misc_sublet: bool = False
    labor: list = field(default_factory=list)   # [{'type','ems','hrs','inc','judgment','clear_coat_calc'}]
    notes: list = field(default_factory=list)
    folded_from: list = field(default_factory=list)
    keyable: bool = True

    def to_dict(self): return asdict(self)


PAINT_MATERIALS_RE = re.compile(r"paint\s*/?\s*materials|paint supplies", re.I)


def classify(L: Line) -> str:
    if L.is_note: return "note"
    if L.operation == "Additional Cost": return "cost"
    if L.price is not None and L.taxable is True: return "part"
    if L.price: return "sublet"          # non-taxed dollars = sublet booked to labor
    return "labor"                       # $0.00 with no tax flag is a labor-only line


def _desc_ccc(desc: str) -> str:
    d = re.sub(r"^R(?=\s)", "RT", desc); d = re.sub(r"^L(?=\s)", "LT", d)
    return d


def _shares_token(a: str, b: str) -> bool:
    ta = set(norm_desc(a)[1].split()) - {"outside", "add", "to", "for", "only", "assembly", "panel"}
    tb = set(norm_desc(b)[1].split())
    return bool(ta & tb)


def build_rows(ledger: Ledger, profile_labor_tax: bool = True) -> tuple[list[Row], dict]:
    rows: list[Row] = []
    profile_hints = {}
    last_row: Row | None = None
    for L in ledger.lines:
        kind = classify(L)
        grp = ccc_group(L.section, L.description) if ledger.platform == "mitchell" else L.section
        if kind == "note":
            if last_row is not None:
                last_row.notes.append(f"L{L.line_no}: {L.description}")
            continue
        if kind == "cost" and PAINT_MATERIALS_RE.search(L.description):
            profile_hints["paint_materials_amount"] = L.price
            continue
        # fold refinish-only into previous row
        if L.operation == "Refinish Only" and last_row is not None and last_row.section_src == L.section \
                and last_row.kind in ("part", "labor") and _shares_token(L.description, last_row.desc_src):
            for lab in L.labor:
                last_row.labor.append(_lab(lab))
            last_row.folded_from.append(L.line_no)
            last_row.notes.append(f"L{L.line_no}: {L.description} {L.labor[0].hrs if L.labor else ''} refinish folded")
            continue
        op_ccc, lbr_op = OPERATION.get(L.operation, (L.operation, "OP0"))
        if kind == "sublet":
            op_ccc, lbr_op = "Subl", "OP16"
        pt_ccc, pt_ems = PART_TYPE.get(L.part_type, (L.part_type, ""))
        if kind == "part" and (L.part_type == "Sublet" or L.operation == "Additional Operation"):
            pt_ccc, pt_ems = "Subl", "PAS"       # taxed sublet dollars: a part of type sublet (Mitchell PAS); markup may apply
        elif kind == "part" and not pt_ems:
            pt_ccc, pt_ems = "Misc", "PAO"       # taxed manual dollars are booked as parts by both platforms
        row = Row(src_line=L.line_no, supp_tag=L.supp_tag, section_src=L.section, group=grp,
                  desc_src=L.description, desc_ccc=_desc_ccc(L.description), op_src=L.operation, op_ccc=op_ccc,
                  lbr_op=lbr_op, kind=kind, part_type_src=L.part_type, part_type_ccc=pt_ccc, part_type_ems=pt_ems,
                  part_no=L.part_no if L.part_no not in ("New", "Sublet") else "", part_no_src=L.part_no_src,
                  vendor=L.vendor, qty=L.qty, price_judgment=L.price_judgment)
        if kind == "part" or kind == "cost":
            row.price = L.price; row.tax = True
            if kind == "cost":
                row.part_type_ccc, row.part_type_ems, row.op_ccc, row.lbr_op = "Misc", "", "#", "OP0"
        elif kind == "sublet":
            row.misc_amt = L.price; row.misc_sublet = True; row.tax = profile_labor_tax
            row.part_type_ccc, row.part_type_ems = "Subl", "PAO"
        for lab in L.labor:
            row.labor.append(_lab(lab))
        if any(l["clear_coat_calc"] for l in row.labor):
            row.notes.append("Mitchell 'C': included in clear-coat calculation")
        if "clear coat" in L.description.lower():
            row.notes.append("Guide aggregate clear coat: key as ONE manual refinish line; do not distribute")
        rows.append(row); last_row = row
    rows.sort(key=lambda r: group_rank(r.group))      # stable: Mitchell order within a group
    return rows, profile_hints


def _lab(lab) -> dict:
    return {"type": lab.type, "ems": LABOR_TYPE.get(lab.type, "LAB"), "hrs": lab.hrs, "inc": lab.inc,
            "judgment": lab.judgment, "clear_coat_calc": lab.clear_coat_calc}
