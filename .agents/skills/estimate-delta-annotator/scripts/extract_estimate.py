#!/usr/bin/env python3
"""
extract_estimate.py — Pull structured line items + ESTIMATE TOTALS (with
coordinates) out of a collision-repair estimate PDF (CCC ONE, Mitchell, Audatex).

Usage:  python extract_estimate.py "SOR-3 21888.pdf" --out sor3.json

Output JSON: grand_total, total_label, pages[], lines[], totals[]
Each line:   page, lineno, section, oper, desc, part, price, price_bbox, row_top
Each totals: page, category, hrs, hrs_bbox, rate, rate_bbox
Coordinates are PDF points, top-left origin: bbox = [x0, top, x1, bottom].
"""
import argparse, json, re
import pdfplumber

MONEY = re.compile(r'^-?[\d,]+\.\d{2}$')
INT   = re.compile(r'^\d{1,3}$')
PARTNUM = re.compile(r'^[0-9][0-9\-/]{4,}[0-9A-Za-z]?$|^[0-9]{6,}$|^[0-9]{3}-[0-9]{3}')
DESC_X0, DESC_X1 = 138, 378
PRICE_RIGHT, PRICE_TOL = 440, 14
TOTAL_LABELS = ["grand total", "total cost of repairs", "net cost of repairs",
                "total cost", "estimate total", "total"]

def money(t):
    return float(t.replace(",", "")) if MONEY.match(t) else None

def group_rows(words, tol=2.2):
    rows = {}
    for w in words:
        rows.setdefault(round(w["top"] / tol) * tol, []).append(w)
    return {k: sorted(v, key=lambda x: x["x0"]) for k, v in sorted(rows.items())}

def is_partnum(t):
    return bool(PARTNUM.match(t))

def parse_grand_total(pdf):
    best_rank, best_val, best_label = len(TOTAL_LABELS), None, None
    for pg in pdf.pages:
        for line in (pg.extract_text() or "").splitlines():
            low = line.lower()
            for rank, lab in enumerate(TOTAL_LABELS):
                if lab in low:
                    nums = re.findall(r'[\d,]+\.\d{2}', line)
                    if nums and rank <= best_rank:
                        val = float(nums[-1].replace(",", ""))
                        if rank < best_rank or (best_val is not None and val > best_val):
                            best_rank, best_val, best_label = rank, val, lab
    return best_val, best_label

def extract_totals(pg, pno):
    found = []
    for top, ws in group_rows(pg.extract_words()).items():
        txt = " ".join(w["text"] for w in ws)
        if "hrs" not in txt or "/hr" not in txt:
            continue
        ws = sorted(ws, key=lambda x: x["x0"])
        cat = " ".join(w["text"] for w in ws if w["x0"] < 300
                       and money(w["text"]) is None and not re.match(r'^\d', w["text"])).strip()
        hrs = hrs_bbox = rate = rate_bbox = None
        for i, w in enumerate(ws):
            if w["text"] == "hrs" and i > 0:
                p = ws[i - 1]
                try:
                    hrs = float(p["text"])
                    hrs_bbox = [round(p["x0"],1), round(p["top"],1), round(p["x1"],1), round(p["bottom"],1)]
                except ValueError:
                    pass
            if w["text"] == "/hr" and i > 0:
                p = ws[i - 1]
                if MONEY.match(p["text"]):
                    rate = float(p["text"].replace(",", ""))
                    rate_bbox = [round(p["x0"],1), round(p["top"],1), round(p["x1"],1), round(p["bottom"],1)]
        found.append({"page": pno, "category": cat, "hrs": hrs,
                      "hrs_bbox": hrs_bbox, "rate": rate, "rate_bbox": rate_bbox})
    return found

def extract(path):
    out = {"file": path, "grand_total": None, "total_label": None,
           "pages": [], "lines": [], "totals": []}
    with pdfplumber.open(path) as pdf:
        out["grand_total"], out["total_label"] = parse_grand_total(pdf)
        section = None
        for pno, pg in enumerate(pdf.pages):
            out["pages"].append({"page": pno, "width": round(pg.width,1), "height": round(pg.height,1)})
            out["totals"].extend(extract_totals(pg, pno))
            for top, ws in group_rows(pg.extract_words()).items():
                first = ws[0]
                if not (first["x0"] < 46 and INT.match(first["text"])):
                    continue
                lineno = int(first["text"])
                row_top = round(min(w["top"] for w in ws), 1)
                price = price_bbox = None
                for w in ws:
                    v = money(w["text"])
                    if v is not None and abs(w["x1"] - PRICE_RIGHT) < PRICE_TOL:
                        price = v
                        price_bbox = [round(w["x0"],1), round(w["top"],1), round(w["x1"],1), round(w["bottom"],1)]
                desc_toks, part_toks = [], []
                for w in ws:
                    if DESC_X0 < w["x0"] < DESC_X1:
                        t = w["text"]
                        if is_partnum(t): part_toks.append(t)
                        elif money(t) is None: desc_toks.append(t)
                desc = " ".join(desc_toks).strip()
                oper = ""
                for w in ws:
                    if w["text"] in ("Repl","Rpr","R&I","Subl","Blnd","Refn","O/H","Sect"):
                        oper = w["text"]; break
                if price is None and desc and desc.upper() == desc and len(desc) > 3 and not is_partnum(desc):
                    section = desc
                out["lines"].append({"page": pno, "lineno": lineno, "section": section,
                    "oper": oper, "desc": desc, "part": " ".join(part_toks),
                    "price": price, "price_bbox": price_bbox, "row_top": row_top})
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    data = extract(a.pdf)
    js = json.dumps(data, indent=2)
    if a.out:
        open(a.out, "w").write(js)
        priced = [l for l in data["lines"] if l["price"] is not None]
        print("%s: %d rows, %d priced, %d totals, grand_total=%s (%s) -> %s" % (
            a.pdf, len(data["lines"]), len(priced), len(data["totals"]),
            data["grand_total"], data["total_label"], a.out))
    else:
        print(js)

if __name__ == "__main__":
    main()
