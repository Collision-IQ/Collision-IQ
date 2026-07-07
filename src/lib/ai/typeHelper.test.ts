import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
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

describe("composer wiring (source-level)", () => {
  const source = readFileSync(join(process.cwd(), "src", "components", "ChatWidget.tsx"), "utf8");

  it("chat composer textarea has native spellcheck + mobile typing helpers", () => {
    const textareaBlock = source.slice(source.indexOf("chat-composer-textarea") - 2000, source.indexOf("chat-composer-textarea"));
    expect(textareaBlock).toContain("spellCheck");
    expect(textareaBlock).toContain('autoCorrect="on"');
    expect(textareaBlock).toContain('autoCapitalize="sentences"');
  });

  // Exact slice of the handleFixTypos useCallback (start → its dependency array).
  function fixTyposHandlerBlock(): string {
    const start = source.indexOf("const handleFixTypos");
    const end = source.indexOf("[input, typeHelperChecking, typeHelperUndoDraft]", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("Fix typos button calls the helper, never handleSend (no auto-send)", () => {
    const attrIndex = source.indexOf("data-type-helper-button");
    expect(attrIndex).toBeGreaterThan(-1);
    // Slice just the Fix-typos button's opening tag (its own <button ...>).
    const buttonOpen = source.lastIndexOf("<button", attrIndex);
    const buttonBlock = source.slice(buttonOpen, attrIndex);
    expect(buttonBlock).toContain("handleFixTypos");
    expect(buttonBlock).not.toContain("handleSend");

    expect(fixTyposHandlerBlock()).not.toContain("handleSend");
  });

  it("undo restores the saved pre-fix draft", () => {
    const handlerBlock = fixTyposHandlerBlock();
    expect(handlerBlock).toContain("setInput(typeHelperUndoDraft)");
    expect(handlerBlock).toContain("setTypeHelperUndoDraft(draft)");
  });
});
