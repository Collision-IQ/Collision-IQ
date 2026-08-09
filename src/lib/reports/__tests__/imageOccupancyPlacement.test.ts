/**
 * RO 22194 PAGE 5: the unanchored note band was stamped straight across the
 * shop's Sunbit payment QR code, leaving the QR code and the notes both
 * unreadable.
 *
 * The placement engine chooses "whitespace verified empty on the original
 * render", but it verified emptiness from EXTRACTED TEXT WORDS alone. A QR
 * code is an image XObject and carries no glyphs, so the region under it
 * measured as empty and won the band selection — the placer was working
 * exactly as written, on an incomplete picture of the page.
 *
 * The Delta Annotation Rule's requirement is whitespace verified empty. A page
 * is empty where it carries neither glyphs nor marks. These tests pin that
 * definition in both halves of the loop: the band measurement that CHOOSES a
 * spot, and the audit that is the ship gate.
 */
import { describe, expect, it } from "vitest";
import {
  auditPlacements,
  measureWhitespaceBands,
  planVerifiedKeyedNotes,
  type PlacementPageGeometry,
  type PlacementRect,
  type PlacementWord,
} from "../annotationPlacementEngine";

const measureText = (text: string, fontSize: number) => text.length * fontSize * 0.5;
const PAGE: PlacementPageGeometry = { pageNumber: 1, pageWidth: 612, pageHeight: 792 };

/** Text down to y=400, then nothing the text layer can see. */
function wordsAbove400(): PlacementWord[] {
  const words: PlacementWord[] = [];
  for (let y = 100; y <= 400; y += 13) {
    words.push({ pageNumber: 1, x: 60, y, width: 300, height: 9, text: `row-${y}` });
  }
  return words;
}

/** The QR code: a large mark in the region the text layer reports as empty. */
const QR_CODE: PlacementRect = { pageNumber: 1, x: 60, y: 470, width: 110, height: 110 };

describe("whitespace means empty of marks, not just of glyphs", () => {
  it("without image occupancy the band swallows the QR code region — the defect", () => {
    const bands = measureWhitespaceBands(wordsAbove400(), PAGE);
    const covering = bands.find(
      (band) => band.y <= QR_CODE.y && band.y + band.height >= QR_CODE.y + QR_CODE.height
    );
    // This is the pre-fix behaviour, kept explicit so the fix below is
    // demonstrably doing something rather than passing vacuously.
    expect(covering).toBeDefined();
  });

  it("splits the band around a QR code once the mark is declared", () => {
    const bands = measureWhitespaceBands(wordsAbove400(), PAGE, { occupiedRegions: [QR_CODE] });
    for (const band of bands) {
      const overlapsQr =
        band.y < QR_CODE.y + QR_CODE.height && band.y + band.height > QR_CODE.y;
      expect(overlapsQr).toBe(false);
    }
    // The space above and below the QR code is still usable — the fix must not
    // simply blank out the page and send everything to the appendix.
    expect(bands.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores hairline marks so rules and spacers do not blank the page", () => {
    const hairline: PlacementRect = { pageNumber: 1, x: 60, y: 500, width: 400, height: 0.5 };
    const withHairline = measureWhitespaceBands(wordsAbove400(), PAGE, {
      occupiedRegions: [hairline],
    });
    // A 0.5pt rule splits nothing meaningful; the large band survives it. (The
    // extractor filters these out by size; this asserts the engine stays usable
    // even if one slips through.)
    expect(withHairline.some((band) => band.height > 150)).toBe(true);
  });
});

describe("the audit refuses a note that lands on a mark", () => {
  it("fails a placement covering an image, with a reason naming it", () => {
    const failures = auditPlacements(
      [{ id: "note-1", rect: { pageNumber: 1, x: 60, y: 480, width: 300, height: 40 } }],
      wordsAbove400(),
      [PAGE],
      [QR_CODE]
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].detail).toMatch(/non-text mark \(image\/QR\/logo\)/);
  });

  it("passes the same placement when nothing is there", () => {
    expect(
      auditPlacements(
        [{ id: "note-1", rect: { pageNumber: 1, x: 60, y: 480, width: 300, height: 40 } }],
        wordsAbove400(),
        [PAGE],
        []
      )
    ).toEqual([]);
  });
});

describe("end to end: the note moves off the QR code", () => {
  it("places the note clear of the mark instead of across it", () => {
    const result = planVerifiedKeyedNotes({
      requests: [{ id: "delta-note-p1-0", pageNumber: 1, text: "Ln 63 Interior Protection kit ($3.22): not written on the comparison estimate" }],
      words: wordsAbove400(),
      pages: [PAGE],
      measureText,
      occupiedRegions: [QR_CODE],
    });
    expect(result.placed).toHaveLength(1);
    const rect = result.placed[0].rect;
    const overlapsQr =
      rect.pageNumber === QR_CODE.pageNumber &&
      rect.x < QR_CODE.x + QR_CODE.width &&
      rect.x + rect.width > QR_CODE.x &&
      rect.y < QR_CODE.y + QR_CODE.height &&
      rect.y + rect.height > QR_CODE.y;
    expect(overlapsQr).toBe(false);
    // The loop's own gate: a clean plan audits with zero failures.
    expect(result.audits[result.audits.length - 1]).toEqual([]);
  });
});
