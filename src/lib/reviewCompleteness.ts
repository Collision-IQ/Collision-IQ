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

export type ExcludedFromReviewReason =
  | "NON_REVIEWABLE"
  | "DUPLICATE"
  | "UNSUPPORTED_TYPE"
  | "METADATA_ONLY"
  | "FAILED_EXTRACTION"
  | "INTERNAL_CONTAINER"
  | "EMPTY_FILE";

export type ExcludedFromReviewFileDiagnostic = {
  filename: string;
  detectedType: string;
  reason: ExcludedFromReviewReason;
  indexed: boolean;
  stage?: string;
  parsed?: boolean;
  supportOnly?: boolean;
  duplicate?: boolean;
  duplicateOf?: string | null;
  reviewabilityHint?: string;
};

export type ReviewProgressCounts = {
  uploadedCount: number;
  indexedCount: number;
  visionProcessedCount: number;
  reviewableFileCount: number;
  reviewedFileCount: number;
  excludedFromReviewCount: number;
  excludedFromReviewReasons: ExcludedFromReviewReason[];
  excludedFromReviewFiles: ExcludedFromReviewFileDiagnostic[];
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
    return "All uploaded reviewable files were reviewed. Repair-package completeness depends on the specific proof categories, not the upload count alone.";
  }

  if (state === "NEAR_COMPLETE_REVIEW") {
    const base =
      `Near-complete review: ${reviewed} of ${total} reviewable files reviewed. ` +
      "One or more files were not included in the final determination set.";

    return hasMaterialOmission
      ? `${base} The omitted file naming suggests potentially material repair, valuation, invoice, estimate, supplement, OEM, calibration, alignment, structural, appraisal, or policy evidence, so final-award confidence should stay caveated.`
      : `${base} This does not materially reduce directional appraisal confidence unless the omitted file contains conflicting repair, valuation, invoice, estimate, supplement, OEM, calibration, alignment, structural, appraisal, or policy evidence.`;
  }

  if (state === "SUBSTANTIALLY_COMPLETE_REVIEW") {
    return `Substantially complete review: ${reviewed} of ${total} reviewable files reviewed. Directional conclusions may be reliable, but final award confidence depends on whether the unreviewed files contain material repair or valuation evidence.`;
  }

  if (state === "PARTIAL_REVIEW") {
    return `Partial review: ${reviewed} of ${total} reviewable files reviewed. Use this as a provisional analysis, not a final umpire determination.`;
  }

  return `Incomplete review: ${reviewed} of ${total} reviewable files reviewed. Do not rely on this as a final umpire determination.`;
}

export function buildIndexedExclusionAuditNote(input: {
  indexedCount: number;
  reviewableFileCount: number;
  excludedFromReviewCount?: number;
  excludedFromReviewFiles?: ExcludedFromReviewFileDiagnostic[];
}): string | null {
  const indexed = normalizeCount(input.indexedCount);
  const reviewable = normalizeCount(input.reviewableFileCount);
  const excluded = Math.max(normalizeCount(input.excludedFromReviewCount), indexed - reviewable);
  if (indexed <= reviewable || excluded <= 0) return null;

  const fileDetails = (input.excludedFromReviewFiles ?? [])
    .slice(0, 12)
    .map((file) => {
      const parsed = typeof file.parsed === "boolean" ? `; parsed=${file.parsed ? "yes" : "no"}` : "";
      const supportOnly = file.supportOnly ? "; support-only=yes" : "";
      const duplicate = file.duplicate ? `; duplicate=${file.duplicateOf ?? "yes"}` : "";
      const hint = file.reviewabilityHint ? `; reviewable if ${file.reviewabilityHint}` : "";
      return `${file.filename} (${file.detectedType}; reason=${file.reason}; stage=${file.stage ?? "reviewability"}; indexed=${file.indexed ? "yes" : "no"}${parsed}${supportOnly}${duplicate}${hint})`;
    });

  if (fileDetails.length > 0) {
    return `${excluded} indexed ${excluded === 1 ? "item was" : "items were"} excluded from determination review: ${fileDetails.join("; ")}.`;
  }

  return `${excluded} indexed ${excluded === 1 ? "item was" : "items were"} excluded from determination review. File-level diagnostics with filenames and reasons are required before treating exclusions as reviewed.`;
}

export function normalizeReviewProgressCounts(input: {
  uploadedCount?: number | null;
  indexedCount?: number | null;
  visionProcessedCount?: number | null;
  reviewableFileCount?: number | null;
  reviewedFileCount?: number | null;
  excludedFromReviewCount?: number | null;
  excludedFromReviewReasons?: ExcludedFromReviewReason[] | null;
  excludedFromReviewFiles?: ExcludedFromReviewFileDiagnostic[] | null;
}): ReviewProgressCounts {
  const uploadedCount = normalizeCount(input.uploadedCount);
  const indexedCount = normalizeCount(input.indexedCount);
  const visionProcessedCount = normalizeCount(input.visionProcessedCount);
  const reviewedFileCount = normalizeCount(input.reviewedFileCount);
  const explicitReviewable = input.reviewableFileCount;
  const reviewableFileCount = Math.max(
    normalizeCount(explicitReviewable),
    reviewedFileCount
  );
  const inferredExcluded = Math.max(0, indexedCount - reviewableFileCount);
  const excludedFromReviewCount = Math.max(
    normalizeCount(input.excludedFromReviewCount),
    inferredExcluded
  );
  const excludedFromReviewReasons =
    input.excludedFromReviewReasons?.length
      ? [...new Set(input.excludedFromReviewReasons)]
      : excludedFromReviewCount > 0
        ? ["METADATA_ONLY" as const]
        : [];
  const excludedFromReviewFiles = dedupeExcludedFiles(input.excludedFromReviewFiles ?? []);

  return {
    uploadedCount,
    indexedCount,
    visionProcessedCount,
    reviewableFileCount,
    reviewedFileCount,
    excludedFromReviewCount,
    excludedFromReviewReasons,
    excludedFromReviewFiles,
  };
}

function dedupeExcludedFiles(
  files: ExcludedFromReviewFileDiagnostic[]
): ExcludedFromReviewFileDiagnostic[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.filename}:${file.detectedType}:${file.reason}:${file.indexed}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}
