import { describe, expect, it } from "vitest";
import {
  auditPlacements,
  findCollidingWords,
  measureWhitespaceBands,
  planKeyedNotes,
  planVerifiedKeyedNotes,
  rectsIntersect,
  resolveValueStamp,
  type PlacementPageGeometry,
  type PlacementWord,
} from "../annotationPlacementEngine";

/** Deterministic width model: 5pt per character at 10pt, scaled linearly. */
const measureText = (text: string, fontSize: number) => text.length * fontSize * 0.5;

const PAGE: PlacementPageGeometry = { pageNumber: 1, pageWidth: 612, pageHeight: 792 };

function word(x: number, y: number, width: number, height: number, text = "w", pageNumber = 1): PlacementWord {
  return { pageNumber, x, y, width, height, text };
}

/** A dense page: body rows every 13pt from y=100 to y=690, footer at y=760. */
function densePageWords(): PlacementWord[] {
  const words: PlacementWord[] = [];
  for (let y = 100; y <= 690; y += 13) {
    words.push(word(60, y, 300, 9, `row-${y}`));
    words.push(word(420, y, 30, 9, "123.45"));
  }
  words.push(word(60, 760, 200, 9, "footer"));
  return words;
}

describe("rectsIntersect", () => {
  it("detects overlap on the same page only", () => {
    const a = { pageNumber: 1, x: 0, y: 0, width: 10, height: 10 };
    const b = { pageNumber: 1, x: 5, y: 5, width: 10, height: 10 };
    expect(rectsIntersect(a, b)).toBe(true);
    expect(rectsIntersect(a, { ...b, pageNumber: 2 })).toBe(false);
    expect(rectsIntersect(a, { ...b, x: 20, y: 20 })).toBe(false);
  });
});

describe("measureWhitespaceBands", () => {
  it("finds the band between the last body row and the footer", () => {
    const bands = measureWhitespaceBands(densePageWords(), PAGE);
    const footerBand = bands.find((band) => band.y > 690 && band.y + band.height <= 760);
    expect(footerBand).toBeDefined();
    expect(footerBand!.y).toBeGreaterThanOrEqual(694);
    expect(footerBand!.height).toBeGreaterThanOrEqual(12);
  });

  it("finds large interior gaps on sparse pages", () => {
    const words = [word(60, 100, 300, 10), word(60, 500, 300, 10)];
    const bands = measureWhitespaceBands(words, PAGE);
    const interior = bands.find((band) => band.y >= 110 && band.y + band.height <= 500);
    expect(interior).toBeDefined();
    expect(interior!.height).toBeGreaterThan(300);
  });

  it("returns no bands narrower than the minimum height", () => {
    const words: PlacementWord[] = [];
    for (let y = 0; y <= 780; y += 10) words.push(word(60, y, 300, 9));
    expect(measureWhitespaceBands(words, PAGE)).toEqual([]);
  });
});

describe("findCollidingWords", () => {
  it("excludes the struck target word from collisions", () => {
    const target = { pageNumber: 1, x: 420, y: 100, width: 30, height: 9 };
    const words = [word(420, 100, 30, 9, "96.22"), word(480, 100, 15, 9, "0.1")];
    const stampRect = { pageNumber: 1, x: 452, y: 100, width: 25, height: 9 };
    const colliding = findCollidingWords(stampRect, words, [target]);
    expect(colliding.map((w) => w.text)).toEqual([]);
  });
});

describe("resolveValueStamp", () => {
  const target = { pageNumber: 1, x: 420, y: 100, width: 30, height: 9 };

  it("stamps beside the struck value when the space is clear", () => {
    const words = [word(420, 100, 30, 9, "96.22"), word(560, 100, 15, 9, "0.1")];
    const placement = resolveValueStamp({ targetRect: target, stampText: "$99.00", fontSize: 9 }, words, PAGE, measureText);
    expect(placement.mode).toBe("stamp");
    if (placement.mode === "stamp") {
      expect(placement.rect.x).toBeGreaterThan(target.x + target.width);
      expect(findCollidingWords(placement.rect, words, [target])).toEqual([]);
    }
  });

  it("degrades to mark_only when the stamp would cover a neighboring column", () => {
    const words = [word(420, 100, 30, 9, "43.00"), word(458, 100, 40, 9, "468.70")];
    const placement = resolveValueStamp({ targetRect: target, stampText: "$60.00", fontSize: 9 }, words, PAGE, measureText);
    expect(placement.mode).toBe("mark_only");
    if (placement.mode === "mark_only") {
      expect(placement.collidingText).toContain("468.70");
    }
  });

  it("degrades to mark_only at the page edge", () => {
    const edgeTarget = { pageNumber: 1, x: 580, y: 100, width: 28, height: 9 };
    const placement = resolveValueStamp({ targetRect: edgeTarget, stampText: "$1,234.00", fontSize: 9 }, [], PAGE, measureText);
    expect(placement.mode).toBe("mark_only");
  });
});

describe("planKeyedNotes", () => {
  it("stacks notes into the bottom-most band without overlap", () => {
    const words = densePageWords();
    const bands = new Map([[1, measureWhitespaceBands(words, PAGE)]]);
    const { placed, unplaced } = planKeyedNotes(
      [
        { id: "a", pageNumber: 1, text: "MISSING: item one $5.00" },
        { id: "b", pageNumber: 1, text: "MISSING: item two 1.0 hr" },
      ],
      bands,
      measureText
    );
    expect(unplaced).toEqual([]);
    expect(placed).toHaveLength(2);
    expect(placed[0].rect.y).not.toBe(placed[1].rect.y);
    expect(rectsIntersect(placed[0].rect, placed[1].rect)).toBe(false);
  });

  it("returns notes as unplaced when no band can hold them", () => {
    const bands = new Map([[1, [] as ReturnType<typeof measureWhitespaceBands>]]);
    const { placed, unplaced } = planKeyedNotes([{ id: "a", pageNumber: 1, text: "note" }], bands, measureText);
    expect(placed).toEqual([]);
    expect(unplaced.map((request) => request.id)).toEqual(["a"]);
  });

  it("steps the font size down before giving up on a wide note", () => {
    const words = densePageWords();
    const bands = new Map([[1, measureWhitespaceBands(words, PAGE)]]);
    const wide = "M".repeat(150); // 600pt at size 8, fits at reduced size
    const { placed } = planKeyedNotes([{ id: "wide", pageNumber: 1, text: wide }], bands, measureText);
    expect(placed).toHaveLength(1);
    expect(placed[0].fontSize).toBeLessThan(8);
  });
});

describe("auditPlacements", () => {
  it("flags placements covering document text and out-of-page rects", () => {
    const words = [word(60, 100, 300, 9, "body")];
    const failures = auditPlacements(
      [
        { id: "covers", rect: { pageNumber: 1, x: 60, y: 100, width: 50, height: 9 } },
        { id: "outside", rect: { pageNumber: 1, x: 600, y: 780, width: 50, height: 20 } },
      ],
      words,
      [PAGE]
    );
    expect(failures.map((failure) => `${failure.id}:${failure.kind}`).sort()).toEqual([
      "covers:covers_document_text",
      "outside:out_of_page",
    ]);
  });

  it("flags overlapping placements", () => {
    const failures = auditPlacements(
      [
        { id: "a", rect: { pageNumber: 1, x: 60, y: 700, width: 100, height: 12 } },
        { id: "b", rect: { pageNumber: 1, x: 100, y: 705, width: 100, height: 12 } },
      ],
      [],
      [PAGE]
    );
    expect(failures.some((failure) => failure.kind === "overlaps_placement")).toBe(true);
  });
});

describe("planVerifiedKeyedNotes", () => {
  it("ends with a plan that audits at zero failures", () => {
    const words = densePageWords();
    const result = planVerifiedKeyedNotes({
      requests: [
        { id: "a", pageNumber: 1, text: "MISSING: op one $5.00" },
        { id: "b", pageNumber: 1, text: "OEM: verify position statement" },
        { id: "c", pageNumber: 2, text: "note on a page with no measured words" },
      ],
      words,
      pages: [PAGE],
      measureText,
    });
    expect(result.audits[result.audits.length - 1]).toEqual([]);
    expect(result.placed.map((note) => note.request.id).sort()).toEqual(["a", "b"]);
    // Page 2 has no measured geometry: the engine must refuse to invent one.
    expect(result.unplaced.map((request) => request.id)).toEqual(["c"]);
  });

  it("places nothing on a page whose whitespace cannot fit any note", () => {
    const words: PlacementWord[] = [];
    for (let y = 0; y <= 785; y += 10) words.push(word(30, y, 550, 9));
    const result = planVerifiedKeyedNotes({
      requests: [{ id: "a", pageNumber: 1, text: "no room" }],
      words,
      pages: [PAGE],
      measureText,
    });
    expect(result.placed).toEqual([]);
    expect(result.unplaced).toHaveLength(1);
  });
});
