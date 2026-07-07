import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  diffTypoSpans,
  extractProtectedTokens,
  normalizeCorrectedText,
  protectedTokensPreserved,
  requestTypoFix,
} from "@/lib/ai/typeHelper";

describe("type helper protected strings", () => {
  const draft =
    "VIN 1C4SJVFP1RS133438 on claim 22-04871: OEM part 68425873AC is $1,234.56 plus 2.5 hrs R&I, line 14, ADAS calib per CCC MOTOR and SCRS/DEG guidance, LKQ declined, R&R quarter.";

  it("extracts VIN, dollars, hours, part numbers, line numbers, and acronyms", () => {
    const tokens = extractProtectedTokens(draft);
    for (const expected of [
      "1C4SJVFP1RS133438",
      "$1,234.56",
      "2.5 hrs",
      "68425873AC",
      "22-04871",
      "14",
      "ADAS",
      "OEM",
      "CCC",
      "MOTOR",
      "SCRS",
      "DEG",
      "LKQ",
      "R&I",
      "R&R",
    ]) {
      expect(tokens).toContain(expected);
    }
  });

  it("passes when a correction keeps every protected string", () => {
    const corrected = draft.replace("calib", "calibration");
    expect(protectedTokensPreserved(draft, corrected)).toBe(true);
  });

  it.each([
    ["VIN", "1C4SJVFP1RS133438", "1C4SJVFP1RS133439"],
    ["dollar amount", "$1,234.56", "$1,234"],
    ["labor hours", "2.5 hrs", "2.5 hours roughly"],
    ["part number", "68425873AC", "68425873AB"],
    ["acronym R&I", "R&I", "remove and install"],
  ])("fails when the %s is altered", (_label, from, to) => {
    const corrected = draft.replace(from, to);
    expect(protectedTokensPreserved(draft, corrected)).toBe(false);
  });
});

describe("normalizeCorrectedText", () => {
  it("strips code fences and wrapping quotes", () => {
    expect(normalizeCorrectedText("```\nFixed text.\n```")).toBe("Fixed text.");
    expect(normalizeCorrectedText('"Fixed text."')).toBe("Fixed text.");
    expect(normalizeCorrectedText("Fixed text.")).toBe("Fixed text.");
  });
});

describe("requestTypoFix client behavior", () => {
  it("empty composer never calls the helper route", async () => {
    const fetcher = vi.fn();
    expect(await requestTypoFix("", fetcher)).toEqual({ status: "empty" });
    expect(await requestTypoFix("   \n", fetcher)).toEqual({ status: "empty" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns the corrected text on success without sending the message", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ correctedText: "Hello world." }),
    }));
    const result = await requestTypoFix("helo world", fetcher);
    expect(result).toEqual({ status: "fixed", correctedText: "Hello world." });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/type-helper",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("helper failure reports an error and leaves the draft to the caller untouched", async () => {
    const failing = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    expect(await requestTypoFix("draft text", failing)).toEqual({ status: "error" });

    const throwing = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(await requestTypoFix("draft text", throwing)).toEqual({ status: "error" });
  });

  it("no-op corrections are reported as unchanged", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ correctedText: "same text" }),
    }));
    expect(await requestTypoFix("same text", fetcher)).toEqual({ status: "unchanged" });
  });
});

describe("diffTypoSpans (inline underline diff)", () => {
  it("maps 1:1 word substitutions to spans with offsets and suggestions", () => {
    const original = "the bumperr needs repar on the left side";
    const corrected = "the bumper needs repair on the left side";
    const spans = diffTypoSpans(original, corrected);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ original: "bumperr", suggestion: "bumper" });
    expect(original.slice(spans[0].start, spans[0].end)).toBe("bumperr");
    expect(spans[1]).toMatchObject({ original: "repar", suggestion: "repair" });
  });

  it("returns nothing for identical text or insertions/deletions-only changes", () => {
    expect(diffTypoSpans("same text", "same text")).toHaveLength(0);
    // Pure insertion — nothing in the original to underline.
    expect(diffTypoSpans("the bumper", "the front bumper")).toHaveLength(0);
  });

  it("flags capitalization fixes but bails out on full rewrites", () => {
    expect(diffTypoSpans("honda civic runs", "Honda civic runs")).toHaveLength(1);
    const original = Array.from({ length: 30 }, (_, i) => `worda${i}`).join(" ");
    const corrected = Array.from({ length: 30 }, (_, i) => `wordb${i}`).join(" ");
    expect(diffTypoSpans(original, corrected)).toHaveLength(0);
  });
});

describe("composer wiring (source-level)", () => {
  const source = readFileSync(join(process.cwd(), "src", "components", "ChatWidget.tsx"), "utf8");
  const overlaySource = readFileSync(
    join(process.cwd(), "src", "components", "ComposerTypoUnderline.tsx"),
    "utf8"
  );

  it("composer uses the inline typo underline overlay (no Fix-typos button)", () => {
    expect(source).toContain("ComposerTypoUnderline");
    expect(source).not.toContain("data-type-helper-button");
    // Native squiggles are replaced by the overlay; mobile helpers remain.
    expect(source).toContain("spellCheck={false}");
    expect(source).toContain('autoCorrect="on"');
    expect(source).toContain('autoCapitalize="sentences"');
  });

  it("typo checking is debounced-idle and applying a suggestion never sends", () => {
    const effectStart = source.indexOf("const timer = setTimeout");
    expect(effectStart).toBeGreaterThan(-1);

    const applyStart = source.indexOf("const applyTypoFix");
    const applyEnd = source.indexOf("lastTypoCheckRef.current = null", applyStart);
    expect(applyStart).toBeGreaterThan(-1);
    const applyBlock = source.slice(applyStart, applyEnd);
    expect(applyBlock).toContain("setInput");
    expect(applyBlock).not.toContain("handleSend");
    // The overlay itself never touches send either.
    expect(overlaySource).not.toContain("handleSend");
    expect(overlaySource).not.toContain("fetch(");
  });

  it("manual edits clear stale underlines until the next idle re-check", () => {
    expect(source).toContain("setTypoSpans((prev) => (prev.length ? [] : prev))");
  });
});
