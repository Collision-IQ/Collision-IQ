#!/usr/bin/env python3
"""
annotate_pdf.py — Stamp delta + compliance markup onto a collision estimate PDF.

Two visual categories:
  * COST gaps  -> red strike / red-on-yellow (default color="red", hl="yellow")
  * OEM / warranty / safety flags -> blue-on-cyan (pass color="blue", hl="cyan")

Annotation types (page index + bbox=[x0,top,x1,bottom] in pdfplumber top-left
coordinates, exactly as extract_estimate.py emits):
  underline  {page,bbox,color?}
  replace    {page,bbox,new_text,color?,hl?}     strike value + write other value
  highlight  {page,bbox,new_text?,color?,hl?}    highlight a value in place
  note       {page,x,top,text,color?,hl?}        free note (missing item / OEM flag)

Usage:  python annotate_pdf.py <target_pdf> <instructions.json> <out_pdf>
"""
import argparse, io, json, sys
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color

INK = {"red": Color(0.80,0,0), "blue": Color(0,0.15,0.75), "black": Color(0,0,0)}
HL  = {"yellow": Color(1,0.95,0), "cyan": Color(0.30,0.85,1), "green": Color(0.4,1,0.4)}
FONT, DEFAULT_SIZE = "Helvetica-Bold", 9

def hilite(c, col, x, y, w, h):
    c.saveState(); c.setFillColor(HL.get(col, HL["yellow"])); c.setFillAlpha(0.45)
    c.rect(x, y, w, h, stroke=0, fill=1); c.restoreState()

def build_overlay(page_w, page_h, anns):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_w, page_h))
    for a in anns:
        t = a["type"]; ink = INK.get(a.get("color", "red"), INK["red"])
        hl = a.get("hl", "yellow")
        if t in ("underline", "replace"):
            x0, top, x1, bottom = a["bbox"]
            y_mid = page_h - (top + bottom) / 2.0; y_bot = page_h - bottom
            c.setStrokeColor(ink); c.setLineWidth(1.1)
            if t == "underline":
                c.line(x0, y_bot - 1.0, x1, y_bot - 1.0)
            else:
                c.line(x0 - 1, y_mid, x1 + 1, y_mid)
                new = str(a["new_text"]); size = a.get("size", DEFAULT_SIZE)
                c.setFont(FONT, size); tw = c.stringWidth(new, FONT, size)
                hilite(c, hl, x1 + 2.5, y_bot - 1.5, tw + 3, (bottom - top) + 3)
                c.setFillColor(ink); c.drawString(x1 + 4, page_h - bottom + 1.0, new)
        elif t == "highlight":
            x0, top, x1, bottom = a["bbox"]; y_bot = page_h - bottom
            hilite(c, hl, x0 - 1.5, y_bot - 1.5, (x1 - x0) + 3, (bottom - top) + 3)
            if a.get("new_text"):
                new = str(a["new_text"]); size = a.get("size", DEFAULT_SIZE)
                c.setFont(FONT, size); tw = c.stringWidth(new, FONT, size)
                hilite(c, hl, x1 + 16, y_bot - 1.5, tw + 3, (bottom - top) + 3)
                c.setFillColor(ink); c.drawString(x1 + 17.5, page_h - bottom + 1.0, new)
        elif t == "note":
            txt = str(a["text"]); size = a.get("size", DEFAULT_SIZE)
            x = a["x"]; y_bot = page_h - a["top"] - size
            c.setFont(FONT, size); tw = c.stringWidth(txt, FONT, size)
            hilite(c, hl, x - 1.5, y_bot - 1.5, tw + 3, size + 4)
            c.setFillColor(ink); c.drawString(x, y_bot, txt)
        else:
            print("warn: unknown annotation type %r" % t, file=sys.stderr)
    c.showPage(); c.save(); buf.seek(0)
    return buf

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target_pdf"); ap.add_argument("instructions"); ap.add_argument("out_pdf")
    a = ap.parse_args()
    anns = json.load(open(a.instructions))["annotations"]
    by_page = {}
    for x in anns:
        by_page.setdefault(x["page"], []).append(x)
    reader = PdfReader(a.target_pdf); writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        if i in by_page:
            w = float(page.mediabox.width); h = float(page.mediabox.height)
            page.merge_page(PdfReader(build_overlay(w, h, by_page[i])).pages[0])
        writer.add_page(page)
    with open(a.out_pdf, "wb") as f:
        writer.write(f)
    print("wrote %s (%d annotations, %d pages)" % (a.out_pdf, len(anns), len(by_page)))

if __name__ == "__main__":
    main()
