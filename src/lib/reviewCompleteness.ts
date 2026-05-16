export type ReviewCompletenessState =
  | "FULL_FILE_REVIEW_COMPLETE"
  | "NEAR_COMPLETE_REVIEW"
  | "SUBSTANTIALLY_COMPLETE_REVIEW"
  | "PARTIAL_REVIEW"
  | "INCOMPLETE_REVIEW";

export type ReviewCompletenessInput = {
  reviewed: number;
  total: number;
  unreviewedFileNames?: string[];
};

const MATERIAL_UNREVIEWED_FILE_PATTERN =
  /\b(estimate|supplement|invoice|final invoice|oem|procedure|calibration|alignment|structural|measurement|teardown|photo|appraisal|policy|clause)\b/i;

export function getReviewCompletenessState(
  input: ReviewCompletenessInput
): ReviewCompletenessState {
  const reviewed = normalizeCount(input.reviewed);
  const total = Math.max(normalizeCount(input.total), reviewed);
  if (total === 0 || reviewed >= total) return "FULL_FILE_REVIEW_COMPLETE";

  const ratio = reviewed / total;
  if (ratio >= 0.98) return "NEAR_COMPLETE_REVIEW";
  if (ratio >= 0.85) return "SUBSTANTIALLY_COMPLETE_REVIEW";
  if (ratio > 0.5) return "PARTIAL_REVIEW";
  return "INCOMPLETE_REVIEW";
}

export function buildReviewCompletenessMessage(input: ReviewCompletenessInput): string {
  const reviewed = normalizeCount(input.reviewed);
  const total = Math.max(normalizeCount(input.total), reviewed);
  const state = getReviewCompletenessState({ ...input, reviewed, total });
  const hasMaterialOmission = (input.unreviewedFileNames ?? []).some((name) =>
    MATERIAL_UNREVIEWED_FILE_PATTERN.test(name)
  );

  if (state === "FULL_FILE_REVIEW_COMPLETE") {
    return "Full-file review complete.";
  }

  if (state === "NEAR_COMPLETE_REVIEW") {
    const base =
      `Near-complete review: ${reviewed} of ${total} files reviewed. ` +
      "One or more files were not included in the final determination set.";

    return hasMaterialOmission
      ? `${base} The omitted file naming suggests potentially material repair, valuation, invoice, estimate, supplement, OEM, calibration, alignment, structural, appraisal, or policy evidence, so final-award confidence should stay caveated.`
      : `${base} This does not materially reduce directional appraisal confidence unless the omitted file contains conflicting repair, valuation, invoice, estimate, supplement, OEM, calibration, alignment, structural, appraisal, or policy evidence.`;
  }

  if (state === "SUBSTANTIALLY_COMPLETE_REVIEW") {
    return `Substantially complete review: ${reviewed} of ${total} files reviewed. Directional conclusions may be reliable, but final award confidence depends on whether the unreviewed files contain material repair or valuation evidence.`;
  }

  if (state === "PARTIAL_REVIEW") {
    return `Partial review: ${reviewed} of ${total} files reviewed. Use this as a provisional analysis, not a final umpire determination.`;
  }

  return `Incomplete review: ${reviewed} of ${total} files reviewed. Do not rely on this as a final umpire determination.`;
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
