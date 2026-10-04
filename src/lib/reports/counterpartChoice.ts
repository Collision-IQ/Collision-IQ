/**
 * The Appraisal Dispute Report's question to the user — which comparison
 * upload is the insurer's estimate — as the Delta Citation Density route
 * returns it (`counterpartChoice`), and the client's reading of it. The answer
 * goes back as `comparisonDocumentId`. Client-safe: no server imports.
 */

export type CounterpartChoiceCandidate = {
  sourceDocumentId: string;
  fileName: string;
  /** What the estimate prints, each null when it does not print it. */
  grandTotal: number | null;
  version: string | null;
  printedAt: string | null;
  /** Our own header item it prints, when it prints one: our own version, or the insurer's estimate printed from our system. */
  printsOur: "Workfile ID" | "Federal ID" | "letterhead" | null;
};

export type CounterpartChoice = {
  /** True when the dispute report was not produced because nothing printed settles which upload is the insurer's estimate. */
  required: boolean;
  /** The dispute report's refusal, when the run asks. */
  reason: string | null;
  /** The comparison the run measured against, when there was one. */
  comparedDocumentId: string | null;
  /** True when the user named the comparison, on that request or in the answer saved with the case. */
  confirmedByUser: boolean;
  /** True when that answer is saved with the case, so a later run uses it without asking. */
  savedWithCase: boolean;
  /** Every comparison the user may name; one printing our own estimator is never offered. */
  candidates: CounterpartChoiceCandidate[];
};

const nullableString = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
const nullableNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const HEADER_ITEMS = ["Workfile ID", "Federal ID", "letterhead"] as const;
const headerItem = (value: unknown) => HEADER_ITEMS.find((item) => item === value) ?? null;

/** Reads the route's counterpartChoice, or null when it is absent or malformed. */
export function parseCounterpartChoice(value: unknown): CounterpartChoice | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.candidates)) return null;
  const candidates = raw.candidates.flatMap((entry): CounterpartChoiceCandidate[] => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    const sourceDocumentId = nullableString(candidate.sourceDocumentId);
    const fileName = nullableString(candidate.fileName);
    if (!sourceDocumentId || !fileName) return [];
    return [
      {
        sourceDocumentId,
        fileName,
        grandTotal: nullableNumber(candidate.grandTotal),
        version: nullableString(candidate.version),
        printedAt: nullableString(candidate.printedAt),
        printsOur: headerItem(candidate.printsOur),
      },
    ];
  });
  if (!candidates.length) return null;
  return {
    required: raw.required === true,
    reason: nullableString(raw.reason),
    comparedDocumentId: nullableString(raw.comparedDocumentId),
    confirmedByUser: raw.confirmedByUser === true,
    savedWithCase: raw.savedWithCase === true,
    candidates,
  };
}

/**
 * The user's answer as saved with the case (report.counterpartAnswers, keyed
 * by the annotated estimate): the insurer's estimate, and the comparisons it
 * was chosen among. A question over different comparisons — an upload added
 * or removed since — is a new question, so the answer does not carry over.
 */
export type CounterpartAnswer = {
  insurerDocumentId: string;
  candidateIds: string[];
  answeredAt: string;
};

/**
 * The saved answer for a run whose comparisons are `candidateIds`: `apply`
 * when it was given among exactly these, `stale` when among others, null when
 * there is none (or it cannot be read).
 */
export function resolveSavedCounterpartAnswer(
  saved: unknown,
  candidateIds: string[]
): { apply: CounterpartAnswer } | { stale: CounterpartAnswer } | null {
  if (!saved || typeof saved !== "object") return null;
  const raw = saved as Record<string, unknown>;
  const insurerDocumentId = nullableString(raw.insurerDocumentId);
  if (!insurerDocumentId || !Array.isArray(raw.candidateIds)) return null;
  const answer: CounterpartAnswer = {
    insurerDocumentId,
    candidateIds: raw.candidateIds.filter((id): id is string => typeof id === "string"),
    answeredAt: nullableString(raw.answeredAt) ?? "",
  };
  const asked = new Set(answer.candidateIds);
  const now = new Set(candidateIds);
  const same = asked.size === now.size && [...asked].every((id) => now.has(id));
  return same && now.has(insurerDocumentId) ? { apply: answer } : { stale: answer };
}

/** Identifies a question by what it asks, so a new one starts unanswered. */
export function counterpartChoiceKey(choice: CounterpartChoice): string {
  return [choice.required ? "required" : "open", choice.comparedDocumentId ?? "", ...choice.candidates.map((candidate) => candidate.sourceDocumentId)].join("|");
}

/** One line for a candidate from what it prints: "Supplement 2 · printed 9/30/2026 09:00 · $4,408.16 · prints our Workfile ID". */
export function describeCounterpartCandidate(candidate: CounterpartChoiceCandidate): string {
  const parts = [
    candidate.version,
    candidate.printedAt ? `printed ${candidate.printedAt}` : null,
    candidate.grandTotal !== null
      ? `$${candidate.grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null,
    candidate.printsOur ? `prints our ${candidate.printsOur}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No version, print date or total read from it";
}
