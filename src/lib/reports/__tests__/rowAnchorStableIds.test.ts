/**
 * Row anchors with no printed line number get ids that do not depend on the
 * rest of the anchor list.
 *
 * Unnumbered anchors (section, totals, supplier and guide rows, unnumbered
 * notes) used to take their position in the anchor list as the id. Adding or
 * dropping ANY anchor renumbered every unnumbered anchor after it: dropping
 * one row near the top of a print re-ided 28-95 other anchors on every word
 * fixture in the repo. A finding that carried an id from an earlier
 * extraction could then resolve to a different row without tripping the
 * stale-anchor check, which only catches ids that no longer exist. The
 * position could also equal a printed number on the same page: on RO 20766's
 * shop print the cover page's "4 Wheel Drive…" line and the fourth anchor
 * were both p1:4:guide_row, and code that keeps one anchor per id kept only
 * one of them.
 *
 * Unnumbered ids are now the anchor's own printed text, hashed; numbered ids
 * are unchanged.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEstimateRowAnchorsFromLines,
  buildPdfTextLines,
  type EstimateRowAnchor,
  type PdfTextLine,
  type PdfWord,
} from "../citationDensityRowAnchors";

const FIXTURES = path.join(__dirname, "../../../../tests/fixtures");

function fixtureLines(relative: string): PdfTextLine[] {
  const words = (JSON.parse(fs.readFileSync(path.join(FIXTURES, relative), "utf8")) as PdfWord[]).map((word) => ({
    ...word,
    normalizedText: word.normalizedText ?? word.text.toLowerCase(),
  }));
  return buildPdfTextLines(words);
}

const build = (lines: PdfTextLine[]) =>
  buildEstimateRowAnchorsFromLines(lines, { sourceDocumentRole: "shop", sourceDocumentId: "doc" });

/** The anchor's place on the page: what stays the same when only its id may change. */
const placeOf = (anchor: EstimateRowAnchor) => `${anchor.pageNumber}|${anchor.y.toFixed(2)}|${anchor.x.toFixed(2)}`;

const UNNUMBERED_ID = /^doc:p\d+:t[0-9a-f]{10}(?:\.\d+)?:[a-z_]+$/;

// RO 20766 shop (the p1:4 collision) and RO 21995 SOR 3 (the most unnumbered
// anchors, and the same note printed several times on one page).
for (const relative of ["20766/shop_words.json", "21995/sor3_words.json"]) {
  describe(`${relative}`, () => {
    const lines = fixtureLines(relative);
    const anchors = build(lines);
    const unnumbered = anchors.filter((anchor) => !anchor.lineNumber);

    it("names a numbered row by its page, printed line number and type, as before", () => {
      const numbered = anchors.filter((anchor) => anchor.lineNumber);
      expect(numbered.length).toBeGreaterThan(50);
      for (const anchor of numbered) {
        // The type in the id is the type the anchor was opened with; a
        // wrapped link line can retype the anchor later without renaming it.
        expect(anchor.anchorId).toMatch(new RegExp(`^doc:p${anchor.pageNumber}:${anchor.lineNumber}:[a-z_]+$`));
      }
    });

    it("names an unnumbered anchor by its text, never by a number a printed line could also carry", () => {
      expect(unnumbered.length).toBeGreaterThan(20);
      for (const anchor of unnumbered) expect(anchor.anchorId).toMatch(UNNUMBERED_ID);
      expect(new Set(unnumbered.map((anchor) => anchor.anchorId)).size).toBe(unnumbered.length);
    });

    it("keeps every other anchor's id when a row is dropped from the print", () => {
      const row = anchors.find((anchor) => anchor.anchorType === "estimate_line")!;
      const perturbed = build(
        lines.filter((line) => !(line.pageNumber === row.pageNumber && line.text.startsWith(`${row.lineNumber} `) && row.rowText.startsWith(line.text)))
      );
      expect(perturbed.length).toBe(anchors.length - 1);
      const idByPlace = new Map(perturbed.map((anchor) => [placeOf(anchor), anchor.anchorId]));
      for (const anchor of anchors) {
        if (anchor === row) continue;
        expect(idByPlace.get(placeOf(anchor)), anchor.rowText).toBe(anchor.anchorId);
      }
    });

    it("keeps every other anchor's id when a line is added, and never hands a dropped anchor's id to another row", () => {
      const target = unnumbered[Math.floor(unnumbered.length / 2)];
      const withoutTarget = build(
        lines.filter((line) => !(line.pageNumber === target.pageNumber && target.rowText.startsWith(line.text) && line.normalizedText && target.normalizedRowText.startsWith(line.normalizedText)))
      );
      expect(withoutTarget.some((anchor) => anchor.anchorId === target.anchorId)).toBe(false);

      const added: PdfTextLine = { ...lines[0], pageNumber: 1, y: 1, text: "ADDED BANNER", normalizedText: "added banner", words: [] };
      const withAddition = build([added, ...lines]);
      const idByPlace = new Map(withAddition.map((anchor) => [placeOf(anchor), anchor.anchorId]));
      for (const anchor of anchors) expect(idByPlace.get(placeOf(anchor)), anchor.rowText).toBe(anchor.anchorId);
    });
  });
}

describe("the same text printed more than once on a page", () => {
  const anchors = build(fixtureLines("21995/sor3_words.json"));
  const note = /^Note: CCC states part comes with subframe/;

  it("takes an occurrence suffix in reading order, counted per page", () => {
    for (const page of [5, 6]) {
      const copies = anchors.filter((anchor) => anchor.pageNumber === page && note.test(anchor.rowText));
      expect(copies.length, `page ${page}`).toBeGreaterThanOrEqual(3);
      const [first, ...rest] = copies;
      expect(first.anchorId).toMatch(/:t[0-9a-f]{10}:guide_row$/);
      rest.forEach((copy, index) => {
        expect(copy.anchorId).toBe(first.anchorId.replace(/:guide_row$/, "").replace(/(t[0-9a-f]{10})$/, `$1.${index + 2}`) + ":guide_row");
        expect(copy.y).toBeGreaterThan(index === 0 ? first.y : rest[index - 1].y);
      });
    }
  });
});

describe("the RO 20766 cover page", () => {
  it("no longer gives the fourth anchor the id of the printed line 4", () => {
    const anchors = build(fixtureLines("20766/shop_words.json"));
    const pageOne = anchors.filter((anchor) => anchor.pageNumber === 1);
    expect(pageOne.filter((anchor) => anchor.anchorId === "doc:p1:4:guide_row").map((anchor) => anchor.rowText)).toEqual([
      expect.stringMatching(/^4 Wheel Drive/),
    ]);
    expect(new Set(anchors.filter((anchor) => !anchor.lineNumber).map((anchor) => anchor.anchorId)).size).toBe(
      anchors.filter((anchor) => !anchor.lineNumber).length
    );
  });
});

describe("stored-text lines (no measured words)", () => {
  it("get the same text-keyed ids on every build", () => {
    const lines = fixtureLines("20766/shop_words.json").map((line) => ({ ...line, words: [] }));
    const first = build(lines).map((anchor) => anchor.anchorId);
    const second = build(lines).map((anchor) => anchor.anchorId);
    expect(second).toEqual(first);
  });
});
