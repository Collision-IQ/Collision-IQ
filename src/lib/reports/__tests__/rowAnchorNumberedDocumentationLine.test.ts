/**
 * A printed line item is anchored by position, whatever its words say.
 *
 * CCC ONE shop prints carry a documentation line in the estimate table:
 *
 *   4  # ****Work Authorization        1
 *         Secured****
 *
 * The anchor builder tested every line's TEXT for boilerplate before it
 * measured where the line sits, and "work authorization" is on that list (a
 * contract page is not an estimate row). Measured on the RO 20766 and RO 22084
 * shop word layers (3 Oct 2026):
 *
 *   1. Line 4 had no anchor at all.
 *   2. Its wrap, "Secured****", continued the last operation row instead,
 *      across the "3 UPDATE NOTES" section header: L2's anchor read "2 # **
 *      Procedure research & 1 documentation ** Secured****" and its box ran
 *      82.6 pt (20766) / 93.3 pt (22084) down the page over L3 and L4, so a
 *      mark on L2 covered three printed lines.
 *
 * A line that opens a row in the measured line-number column of a measured
 * table region is now a row (the typed lane's U-3 rule already keeps it, qty
 * 1), and any other numbered line closes the row above it.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEstimateRowAnchorsFromLines,
  buildPdfTextLines,
  type EstimateRowAnchor,
  type PdfWord,
} from "../citationDensityRowAnchors";

const FIXTURES = path.join(__dirname, "../../../../tests/fixtures");

function shopAnchors(ro: string): EstimateRowAnchor[] {
  const words = JSON.parse(fs.readFileSync(path.join(FIXTURES, ro, "shop_words.json"), "utf8")) as PdfWord[];
  return buildEstimateRowAnchorsFromLines(buildPdfTextLines(words), { sourceDocumentRole: "shop", sourceDocumentId: `shop-${ro}` });
}

const onPage2 = (anchors: EstimateRowAnchor[], line: string) =>
  anchors.find((anchor) => anchor.pageNumber === 2 && anchor.lineNumber === line);

describe.each(["20766", "22084"])("RO %s shop: the Work Authorization line item", (ro) => {
  const anchors = shopAnchors(ro);

  it("is anchored as its own printed line 4, with its wrap", () => {
    const line4 = onPage2(anchors, "4");
    expect(line4, "line 4 has an anchor").toBeDefined();
    expect(line4!.rowText).toMatch(/^4 # \*\*\*\*Work Authorization 1 Secured\*\*\*\*$/);
  });

  it("does not stretch line 2's anchor over lines 3 and 4", () => {
    const line2 = onPage2(anchors, "2")!;
    const line3 = onPage2(anchors, "3")!;
    expect(line2.rowText).not.toMatch(/Secured/);
    expect(line2.y + line2.height, "L2's box ends above L3's").toBeLessThanOrEqual(line3.y);
  });

  it("keeps every numbered row's box clear of the next numbered line on the page", () => {
    const numbered = anchors
      .filter((anchor) => anchor.pageNumber === 2 && anchor.lineNumber !== null && /^\d+$/.test(anchor.lineNumber) && Number(anchor.lineNumber) < 100)
      .sort((a, b) => a.y - b.y);
    const overlaps = numbered
      .slice(0, -1)
      .map((anchor, index) => [anchor, numbered[index + 1]] as const)
      .filter(([anchor, next]) => anchor.y + anchor.height > next.y + 0.5)
      .map(([anchor, next]) => `L${anchor.lineNumber} over L${next.lineNumber}`);
    expect(overlaps).toEqual([]);
  });
});
