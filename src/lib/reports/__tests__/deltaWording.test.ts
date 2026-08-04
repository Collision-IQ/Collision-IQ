/**
 * Reader-facing wording comes from the rules file, and cannot drift back into
 * a literal.
 *
 * RO 22116 shipped "MISSED on AMERICAN FAMILY" 44 times and "lower-cost
 * estimate" 219 times — 263 occurrences of vocabulary the release gate's R09
 * already rejects. They shipped because the annotator wrote its phrases
 * inline, so every wording fix was a per-document edit that died with its
 * document.
 *
 * The repo-wide scan at the bottom is the part that makes this stick: a new
 * literal anywhere under src/lib turns it red.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import RULES from "../data/deltaRules.json";
import { counterpartLabel, findBannedPhrases, formatBasis, notWrittenOn, onCounterpartOnly } from "../deltaWording";

describe("wording is descriptive, not accusatory", () => {
  it("states where a line is absent without asserting anyone missed it", () => {
    const text = notWrittenOn("AMERICAN FAMILY");
    expect(text).toContain("AMERICAN FAMILY");
    expect(text).not.toMatch(/MISSED on/i);
    expect(findBannedPhrases(text)).toEqual([]);
  });

  it("names the counterpart by role when one is resolved, neutrally when not", () => {
    expect(counterpartLabel("USAA")).toBe("USAA");
    expect(counterpartLabel(null)).toBe("the comparison estimate");
    expect(counterpartLabel("  ")).toBe("the comparison estimate");
    expect(findBannedPhrases(onCounterpartOnly(null))).toEqual([]);
  });
});

describe("an absent basis is not a zero basis", () => {
  it("renders a flat allowance as flat, never as 0.0 @ $0.00", () => {
    // RO 22116: the carrier allows a flat $650.00 for Paint Supplies.
    const text = formatBasis({ label: "AMERICAN FAMILY", hours: null, rate: null, amount: 650 });
    expect(text).toBe("AMERICAN FAMILY flat $650.00, no hrs/rate shown");
    expect(text).not.toMatch(/0\.0 @ \$ ?0\.00/);
  });

  it("renders a real basis normally", () => {
    expect(formatBasis({ label: "USAA", hours: 29.7, rate: 60, amount: 1782 })).toBe(
      "USAA 29.7 @ $60.00/hr"
    );
  });

  it("says so when there is no basis and no amount at all", () => {
    expect(formatBasis({ label: "USAA", hours: null, rate: null, amount: null })).toBe(
      "USAA no basis shown"
    );
  });
});

describe("the banned vocabulary is gone from the source, not just from one path", () => {
  const ROOT = path.join(__dirname, "../../..");
  const SKIP = new Set(["node_modules", "__tests__", ".next", "dist"]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const files = walk(path.join(ROOT, "lib"));

  it("finds no banned phrase in any non-test source file", () => {
    const offenders: string[] = [];
    for (const file of files) {
      // deltaWording.ts holds the list itself; deltaReleaseGate reads it.
      if (/deltaWording\.ts$|deltaReleaseGate\.ts$/.test(file)) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const phrase of RULES.wording.bannedPhrases as string[]) {
        // A comment may cite a defect by name; a template may not.
        const lines = source.split("\n");
        lines.forEach((line, index) => {
          const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, "");
          if (code.toLowerCase().includes(phrase.toLowerCase())) {
            offenders.push(`${path.relative(ROOT, file)}:${index + 1} ${phrase}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("scanned a meaningful number of files, so a passing result means something", () => {
    expect(files.length).toBeGreaterThan(50);
  });
});
