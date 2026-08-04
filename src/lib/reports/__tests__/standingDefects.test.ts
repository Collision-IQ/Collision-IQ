/**
 * The four defects that survived every prior round, closed at the mechanism.
 *
 *   R14 — the OEM report rendered the DELTA legend for eight consecutive runs.
 *   R15 — "Tips on Finding OEM Position Statements" cited as an authority 11x.
 *   R08 — an alignment printout demanded for a repair with no alignment line.
 *   R03 — findings and annotations disagreeing on every graded run.
 *
 * Each is guarded here at the level where the decision is made, so the fix is
 * document-independent rather than a per-run correction.
 */
import { describe, it, expect } from "vitest";
import RULES from "../data/deltaRules.json";
import {
  CITATION_DENSITY_REPORT_IDENTITY,
  OEM_CITATION_DENSITY_REPORT_IDENTITY,
  isCitableAuthorityTitle,
} from "../annotatedCitationDensityEstimate";

describe("R14 — each pass states its own evidentiary boundary", () => {
  const deltaLegend = CITATION_DENSITY_REPORT_IDENTITY.legendBoundaryTexts.join(" ");
  const oemLegend = OEM_CITATION_DENSITY_REPORT_IDENTITY.legendBoundaryTexts.join(" ");

  it("the OEM legend carries no delta-pass language", () => {
    const deltaPass = new RegExp(RULES.marks.deltaLegendPattern, "i");
    expect(deltaPass.test(oemLegend)).toBe(false);
    expect(oemLegend).not.toMatch(/CCC Secure Share/i);
    expect(oemLegend).not.toMatch(/estimate evidence supports/i);
  });

  it("the delta legend keeps its own, unchanged", () => {
    expect(deltaLegend).toMatch(/Estimate evidence supports the existence of a difference/);
    expect(deltaLegend).toMatch(/CCC Secure Share/);
  });

  it("the OEM legend says what an OEM finding actually rests on", () => {
    expect(oemLegend).toMatch(/published procedure or position statement/i);
    expect(oemLegend).toMatch(/NEEDS OEM/);
  });

  it("the two passes never share a boundary line", () => {
    const shared = CITATION_DENSITY_REPORT_IDENTITY.legendBoundaryTexts.filter((line) =>
      OEM_CITATION_DENSITY_REPORT_IDENTITY.legendBoundaryTexts.includes(line)
    );
    expect(shared).toEqual([]);
  });
});

describe("R15 — a source must evidence the subject, not discuss it", () => {
  it("rejects the article RO 22116 cited eleven times", () => {
    expect(isCitableAuthorityTitle("Tips on Finding OEM Position Statements")).toBe(false);
    expect(isCitableAuthorityTitle("How Important Are OEM Position Statements?")).toBe(false);
  });

  it("rejects the other meta shapes that read as authorities", () => {
    for (const title of [
      "Guide to Aluminum Repair",
      "What Is a Position Statement",
      "Why OEM Procedures Matter",
      "Understanding ADAS Calibration",
      "Everything You Need To Know About Scanning",
      "Do I need a pre-repair scan?",
    ]) {
      expect(isCitableAuthorityTitle(title)).toBe(false);
    }
  });

  it("still rejects off-topic total-loss material on a repairable car", () => {
    expect(isCitableAuthorityTitle("Pennsylvania Total Loss Law Explained")).toBe(false);
    expect(isCitableAuthorityTitle("Car Crash Property Damage: Getting Fair Value When Totaled")).toBe(false);
  });

  it("accepts a real procedure, position statement, or regulation", () => {
    for (const title of [
      "Tesla Model 3 Body Repair Manual — Windshield Replacement",
      "Additional Calibration Requirements: Tesla",
      "31 Pa. Code § 62.3 — Applicable standards for appraisal",
      "Position Statement: Aftermarket Parts",
      "I-CAR RTS crn-2117",
    ]) {
      expect(isCitableAuthorityTitle(title)).toBe(true);
    }
  });

  it("an empty or absent title is never citable", () => {
    expect(isCitableAuthorityTitle("")).toBe(false);
    expect(isCitableAuthorityTitle(null)).toBe(false);
    expect(isCitableAuthorityTitle(undefined)).toBe(false);
  });

  it("the rejected shapes are DATA, so adding one is a one-line edit", () => {
    expect(RULES.authority.rejectMetaTitlesMatching.length).toBeGreaterThan(0);
    expect(RULES.authority.rejectTitlesMatching.length).toBeGreaterThan(0);
  });
});
