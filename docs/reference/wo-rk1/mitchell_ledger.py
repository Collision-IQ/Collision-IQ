"""Mitchell Cloud Estimating PDF -> Ledger.

Document-shape rules only (no carrier / shop / make / RO literals):

* Column bands are derived from each page's own header row
  ("Line # Description Operation Type Total Units Type Number Qty Total Price Tax").
* A page is a live line-table page iff it has that header AND the header has
  no "CEG" column.  The changelog ("Delta Report") header carries "Supp/",
  "Item" and "CEG" columns -> partitioned out, including continuation pages
  that lack the banner.
* Row anchor: optional supplement tag (S\\d) followed by a 1-3 digit integer in
  the line-number band.  6-digit item numbers live in the next band and are
  never anchors.
* Section headers: a row with text only in the description band and no anchor.
* Rates / units / totals are read from the "Estimate Totals" block on
  overprint-normalized text.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field, asdict
from typing import Optional
import pdfplumber
from .normalize import normalize, money, hours as parse_hours, flags as parse_flags

HEADER_TOKENS = ("Line", "Description", "Operation", "Units", "Number", "Qty", "Price")


@dataclass
class Labor:
    type: str            # Body | Refinish | Mechanical | Frame | Structural | ...
    hrs: float
    inc: bool = False
    judgment: bool = False
    labor_note: bool = False
    ceg_rr_time: bool = False
    clear_coat_calc: bool = False   # Mitchell 'C' flag
    db_hrs: Optional[float] = None  # database (CEG) time when the profile prints it


@dataclass
class Line:
    line_no: int
    supp_tag: Optional[str]
    item_no: str                   # 'AUTO', 6-digit item, 900500 (manual), 900501 (note)
    section: str
    description: str
    operation: str
    labor: list[Labor] = field(default_factory=list)
    part_type: str = ""
    part_no: str = ""
    part_no_src: str = ""
    qty: Optional[int] = None
    price: Optional[float] = None          # UNIT price (both platforms)
    ext_price: Optional[float] = None      # extended price as printed (Mitchell prints qty x unit)
    price_judgment: bool = False
    taxable: Optional[bool] = None
    vendor: str = ""
    misc_amt: Optional[float] = None     # sublet / misc dollars (CCC MISC_AMT)
    misc_sublet: bool = False
    misc_tax: bool = False
    is_note: bool = False
    page: int = 0


@dataclass
class Totals:
    rates: dict = field(default_factory=dict)       # {'Body': 61.0, 'Refinish': 61.0, 'Mechanical': 100.0}
    units: dict = field(default_factory=dict)       # hours by labor type
    sublet: dict = field(default_factory=dict)      # sublet $ by labor type
    labor_amount: dict = field(default_factory=dict)
    labor_total_taxable: Optional[float] = None
    parts_taxable: Optional[float] = None
    parts_adjustments: Optional[float] = None   # Mitchell: markup on sublet-type parts
    paint_materials: Optional[float] = None
    paint_units: Optional[float] = None
    paint_rate: Optional[float] = None
    paint_rate_max_units: Optional[float] = None
    other_costs: Optional[float] = None
    tax_rate: Optional[float] = None
    tax_total: Optional[float] = None
    gross_total: Optional[float] = None
    deductible: Optional[str] = None


@dataclass
class Ledger:
    platform: str
    source_file: str
    vin: str = ""
    claim_no: str = ""
    estimate_id: str = ""
    supplement_no: str = ""
    vehicle: str = ""
    lines: list[Line] = field(default_factory=list)
    totals: Totals = field(default_factory=Totals)
    vendors: dict = field(default_factory=dict)   # line_no -> vendor name
    pages_live: list[int] = field(default_factory=list)
    pages_changelog: list[int] = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


# --------------------------------------------------------------------------- bands
def _header_bands(rows: dict[int, list]) -> tuple[Optional[dict], bool, int]:
    """Return (bands, is_changelog, header_top).  bands keyed by column name -> x0."""
    for top in sorted(rows):
        toks = {normalize(w["text"], 2): round(w["x0"]) for w in rows[top]}
        if sum(t in toks for t in HEADER_TOKENS) >= 5:
            # Changelog header carries a 'Supp/' column and no Qty/Tax columns.  A 'CEG' column is NOT a marker:
            # shop profiles print database (CEG) time in the live table.  (Holdout 1259209948.)
            is_changelog = "Supp/" in toks or ("Item" in toks and "Qty" not in toks)
            names = ["Line", "Description", "Operation", "Type", "Total", "Type2", "Number", "Qty", "Price", "Tax"]
            xs = sorted(round(w["x0"]) for w in rows[top])
            # Map by order of x positions; duplicate 'Type'/'Total' handled by order.
            ordered = sorted(((round(w["x0"]), normalize(w["text"], 2)) for w in rows[top]))
            bands = {}
            seen_type = seen_total = 0
            for x, t in ordered:
                if t == "Line": bands["line"] = x
                elif t == "Description": bands["desc"] = x
                elif t == "Operation": bands["op"] = x
                elif t == "Type":
                    seen_type += 1
                    bands["ltype" if seen_type == 1 else "ptype"] = x
                elif t == "Total":
                    seen_total += 1
                    bands["units" if seen_total == 1 else "price"] = x
                elif t == "CEG": bands["ceg"] = x
                elif t == "Number": bands["number"] = x
                elif t == "Qty": bands["qty"] = x
                elif t == "Tax": bands["tax"] = x
            return bands, is_changelog, top
    return None, False, -1


def _col(bands: dict, x: float) -> str:
    order = ["line", "desc", "op", "ltype", "units", "ceg", "ptype", "number", "qty", "price", "tax"]
    cur = "line"
    for name in order:
        if name in bands and x >= bands[name] - 2:
            cur = name
    return cur


ANCHOR_RE = re.compile(r"^\d{1,3}$")
SUPP_RE = re.compile(r"^S\d$")


def parse_mitchell(path: str) -> Ledger:
    led = Ledger(platform="mitchell", source_file=path)
    pdf = pdfplumber.open(path)
    section = ""
    all_text = []
    for pno, page in enumerate(pdf.pages, start=1):
        words = page.extract_words(extra_attrs=["fontname"])
        text = _norm_lines(page.extract_text() or "")
        all_text.append(text)
        rows: dict[int, list] = {}
        for w in words:
            rows.setdefault(round(w["top"]), []).append(w)
        bands, is_changelog, htop = _header_bands(rows)
        if bands is None:
            continue
        if is_changelog:
            led.pages_changelog.append(pno)
            continue
        led.pages_live.append(pno)
        # Stop marker: body pages end where a section named like the legend / vendors begins.
        footer_top = _footer_top(rows, htop, page.height)
        # Collect anchors
        anchors = []
        for top in sorted(rows):
            if top <= htop or top >= footer_top:
                continue
            ws = sorted(rows[top], key=lambda w: w["x0"])
            line_band = [w for w in ws if _col(bands, w["x0"]) == "line"]
            ints = [w for w in line_band if ANCHOR_RE.match(w["text"])]
            supp = [w["text"] for w in line_band if SUPP_RE.match(w["text"])]
            if ints:
                anchors.append((top, int(ints[0]["text"]), supp[0] if supp else None))
        anchor_tops = [a[0] for a in anchors]
        body_rows = [t for t in sorted(rows) if htop < t < footer_top]

        def desc_only(top):
            """Section header: every word sits in the line band and none is an anchor / supp tag / item no."""
            ws = rows[top]
            if {_col(bands, w["x0"]) for w in ws} != {"line"}:
                return False
            return not any(ANCHOR_RE.match(w["text"]) or SUPP_RE.match(w["text"]) or re.fullmatch(r"\d{6}|AUTO", w["text"]) for w in ws)

        def row_text(top):
            return normalize(" ".join(w["text"] for w in sorted(rows[top], key=lambda w: w["x0"])), 2)

        # rows before the first anchor block that are desc-only -> section header(s)
        first_lo = (anchor_tops[0] - 3) if anchor_tops else footer_top
        for top in body_rows:
            if top < first_lo and desc_only(top):
                section = row_text(top)

        for i, (atop, lno, supp) in enumerate(anchors):
            lo = atop - 3
            hi = (anchor_tops[i + 1] - 3) if i + 1 < len(anchors) else footer_top
            cells = {k: [] for k in ["line", "desc", "op", "ltype", "units", "ceg", "ptype", "number", "qty", "price", "tax"]}
            last_top = None
            line_section = section
            in_line = True
            for top in body_rows:
                if not (lo <= top < hi):
                    continue
                if in_line and desc_only(top):
                    in_line = False           # line-band text with no anchor = section header
                if not in_line:
                    section = row_text(top)   # applies to FOLLOWING lines
                    continue
                for w in sorted(rows[top], key=lambda w: w["x0"]):
                    cells[_col(bands, w["x0"])].append((top, w["text"]))
                last_top = top
            led.lines.append(_build_line(lno, supp, cells, line_section, pno))
    _parse_header(led, all_text)
    _parse_totals(led, all_text)
    _parse_vendors(led, all_text)
    for L in led.lines:
        L.vendor = led.vendors.get(L.line_no, "")
    return led


def _footer_top(rows, htop, page_h):
    """First row below the header that is structurally not table body:
    a repeated column header, a 'Page N of M' row, the legend, the vendor/totals blocks."""
    header_seen = False
    for top in sorted(rows):
        if top <= htop:
            continue
        toks = [normalize(w["text"], 2) for w in sorted(rows[top], key=lambda w: w["x0"])]
        t = " ".join(toks)
        if sum(x in toks for x in HEADER_TOKENS) >= 5:
            return top
        if re.search(r"\bPage \d+ of \d+\b", t) or t.startswith("Committed On") or t.startswith("Committed"):
            return top
        if t.startswith("* Judgment Item") or t.startswith("Parts Vendors") or t.startswith("Estimate Totals"):
            return top
    return page_h


def _norm_lines(text: str) -> str:
    return "\n".join(normalize(l) for l in text.split("\n"))


def _build_line(lno, supp, cells, section, pno) -> Line:
    j = lambda k: " ".join(t for _, t in cells[k])
    line_band = [t for _, t in cells["line"]]
    item = next((t for t in line_band if re.fullmatch(r"\d{6}|AUTO", t)), "")
    desc = j("desc")
    op = j("op")
    ltype = j("ltype")
    units_toks = [t for _, t in cells["units"]]
    ptype = j("ptype")
    number_toks = [t for _, t in cells["number"]]
    qty_t = j("qty")
    price_t = j("price")
    tax_t = j("tax")

    line = Line(line_no=lno, supp_tag=supp, item_no=item, section=section,
                description=desc, operation=op, page=pno)
    line.is_note = (item == "900501") or (not op and not ltype and not units_toks and not price_t)
    # labor
    if ltype:
        base = ltype.replace("*", "").strip()
        h_tok = units_toks[0] if units_toks else ""
        h = parse_hours(h_tok)
        f = parse_flags(h_tok)
        judgment = f["judgment"] or ltype.endswith("*")
        cc = any(t == "C" for t in units_toks[1:])
        ceg_toks = [t for _, t in cells["ceg"]]
        dbh = parse_hours(ceg_toks[0]) if ceg_toks else None
        line.labor.append(Labor(type=base, hrs=h if h is not None else 0.0, inc=f["inc"],
                                judgment=judgment, labor_note=f["labor_note"],
                                ceg_rr_time=f["ceg_rr_time"], clear_coat_calc=cc, db_hrs=dbh))
    # part
    line.part_type = ptype
    if number_toks:
        raw = " ".join(number_toks)
        line.part_no_src = raw
        line.part_no = raw.replace(" ", "").lstrip("*").replace("~", "~")
    if qty_t.isdigit():
        line.qty = int(qty_t)
    if price_t:
        line.price_judgment = "*" in price_t
        ext = money(price_t.replace("*", ""))
        line.ext_price = ext
        # Mitchell prints the extended price; the description carries '(N @ $unit)' for multi-qty lines
        m = re.search(r"\((\d+) @ \$([\d,]+\.\d\d)\)", desc)
        if m and ext is not None:
            line.qty = int(m.group(1)); line.price = float(m.group(2).replace(",", ""))
            line.description = re.sub(r"\s*\(\d+ @ \$[\d,]+\.\d\d\)", "", desc).strip()
        elif ext is not None and (line.qty or 1) > 1:
            line.price = round(ext / line.qty, 2)
        else:
            line.price = ext
    if tax_t:
        line.taxable = tax_t.strip().lower().startswith("y")
    return line


# --------------------------------------------------------------------------- header / totals
def _parse_header(led: Ledger, texts: list[str]):
    t = texts[0] if texts else ""
    m = re.search(r"\b([A-HJ-NPR-Z0-9]{17})\b", t)
    if m: led.vin = m.group(1)
    m = re.search(r"Claim Number((?:\s+\S+){1,8})", t)
    if m:
        toks = m.group(1).split()
        for i, tok in enumerate(toks):
            if len(tok) >= 6 and re.search(r"\d", tok) and "(" not in tok and not (i > 0 and re.fullmatch(r"\(\d{3}\)", toks[i - 1])) \
                    and not tok.endswith(":") and not re.fullmatch(r"\d{5}", tok):
                led.claim_no = tok; break
    m = re.search(r"Estimate ID\s+(\S+)(?:\s+(S\d)\b)?", t)
    if m: led.estimate_id, led.supplement_no = m.group(1), (m.group(2) or "")
    m = re.search(r"\n(\d{4} [^\n]+)\nExterior Color", t)
    if m: led.vehicle = m.group(1).strip()


def _parse_totals(led: Ledger, texts: list[str]):
    full = "\n".join(texts)
    tot = led.totals
    for lt in ("Body", "Refinish", "Mechanical", "Frame", "Structural", "Paint", "Glass", "Diagnostic", "Electrical"):
        m = re.search(rf"{lt} Labor\s*(\d+\.\d)\s*\$([\d,]+\.\d\d)((?:\s*\$[\d,]+\.\d\d)*)", full)
        if m:
            tot.units[lt] = float(m.group(1))
            tot.rates[lt] = float(m.group(2).replace(",", ""))
            tail = [float(x.replace("$", "").replace(",", "")) for x in m.group(3).split()]
            # tail = [sublet?, addl?, amount]; amount is last
            if tail:
                tot.labor_amount[lt] = tail[-1]
                if len(tail) >= 2:
                    tot.sublet[lt] = tail[0]
    m = re.search(r"Total Labor\s*(\d+\.\d)(?:\s*\$[\d,]+\.\d\d)*\s*\$([\d,]+\.\d\d)\s*Taxable \$([\d,]+\.\d\d)", full)
    if m: tot.labor_total_taxable = float(m.group(3).replace(",", ""))
    m = re.search(r"Taxable Parts \$([\d,]+\.\d\d)", full)
    if m: tot.parts_taxable = float(m.group(1).replace(",", ""))
    m = re.search(r"Parts Adjustments \$([\d,]+\.\d\d)", full)
    if m: tot.parts_adjustments = float(m.group(1).replace(",", ""))
    m = re.search(r"Paint Materials \$([\d,]+\.\d\d)", full)
    if m: tot.paint_materials = float(m.group(1).replace(",", ""))
    m = re.search(r"Refinish Units: (\d+\.\d) units", full)
    if m: tot.paint_units = float(m.group(1))
    m = re.search(r"- Rate: \$(\d+\.\d\d)", full)
    if m: tot.paint_rate = float(m.group(1))
    m = re.search(r"Rate Max: (\d+\.\d) units", full)
    if m: tot.paint_rate_max_units = float(m.group(1))
    m = re.search(r"Other Additional \$([\d,]+\.\d\d)", full)
    if m: tot.other_costs = float(m.group(1).replace(",", ""))
    m = re.search(r"Tax (\d+\.\d+)%", full)
    if m: tot.tax_rate = float(m.group(1)) / 100.0
    m = re.search(r"Gross Total \$([\d,]+\.\d\d)", full)
    if m: tot.gross_total = float(m.group(1).replace(",", ""))
    m = re.search(r"Gross Total \$[\d,]+\.\d\d \$[\d,]+\.\d\d\s+Taxable \$[\d,]+\.\d\d\s+Tax \$([\d,]+\.\d\d)", full)
    if m: tot.tax_total = float(m.group(1).replace(",", ""))
    m = re.search(r"Adjustments Amount\s+Deductible (\S+)", full)
    if m: tot.deductible = m.group(1)


def _parse_vendors(led: Ledger, texts: list[str]):
    """Vendor blocks may be laid out in two columns.  Parse per column from word coordinates:
    'Line Part # Total Price' header -> nearest name row above (skipping address/phone rows) -> rows 'N partno $x'."""
    pdf = pdfplumber.open(led.source_file)
    for pno, page in enumerate(pdf.pages, start=1):
        txt = _norm_lines(page.extract_text() or "")
        if "Vendors" not in txt:
            continue
        words = page.extract_words()
        rows: dict[int, list] = {}
        for w in words:
            rows.setdefault(round(w["top"]), []).append(w)
        # footer cut
        cut = page.height
        for top in sorted(rows):
            t = normalize(" ".join(w["text"] for w in rows[top]), 2)
            if t.startswith("Committed") or re.search(r"\bPage \d+ of \d+", t):
                cut = top; break
        # column starts = x0 of each 'Line' header word on the page (document-derived, not a fixed midpoint)
        starts = sorted({round(w["x0"]) for w in words if w["text"] == "Line"})
        if not starts:
            continue
        bounds = starts[1:] + [page.width + 1]
        for col, (x_lo, x_hi) in enumerate(zip(starts, bounds)):
            lines = []
            for top in sorted(rows):
                if top >= cut: continue
                ws = [w for w in sorted(rows[top], key=lambda w: w["x0"]) if x_lo - 3 <= w["x0"] < x_hi - 3]
                if ws:
                    lines.append(normalize(" ".join(w["text"] for w in ws), 4))
            vendor = ""
            for i, ln in enumerate(lines):
                if ln.startswith("Line Part #"):
                    k = i - 1
                    while k >= 0 and (re.search(r"\(\d{3}\)|\d{5}$|^\d+ |Supplier Notes|Vendors$|^Disclaimer|^Price$", lines[k]) or not lines[k].strip()):
                        k -= 1
                    vendor = lines[k].strip() if k >= 0 else ""
                    continue
                m = re.match(r"^(\d{1,3}) (\S+) \$[\d,]+\.\d\d", ln)
                if m and vendor:
                    led.vendors.setdefault(int(m.group(1)), vendor)
