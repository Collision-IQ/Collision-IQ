/**
 * The client's reading of the dispute report's question — which comparison
 * upload is the insurer's estimate — from the route's response.
 */
import { describe, expect, it } from "vitest";
import { counterpartChoiceKey, describeCounterpartCandidate, parseCounterpartChoice } from "../counterpartChoice";

const candidate = { sourceDocumentId: "sor2", fileName: "SOR-2 22279.pdf", grandTotal: 4408.16, version: "Supplement 2", printedAt: "9/30/2026 09:00", printsOur: null };

describe("counterpartChoice on the client", () => {
  it("reads the route's question and drops what it cannot use", () => {
    expect(
      parseCounterpartChoice({
        required: true,
        reason: "Appraisal Dispute Report not produced: …",
        comparedDocumentId: null,
        confirmedByUser: false,
        candidates: [candidate, { fileName: "no id.pdf" }, null, { sourceDocumentId: "x", fileName: "x.pdf", grandTotal: "12", version: 3, printsOur: "Workfile ID" }, { sourceDocumentId: "y", fileName: "y.pdf", printsOur: "estimator" }],
      })
    ).toEqual({
      required: true,
      reason: "Appraisal Dispute Report not produced: …",
      comparedDocumentId: null,
      confirmedByUser: false,
      candidates: [
        candidate,
        { sourceDocumentId: "x", fileName: "x.pdf", grandTotal: null, version: null, printedAt: null, printsOur: "Workfile ID" },
        { sourceDocumentId: "y", fileName: "y.pdf", grandTotal: null, version: null, printedAt: null, printsOur: null },
      ],
    });
    for (const value of [undefined, null, "yes", { required: true }, { required: true, candidates: [] }]) {
      expect(parseCounterpartChoice(value)).toBeNull();
    }
  });

  it("describes a candidate only by what it prints", () => {
    expect(describeCounterpartCandidate(candidate)).toBe("Supplement 2 · printed 9/30/2026 09:00 · $4,408.16");
    expect(describeCounterpartCandidate({ ...candidate, version: null, printedAt: null, grandTotal: 15441.5 })).toBe("$15,441.50");
    expect(describeCounterpartCandidate({ ...candidate, version: null, printedAt: null, grandTotal: null })).toBe("No version, print date or total read from it");
    // A print tying it to us is said, so it is never chosen as the insurer's unawares.
    expect(describeCounterpartCandidate({ ...candidate, printsOur: "Workfile ID" })).toBe("Supplement 2 · printed 9/30/2026 09:00 · $4,408.16 · prints our Workfile ID");
  });

  it("a different question has a different key, so the picker starts unanswered", () => {
    const asked = parseCounterpartChoice({ required: true, candidates: [candidate, { ...candidate, sourceDocumentId: "doe", fileName: "Doe.pdf" }] })!;
    const answered = parseCounterpartChoice({ required: false, comparedDocumentId: "sor2", confirmedByUser: true, candidates: asked.candidates })!;
    expect(counterpartChoiceKey(asked)).not.toBe(counterpartChoiceKey(answered));
    expect(counterpartChoiceKey(asked)).toBe(counterpartChoiceKey(parseCounterpartChoice({ required: true, candidates: asked.candidates })!));
  });
});
