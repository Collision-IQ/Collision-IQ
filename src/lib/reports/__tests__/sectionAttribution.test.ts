/**
 * S-3 — a row's section is the nearest section header ABOVE it, in reading
 * order, within the same document.
 *
 * RO 22182 attributed 54 findings to "the windshield" — including line 118
 * (QUARTER PANEL) and lines 152-155 (REAR LAMPS) — because section headers
 * were matched against a CLOSED VOCABULARY of names. The Tesla estimate's
 * real headers (QUARTER PANEL, PILLARS ROCKER & FLOOR, REAR LAMPS, TRUNK LID,
 * SEATS & TRACKS) were unlisted, so every row from line 17 to line 200
 * inherited the one header that WAS listed: WINDSHIELD.
 *
 * These guards assert the correct section is PRESENT on each row, and that
 * the running section is non-decreasing in reading order — not merely that
 * some previously-wrong name is absent.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { parseEstimateRows, type EstimateRow, type Word } from "../deltaEngine/rowCluster";
import { parseCccEstimateRows } from "../estimateDeltaMatcher";

const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures/22182");

function loadWords(name: string): Map<number, Word[]> {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as Record<string, Word[]>;
  return new Map(Object.entries(raw).map(([page, words]) => [Number(page), words]));
}

const shop: EstimateRow[] = parseEstimateRows(loadWords("shop_words.json"));

describe("every row carries the section it is actually printed under", () => {
  it("L118 (structural adhesive) sits in QUARTER PANEL, not WINDSHIELD", () => {
    const row = shop.find((candidate) => candidate.line === 118)!;
    expect(row.sectionLabel).toBe("QUARTER PANEL");
  });

  it("L152-L155 (tail lamp grommets) sit in REAR LAMPS", () => {
    for (const line of [152, 153, 154, 155]) {
      const row = shop.find((candidate) => candidate.line === line);
      expect(row?.sectionLabel).toBe("REAR LAMPS");
    }
  });

  it("WINDSHIELD claims only the two rows printed beneath it", () => {
    const windshield = shop.filter((row) => row.sectionLabel === "WINDSHIELD");
    expect(windshield.map((row) => row.line)).toEqual([17, 18]);
  });

  it("the document's headers are all represented, not just the ones a list knows", () => {
    const sections = new Set(shop.map((row) => row.sectionLabel));
    for (const header of [
      "QUARTER PANEL",
      "PILLARS, ROCKER & FLOOR",
      "REAR LAMPS",
      "TRUNK LID",
      "SEATS & TRACKS",
      "REAR DOOR",
      "REAR BUMPER",
      "VEHICLE DIAGNOSTICS",
    ]) {
      expect(sections).toContain(header);
    }
  });
});

describe("section assignment is non-decreasing across line numbers", () => {
  const assertMonotonic = (rows: Array<{ line: number; section: string }>) => {
    // Each section owns a CONTIGUOUS run of line numbers: a section that ends
    // and later resumes means a row inherited a header printed below it.
    const firstSeen = new Map<string, number>();
    const lastSeen = new Map<string, number>();
    for (const row of rows) {
      if (!firstSeen.has(row.section)) firstSeen.set(row.section, row.line);
      lastSeen.set(row.section, row.line);
    }
    for (const [section, start] of firstSeen) {
      const end = lastSeen.get(section)!;
      const interlopers = rows.filter(
        (row) => row.line > start && row.line < end && row.section !== section
      );
      expect({ section, interlopers: interlopers.map((row) => row.line) }).toEqual({
        section,
        interlopers: [],
      });
    }
  };

  it("word path: every section owns a contiguous run of line numbers", () => {
    assertMonotonic(
      [...shop]
        .sort((a, b) => a.line - b.line)
        .map((row) => ({ line: row.line, section: row.sectionLabel ?? "" }))
    );
  });

  it("text path: every section owns a contiguous run of line numbers", () => {
    const text = fs.readFileSync(path.join(FIXTURE_DIR, "shop_text.txt"), "utf8");
    const rows = parseCccEstimateRows(text)
      .filter((row): row is typeof row & { lineNumber: number } => row.lineNumber !== null)
      .map((row) => ({ line: row.lineNumber, section: row.section ?? "" }))
      .sort((a, b) => a.line - b.line);
    expect(rows.length).toBeGreaterThan(100);
    // Positive check first: a monotonicity assertion alone passes when a
    // header is MISSED entirely (the rows simply stay under the previous
    // one), so name the sections that must be present and where.
    expect(rows.find((row) => row.line === 118)?.section).toBe("QUARTER PANEL");
    expect(rows.find((row) => row.line === 152)?.section).toBe("REAR LAMPS");
    expect(rows.find((row) => row.line === 40)?.section).toBe("PILLARS, ROCKER & FLOOR");
    assertMonotonic(rows);
  });
});
