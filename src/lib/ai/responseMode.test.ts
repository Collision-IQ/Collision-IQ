import { describe, expect, it } from "vitest";
import { buildResponseModeInstruction, determineResponseMode } from "./responseMode";

describe("determineResponseMode", () => {
  it("defaults short operational questions to concise", () => {
    expect(
      determineResponseMode({
        userMessage: "Can I export this?",
        hasUploadedFiles: false,
        isFollowup: false,
      })
    ).toBe("concise");
  });

  it("uses concise for follow-up turns", () => {
    expect(
      determineResponseMode({
        userMessage: "What about the bumper labor?",
        hasUploadedFiles: false,
        isFollowup: true,
      })
    ).toBe("concise");
  });

  it("uses standard for recommendations and workflow guidance when not a quick question", () => {
    expect(
      determineResponseMode({
        userMessage:
          "Recommend a practical workflow for documenting scan, calibration, alignment, and final QC steps before delivery.",
        hasUploadedFiles: false,
        isFollowup: false,
      })
    ).toBe("standard");
  });

  it("keeps uploaded-file questions concise by default", () => {
    expect(
      determineResponseMode({
        userMessage: "What do you see?",
        hasUploadedFiles: true,
        isFollowup: false,
      })
    ).toBe("concise");
  });

  it("uses analysis only for explicit long-form requests", () => {
    for (const userMessage of [
      "Give me a full review with confidence scoring.",
      "Draft a formal rebuttal letter.",
      "Write a DOI complaint from this file.",
    ]) {
      expect(
        determineResponseMode({
          userMessage,
          hasUploadedFiles: false,
          isFollowup: false,
        })
      ).toBe("analysis");
    }
  });
});

describe("buildResponseModeInstruction", () => {
  it("injects the concise instruction: answer first, short, no scaffolding", () => {
    const instruction = buildResponseModeInstruction("concise");
    expect(instruction.startsWith("RESPONSE DEPTH: CONCISE\n")).toBe(true);
    expect(instruction).toContain("Answer in 2-5 sentences or at most 4 short bullets.");
    expect(instruction).toContain("Lead with the direct answer.");
    expect(instruction).toContain("NO headers, NO section scaffolding");
  });
});

