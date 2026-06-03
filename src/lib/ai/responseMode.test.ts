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

  it("uses analysis for uploaded files", () => {
    expect(
      determineResponseMode({
        userMessage: "What do you see?",
        hasUploadedFiles: true,
        isFollowup: false,
      })
    ).toBe("analysis");
  });

  it("uses analysis for estimates, insurance/legal implications, and explicit detail", () => {
    for (const userMessage of [
      "Review this estimate for missed operations.",
      "Explain the insurance implications in detail.",
      "Give me a full analysis with confidence scoring.",
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
  it("injects the exact concise instruction", () => {
    expect(buildResponseModeInstruction("concise")).toContain(
      "Answer in 1-4 sentences. Answer the user's question first."
    );
  });
});

