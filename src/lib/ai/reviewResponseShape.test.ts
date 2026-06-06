import { describe, expect, it } from "vitest";
import {
  buildReviewResponseShapeInstruction,
  resolveReviewResponseShape,
} from "./reviewResponseShape";

describe("resolveReviewResponseShape", () => {
  it("routes FET/policy dispute requests to carrier-facing structure", () => {
    const message =
      "Review this FET policy dispute and draft a carrier-facing ask based on what the claim file actually proves.";

    expect(resolveReviewResponseShape(message)).toBe("carrier_policy_dispute");
    expect(buildReviewResponseShapeInstruction(message)).toContain("Policy language needed");
    expect(buildReviewResponseShapeInstruction(message)).toContain(
      "Recommended carrier-facing ask"
    );
  });

  it("routes customer repair report requests to customer-facing structure", () => {
    const message =
      "Create a customer repair report in plain language from these uploads so the owner can understand next steps.";

    expect(resolveReviewResponseShape(message)).toBe("customer_repair_report");
    expect(buildReviewResponseShapeInstruction(message)).toContain("What we found");
    expect(buildReviewResponseShapeInstruction(message)).toContain("What you can ask for");
  });

  it("uses default concise structure for normal uploaded-document answers", () => {
    const message = "Does the file support adding post-repair scan and calibration lines?";

    expect(resolveReviewResponseShape(message)).toBe("default");
    expect(buildReviewResponseShapeInstruction(message)).toContain("Bottom line:");
    expect(buildReviewResponseShapeInstruction(message)).toContain("What the documents support:");
    expect(buildReviewResponseShapeInstruction(message)).toContain("What is not proven yet:");
    expect(buildReviewResponseShapeInstruction(message)).toContain("Best next step:");
  });
});