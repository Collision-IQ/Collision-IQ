"""PDF renderers (reportlab/platypus) for the three deliverables.
Plain-language labels only; no internal enum names in prose (finding hygiene rule)."""
from __future__ import annotations
import datetime as dt
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

_ss = getSampleStyleSheet()
H1 = ParagraphStyle("h1", parent=_ss["Heading1"], fontSize=15, spaceAfter=6)
H2 = ParagraphStyle("h2", parent=_ss["Heading2"], fontSize=11.5, spaceBefore=8, spaceAfter=4)
BODY = ParagraphStyle("b", parent=_ss["BodyText"], fontSize=8.2, leading=10)
SMALL = ParagraphStyle("s", parent=BODY, fontSize=7, leading=8.5, textColor=colors.HexColor("#444444"))
NOTE = ParagraphStyle("n", parent=SMALL, leftIndent=14, textColor=colors.HexColor("#555555"))
GRID = TableStyle([("FONT", (0, 0), (-1, -1), "Helvetica", 7.5), ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.5),
                   ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBBB")), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EDEDED")),
                   ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                   ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5)])


def _money(v): return "" if v in (None, "") else f"${v:,.2f}"
def _hrs(v): return "" if v in (None, "") else f"{v:.1f}"
def _p(t, st=BODY): return Paragraph(str(t).replace("&", "&amp;").replace("<", "&lt;"), st)


# --------------------------------------------------------------------------- Rekey Sheet
def rekey_sheet_pdf(path: str, ledger, profile, expected: dict, clear_coat: dict, lost: list):
    doc = SimpleDocTemplate(path, pagesize=landscape(letter), leftMargin=0.45 * inch, rightMargin=0.45 * inch, topMargin=0.5 * inch, bottomMargin=0.5 * inch,
                            title="Rekey Sheet")
    el = [Paragraph("Rekey Sheet — Mitchell estimate keyed into CCC ONE", H1),
          _p(f"Source: {ledger.estimate_id} {ledger.supplement_no}  ·  Claim {ledger.claim_no}  ·  VIN {ledger.vin}  ·  {ledger.vehicle}"),
          _p(f"Mitchell gross total ${ledger.totals.gross_total:,.2f}  ·  Generated {dt.date.today():%d %b %Y}", SMALL), Spacer(1, 6)]
    # profile block
    el.append(Paragraph("1. Set the CCC profile BEFORE keying (every downstream number depends on this)", H2))
    prof = [["CCC profile field", "Set to", "From Mitchell totals page"]]
    for code, name in (("LAB", "Body rate"), ("LAR", "Paint / refinish rate"), ("LAM", "Mechanical rate")):
        prof.append([name, _money(profile.rates.get(code, 0.0)), f"{name} per hour"])
    prof += [["Paint supplies rate (per refinish hour)", _money(profile.paint_rate), f"Paint Materials rate; {expected['materials']['paint_hrs']:.1f} refinish h × rate = {_money(expected['materials']['paint_amt'])}"],
             ["Paint supplies cap", _money(profile.paint_cap_dollars), "Rate Max units × rate"],
             ["Sales tax (labor, parts, materials)", f"{profile.tax_rate*100:.4f} %", "applied to all three categories"],
             ["LKQ / recycled markup", f"{profile.lkq_markup_pct*100:.0f} %", "Mitchell recycled prices are net — must be 0 %"],
             ["Deductible", str(ledger.totals.deductible or ""), "Adjustments block"]]
    el.append(Table(prof, colWidths=[2.6 * inch, 1.2 * inch, 5.6 * inch], style=GRID))
    # lines by group
    el.append(Paragraph("2. Key these lines, in this order (CCC group order; Mitchell order within each group)", H2))
    rows = expected["rows"]
    groups = []
    for r in rows:
        if not groups or groups[-1][0] != r["group"]: groups.append((r["group"], []))
        groups[-1][1].append(r)
    hdr = ["S#", "Mitch", "Op", "Description", "Part #", "Type", "Vendor", "Qty", "Price", "Body", "Paint", "Mech", "Misc $", "Flags"]
    widths = [0.3, 0.42, 0.42, 2.45, 1.25, 0.65, 1.15, 0.3, 0.6, 0.42, 0.42, 0.42, 0.55, 0.62]
    for gname, grows in groups:
        data = [hdr]; gh = {"LAB": 0.0, "LAR": 0.0, "LAM": 0.0}; gp = 0.0
        notes = []
        for r in grows:
            hrs = {"LAB": "", "LAR": "", "LAM": ""}; flags = []
            for lab in r["labor"]:
                code = lab["ems"] if lab["ems"] in hrs else "LAB"
                hrs[code] = ("Incl" if lab["inc"] else _hrs(lab["hrs"])) if not (hrs[code] and lab["inc"]) else hrs[code]
                if lab["inc"]: flags.append("Incl")
                elif lab["hrs"]:
                    hrs[code] = _hrs(sum(l["hrs"] for l in r["labor"] if l["ems"] == code and not l["inc"]))
                    gh[code] += lab["hrs"]
                if lab["judgment"]: flags.append("*")
            if r["price_judgment"]: flags.append("$*")
            if r["tax"]: flags.append("Tax")
            if r["misc_amt"]: flags.append("Subl")
            if r["price"]: gp += r["price"] * (r["qty"] or 1)
            data.append([r["supp_tag"] or "", str(r["src_line"]), r["op_ccc"], _p(r["desc_ccc"]), _p(r["part_no"] or ""), r["part_type_ccc"], _p(r["vendor"][:28], SMALL),
                         str(r["qty"] or ""), _money(r["price"]), hrs["LAB"], hrs["LAR"], hrs["LAM"], _money(r["misc_amt"]), " ".join(dict.fromkeys(flags))])
            for n in r["notes"]: notes.append(f"L{r['src_line']} — {n}")
        data.append(["", "", "", Paragraph(f"<b>{len(grows)} lines</b>", BODY), "", "", "", "", _money(gp), _hrs(gh["LAB"]), _hrs(gh["LAR"]), _hrs(gh["LAM"]), "", ""])
        t = Table(data, colWidths=[w * inch for w in widths], style=GRID, repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F7F7F7"))]))
        block = [Paragraph(gname, H2), t] + [_p(n, NOTE) for n in notes]
        el.append(KeepTogether(block[:2])); el.extend(block[2:])
    # clear coat + expected totals
    el.append(PageBreak())
    el.append(Paragraph("3. Clear coat — key as ONE manual refinish line (do not distribute)", H2))
    el.append(_p(f"Mitchell prints one aggregate clear-coat line: {clear_coat['printed_hours']:.1f} h. Recomputed from the {len(clear_coat['per_line'])} clear-coat-flagged "
                 f"refinish lines under the Mitchell guide (40 % first panel / 20 % each additional): {clear_coat['hours']:.1f} h → {clear_coat['status']}. "
                 f"Distributing per panel and rounding each line would give {clear_coat['per_line_sum']:.1f} h, so keying it as one line is the only way the estimate closes to the penny."))
    el.append(Paragraph("4. Expected CCC totals after keying (Module B checks the EMS export against these)", H2))
    lb = expected["labor"]["by_type"]
    tot = [["Row", "Hours", "Amount"],
           ["Body labor", _hrs(lb.get("LAB", {}).get("hrs", 0)), _money(lb.get("LAB", {}).get("amt", 0))],
           ["Paint labor", _hrs(lb.get("LAR", {}).get("hrs", 0)), _money(lb.get("LAR", {}).get("amt", 0))],
           ["Mechanical labor", _hrs(lb.get("LAM", {}).get("hrs", 0)), _money(lb.get("LAM", {}).get("amt", 0))],
           ["Sublet (booked to labor)", "", _money(expected["labor"]["sublet_amt"])],
           ["Parts (taxable)", "", _money(expected["parts"]["total_amt"])],
           ["Paint supplies", _hrs(expected["materials"]["paint_hrs"]), _money(expected["materials"]["paint_amt"])],
           ["Other costs", "", _money(expected["other_costs"])],
           ["Sales tax", "", _money(expected["tax"])],
           ["Gross total", "", _money(expected["gross"])],
           ["Mitchell printed gross", "", _money(ledger.totals.gross_total)],
           ["Unexplained", "", _money(round(expected["gross"] - (ledger.totals.gross_total or 0), 2))]]
    el.append(Table(tot, colWidths=[2.4 * inch, 1 * inch, 1.3 * inch], style=GRID))
    el.append(Paragraph("5. Not-included operations the Mitchell guide allows for this scope that no line claims (for the supplement, not for rekey)", H2))
    lc = [["Operation", "Status", "Triggered by lines", "Claimed by", "Guide allowance"]]
    for x in lost:
        if x.status == "n/a": continue
        lc.append([_p(x.operation), x.status, ", ".join(f"L{n}" for n in x.triggered_by[:8]) + ("…" if len(x.triggered_by) > 8 else ""), ", ".join(map(str, x.claimed_by)), _p(x.allowance or "", SMALL)])
    el.append(Table(lc, colWidths=[3.2 * inch, 0.7 * inch, 1.9 * inch, 1.0 * inch, 2.6 * inch], style=GRID))
    doc.build(el)


# --------------------------------------------------------------------------- Verification report
def verify_pdf(path: str, rep, ledger):
    doc = SimpleDocTemplate(path, pagesize=letter, leftMargin=0.6 * inch, rightMargin=0.6 * inch, topMargin=0.6 * inch, bottomMargin=0.6 * inch, title="EMS Verification")
    el = [Paragraph(f"EMS Verification — {rep.status}", H1),
          _p(f"Mitchell {ledger.estimate_id} {ledger.supplement_no} · Claim {ledger.claim_no} · VIN {ledger.vin}"), _p(rep.gate, SMALL), Spacer(1, 6)]
    if rep.status == "BLOCKED":
        el.append(_p("Comparison blocked — no findings are reported when the export cannot be identified or belongs to a different vehicle/claim."))
        doc.build(el); return
    el.append(Paragraph("Identity", H2))
    idt = rep.identity
    el.append(Table([["", "Mitchell", "CCC export", "Match"], ["VIN", idt["vin_mitchell"], idt["vin_ccc"], "yes" if idt["vin_match"] else "NO"],
                     ["Claim", idt["claim_mitchell"], idt["claim_ccc"], "yes" if idt["claim_match"] else "NO"]], colWidths=[0.8 * inch, 2.2 * inch, 2.2 * inch, 0.7 * inch], style=GRID))
    el.append(Paragraph("Profile check (a wrong profile explains every downstream delta)", H2))
    if rep.profile:
        el.append(Table([["Setting", "Expected", "In export", "Delta"]] + [[f["ref"], f["expected"], f["actual"], f["delta"] if f["delta"] is not None else ""] for f in rep.profile],
                        colWidths=[2.2 * inch, 1.2 * inch, 1.2 * inch, 1 * inch], style=GRID))
    else:
        el.append(_p("Profile matches: rates, paint supplies rate, recycled-part markup and tax all as expected."))
    el.append(Paragraph("Totals", H2))
    el.append(Table([["Row", "Expected", "In export", "Delta"]] + [[t["row"], t["expected"], t["actual"] if t["actual"] is not None else "—", t["delta"] if t["delta"] is not None else "—"] for t in rep.totals],
                    colWidths=[2.2 * inch, 1.3 * inch, 1.3 * inch, 1 * inch], style=GRID))
    el.append(Paragraph(f"Line findings ({len(rep.lines)})", H2))
    if rep.lines:
        kinds = {"missing_in_ccc": "Not keyed", "extra_in_ccc": "Extra in CCC", "value_delta": "Value differs"}
        el.append(Table([["Type", "Line", "Detail", "Expected", "In export", "Delta"]] +
                        [[kinds.get(f["kind"], f["kind"]), f["ref"], _p(f["detail"]), f["expected"] if f["expected"] is not None else "", f["actual"] if f["actual"] is not None else "", f["delta"] if f["delta"] is not None else ""] for f in rep.lines],
                        colWidths=[0.9 * inch, 0.9 * inch, 2.9 * inch, 0.8 * inch, 0.8 * inch, 0.6 * inch], style=GRID, repeatRows=1))
    else:
        el.append(_p("Every keyed line matches the Mitchell ledger on price, quantity, part type, hours and sublet amount."))
    el.append(Spacer(1, 8)); el.append(_p(f"Unexplained residual: {_money(rep.summary.get('unexplained'))}", H2))
    doc.build(el)


# --------------------------------------------------------------------------- Cross-platform review
def review_pdf(path: str, rv):
    doc = SimpleDocTemplate(path, pagesize=landscape(letter), leftMargin=0.45 * inch, rightMargin=0.45 * inch, topMargin=0.5 * inch, bottomMargin=0.5 * inch, title="Cross-platform review")
    A, B = rv.a_label, rv.b_label
    el = [Paragraph(f"Cross-platform estimate review — {A} vs {B}", H1),
          _p(f"VIN {rv.identity['vin_a']} / {rv.identity['vin_b']} ({'same vehicle' if rv.identity['same_vin'] else 'DIFFERENT VEHICLES — review invalid'})  ·  guides: {rv.identity['guide_a']} vs {rv.identity['guide_b']}", SMALL), Spacer(1, 4)]
    el.append(Paragraph("1. Profile and totals", H2))
    el.append(Table([["Item", A, B, "Delta"]] + [[r["item"], r["a"] if r["a"] is not None else "—", r["b"] if r["b"] is not None else "—", r["delta"] if r["delta"] is not None else ""] for r in rv.profile],
                    colWidths=[2.2 * inch, 1.3 * inch, 1.3 * inch, 1.1 * inch], style=GRID))
    el.append(Paragraph("2. Labor differential over matched operations only (database time differences, scope held constant)", H2))
    names = {"LAB": "Body", "LAR": "Refinish", "LAM": "Mechanical", "LAS": "Structural", "LAF": "Frame"}
    el.append(Table([["Labor type", f"{A} hours", f"{B} hours", "Delta", "Matched pairs", "Pairs that differ"]] +
                    [[names.get(k, k), d["a"], d["b"], d["delta"], d["pairs"], d["pairs_differing"]] for k, d in rv.differential.items()],
                    colWidths=[1.4 * inch, 1.2 * inch, 1.2 * inch, 0.8 * inch, 1.1 * inch, 1.2 * inch], style=GRID))
    pd = rv.parts_differential
    el.append(_p(f"Parts priced under the same OEM part number on both estimates: {pd.get('pairs',0)} pairs, {A} {_money(pd.get('a'))} vs {B} {_money(pd.get('b'))}, "
                 f"delta {_money(pd.get('delta'))} ({pd.get('pairs_differing',0)} pairs differ) — database price differences, not scope.", BODY))
    el.append(Paragraph("3. Clear coat (compared as a section aggregate — never line by line)", H2))
    cc = rv.clear_coat
    el.append(Table([["", A, B], ["Printed clear-coat hours", cc["a"]["printed_hours"], cc["b"]["printed_hours"]],
                     ["Recomputed under own guide", cc["a"]["hours"], cc["b"]["hours"]], ["Status", cc["a"]["status"], cc["b"]["status"]],
                     ["Lines carrying it", ", ".join(map(str, cc["a"]["printed_lines"])), ", ".join(map(str, cc["b"]["printed_lines"]))]],
                    colWidths=[2.2 * inch, 2.4 * inch, 2.4 * inch], style=GRID))
    el.append(Paragraph("4. Matched operations", H2))
    data = [["A", "B", A + " description", B + " description", "Body A/B", "Refinish A/B", "Mech A/B", "Price A", "Price B", "Δ$"]]
    for p in rv.pairs:
        L = p["labor"]
        f = lambda c: f"{L[c]['a']:.1f} / {L[c]['b']:.1f}" + (" ▲" if L[c]["delta"] > 0.049 else " ▼" if L[c]["delta"] < -0.049 else "") if c in L else ""
        data.append([p["a"], p["b"], _p(p["desc_a"]), _p(p["desc_b"]), f("LAB"), f("LAR"), f("LAM"), _money(p["price_a"]), _money(p["price_b"]), _money(p["price_delta"])])
    el.append(Table(data, colWidths=[w * inch for w in (0.4, 0.45, 2.3, 2.3, 0.85, 0.9, 0.85, 0.7, 0.7, 0.65)], style=GRID, repeatRows=1))
    for label, items in ((f"5. Only on {A}", rv.unmatched_a), (f"6. Only on {B}", rv.unmatched_b)):
        el.append(Paragraph(f"{label} ({len(items)})", H2))
        if items:
            el.append(Table([["Line", "Group", "Op", "Description", "Labor", "Price / misc"]] +
                            [[u["key"], _p(u["group"], SMALL), u["op"], _p(u["desc"]), " ".join(f"{k} {v:.1f}" for k, v in u["labor"].items()), _money(u["price"] or u["misc"])] for u in items],
                            colWidths=[0.5 * inch, 1.6 * inch, 0.7 * inch, 3.6 * inch, 1.6 * inch, 1 * inch], style=GRID, repeatRows=1))
    el.append(Paragraph("7. Bridge — not-included operations the guides allow for this scope", H2))
    br = rv.lost_costs["bridge"]
    el.append(_p("<b>Allowed by both guides, claimed by neither</b> (strongest candidates):"))
    if br["both_lost"]:
        el.append(Table([["Operation", "Cited (A)", "Cited (B)", "Allowance"]] + [[_p(x["operation"]), _p(x["cite_a"], SMALL), _p(x["cite_b"], SMALL), _p(x["allowance"] or "", SMALL)] for x in br["both_lost"]],
                        colWidths=[2.6 * inch, 3 * inch, 2.4 * inch, 1.8 * inch], style=GRID))
    else:
        el.append(_p("none", SMALL))
    el.append(_p("<b>Claimed on one estimate, not the other</b> (supplement items with the other guide's citation):"))
    if br["one_sided"]:
        el.append(Table([["Operation", "Claimed on", "Lines", "Missing from", "Citation for the missing side", "Rule verified"]] +
                        [[_p(x["operation"]), x["claimed_on"], ", ".join(map(str, x["claimed_lines"])), x["lost_on"], _p(x["cite_lost_side"], SMALL), "yes" if x["verified_rule"] else "seed — verify"] for x in br["one_sided"]],
                        colWidths=[2.4 * inch, 1.3 * inch, 0.9 * inch, 1.3 * inch, 3 * inch, 0.9 * inch], style=GRID))
    else:
        el.append(_p("none", SMALL))
    doc.build(el)
