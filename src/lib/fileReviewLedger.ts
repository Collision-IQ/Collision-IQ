import type { StoredAttachment } from "@/lib/uploadedAttachmentStore";
import {
  classifyCitationDensityAttachment,
  type CitationDensityDocumentType,
} from "@/lib/reports/citationDensityDocumentClassifier";
import type {
  CaseEvidenceRegistryItem,
  CaseEvidenceSourceType,
} from "@/lib/ai/types/analysis";
import type { ExcludedFromReviewReason } from "@/lib/reviewCompleteness";

export type EvidenceCompletenessCategory =
  | "shop_estimate"
  | "carrier_estimate"
  | "supplement"
  | "final_invoice"
  | "parts_invoice"
  | "material_invoice"
  | "scan_pre"
  | "scan_post"
  | "scan_in_process"
  | "diagnostic_report"
  | "calibration_record"
  | "revvadas_record"
  | "alignment_printout"
  | "teardown_photo"
  | "progress_photo"
  | "completion_photo"
  | "oem_procedure"
  | "position_statement"
  | "work_authorization"
  | "physical_inspection_demand"
  | "carrier_correspondence"
  | "policy_document"
  | "payment_ledger";

export type EvidenceCompletenessStatus =
  | "present"
  | "present_but_not_line_tied"
  | "present_but_not_invoice_backed"
  | "present_but_not_final"
  | "referenced_not_produced"
  | "not_found"
  | "not_reviewed"
  | "excluded"
  | "extraction_failed"
  | "not_required";

export type EvidenceCategoryResolution = {
  category: EvidenceCompletenessCategory;
  requiredForThisCase: boolean;
  matchedFiles: string[];
  candidateFiles: string[];
  rejectedCandidates: Array<{
    filename: string;
    reason: string;
  }>;
  matchConfidence: number;
  status: EvidenceCompletenessStatus;
  reason: string;
};

export type FileReviewLedgerEntry = {
  fileId: string;
  filename: string;
  originalFilename: string;
  extension: string;
  mimeType: string;
  fileSize: number | null;
  uploadOrder: number;
  documentType: CitationDensityDocumentType | CaseEvidenceSourceType | "unknown";
  documentTypeConfidence: number;
  indexedStatus: "indexed" | "not_indexed";
  textExtractionStatus: "extracted" | "empty" | "not_applicable";
  visionExtractionStatus: "processed" | "not_applicable" | "not_run";
  pdfExtractionStatus: "available" | "missing_bytes" | "not_pdf";
  ocrStatus: "not_run" | "not_applicable";
  isDuplicate: boolean;
  duplicateOf: string | null;
  isSupported: boolean;
  isReviewable: boolean;
  reviewedForDetermination: boolean;
  usedInDetermination: boolean;
  usedInCitationDensity: boolean;
  usedInOemCitationDensity: boolean;
  usedInRepairIntelligence: boolean;
  usedAsSupportOnly: boolean;
  exclusionReason: ExcludedFromReviewReason | null;
  exclusionStage: string | null;
  parserReviewerUsed: string;
  evidenceCategoriesDetected: EvidenceCompletenessCategory[];
  relatedFindingIds: string[];
  relatedEstimateLineIds: string[];
  errorMessage: string | null;
  reviewabilityHint: string;
};

export type FileReviewDiagnosticsSummary = {
  totalUploaded: number;
  pdfCount: number;
  imageCount: number;
  parsedPdfCount: number;
  pdfBytesAvailableCount: number;
  scannedPdfFallbackCount: number;
  imageVisionCount: number;
  indexedCount: number;
  reviewedCount: number;
  reviewableCount: number;
  determinationEligibleCount: number;
  determinationUsedCount: number;
  supportOnlyCount: number;
  excludedCount: number;
  excludedFiles: Array<{
    filename: string;
    detectedType: string;
    reason: ExcludedFromReviewReason;
    indexed: boolean;
    stage: string;
    parsed: boolean;
    supportOnly: boolean;
    duplicate: boolean;
    duplicateOf: string | null;
    reviewabilityHint: string;
  }>;
};

export function buildFileReviewLedger(
  attachments: StoredAttachment[],
  options: {
    usedInRepairIntelligenceIds?: Iterable<string>;
    usedInCitationDensityIds?: Iterable<string>;
    usedInOemCitationDensityIds?: Iterable<string>;
  } = {}
): FileReviewLedgerEntry[] {
  const duplicateByHash = new Map<string, string>();
  const usedInRepairIntelligenceIds = new Set(options.usedInRepairIntelligenceIds ?? []);
  const usedInCitationDensityIds = new Set(options.usedInCitationDensityIds ?? []);
  const usedInOemCitationDensityIds = new Set(options.usedInOemCitationDensityIds ?? []);

  return attachments.map((attachment, index) => {
    const citationClassification = classifyCitationDensityAttachment(attachment);
    const categories = detectEvidenceCategories(`${attachment.filename}\n${attachment.text ?? ""}`, attachment.type);
    const sourceType = classifyLedgerSourceType(attachment, categories);
    const documentType = citationClassification.detectedDocumentType !== "unknown"
      ? citationClassification.detectedDocumentType
      : sourceType;
    const duplicateKey = attachment.sha256 || "";
    const duplicateOf = duplicateKey ? duplicateByHash.get(duplicateKey) ?? null : null;
    if (duplicateKey && !duplicateOf) duplicateByHash.set(duplicateKey, attachment.id);
    const exclusionReason = getLedgerExclusionReason(attachment, sourceType, duplicateOf);
    const isReviewable = !exclusionReason;
    const isPdf = isPdfAttachment(attachment);
    const hasText = Boolean(attachment.text?.trim());
    const isImage = attachment.type.startsWith("image/");
    const supportOnly = isSupportOnlyDocumentType(documentType, categories);
    const usedInCitationDensity = usedInCitationDensityIds.has(attachment.id) || citationClassification.isEstimateLike;
    const usedInOemCitationDensity = usedInOemCitationDensityIds.has(attachment.id) || categories.some((category) =>
      category === "oem_procedure" || category === "position_statement"
    );
    const usedInRepairIntelligence = usedInRepairIntelligenceIds.has(attachment.id) || isReviewable;

    return {
      fileId: attachment.id,
      filename: attachment.filename,
      originalFilename: attachment.filename,
      extension: getExtension(attachment.filename),
      mimeType: attachment.type,
      fileSize: attachment.sizeBytes ?? null,
      uploadOrder: index + 1,
      documentType,
      documentTypeConfidence: citationClassification.confidence,
      indexedStatus: attachment.id ? "indexed" : "not_indexed",
      textExtractionStatus: hasText ? "extracted" : isPdf ? "empty" : "not_applicable",
      visionExtractionStatus: isImage ? "processed" : "not_applicable",
      pdfExtractionStatus: isPdf ? attachment.imageDataUrl ? "available" : "missing_bytes" : "not_pdf",
      ocrStatus: isImage || isPdf && !hasText ? "not_run" : "not_applicable",
      isDuplicate: Boolean(duplicateOf),
      duplicateOf,
      isSupported: exclusionReason !== "UNSUPPORTED_TYPE",
      isReviewable,
      reviewedForDetermination: isReviewable,
      usedInDetermination: isReviewable && !supportOnly,
      usedInCitationDensity,
      usedInOemCitationDensity,
      usedInRepairIntelligence,
      usedAsSupportOnly: supportOnly,
      exclusionReason,
      exclusionStage: exclusionReason ? "reviewability" : null,
      parserReviewerUsed: resolveParserReviewer(attachment, isPdf, isImage),
      evidenceCategoriesDetected: categories,
      relatedFindingIds: [],
      relatedEstimateLineIds: [],
      errorMessage: exclusionReason === "EMPTY_FILE" ? "No extracted text or viewable bytes were available." : null,
      reviewabilityHint: buildReviewabilityHint(exclusionReason, supportOnly),
    };
  });
}

export function buildFileReviewDiagnosticsSummary(
  attachments: StoredAttachment[],
  ledger = buildFileReviewLedger(attachments)
): FileReviewDiagnosticsSummary {
  const pdfAttachmentIds = new Set(
    attachments.filter((attachment) => isPdfAttachment(attachment)).map((attachment) => attachment.id)
  );
  const imageAttachmentIds = new Set(
    attachments.filter((attachment) => attachment.type.startsWith("image/")).map((attachment) => attachment.id)
  );
  const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const excludedFiles = ledger
    .filter((entry) => entry.exclusionReason)
    .map((entry) => ({
      filename: entry.filename,
      detectedType: String(entry.documentType),
      reason: entry.exclusionReason as ExcludedFromReviewReason,
      indexed: entry.indexedStatus === "indexed",
      stage: entry.exclusionStage ?? "reviewability",
      parsed: entry.textExtractionStatus === "extracted" || entry.pdfExtractionStatus === "available",
      supportOnly: entry.usedAsSupportOnly,
      duplicate: entry.isDuplicate,
      duplicateOf: entry.duplicateOf,
      reviewabilityHint: entry.reviewabilityHint,
    }));

  return {
    totalUploaded: attachments.length,
    pdfCount: pdfAttachmentIds.size,
    imageCount: imageAttachmentIds.size,
    parsedPdfCount: ledger.filter((entry) =>
      pdfAttachmentIds.has(entry.fileId) && entry.textExtractionStatus === "extracted"
    ).length,
    pdfBytesAvailableCount: ledger.filter((entry) =>
      pdfAttachmentIds.has(entry.fileId) && entry.pdfExtractionStatus === "available"
    ).length,
    scannedPdfFallbackCount: ledger.filter((entry) => {
      const attachment = attachmentById.get(entry.fileId);
      return Boolean(
        attachment &&
        pdfAttachmentIds.has(entry.fileId) &&
        entry.textExtractionStatus !== "extracted" &&
        attachment.imageDataUrl
      );
    }).length,
    imageVisionCount: ledger.filter((entry) =>
      imageAttachmentIds.has(entry.fileId) && entry.visionExtractionStatus === "processed"
    ).length,
    indexedCount: ledger.filter((entry) => entry.indexedStatus === "indexed").length,
    reviewedCount: ledger.filter((entry) => entry.reviewedForDetermination).length,
    reviewableCount: ledger.filter((entry) => entry.isReviewable).length,
    determinationEligibleCount: ledger.filter((entry) => entry.isReviewable && !entry.usedAsSupportOnly).length,
    determinationUsedCount: ledger.filter((entry) => entry.usedInDetermination).length,
    supportOnlyCount: ledger.filter((entry) => entry.usedAsSupportOnly).length,
    excludedCount: excludedFiles.length,
    excludedFiles,
  };
}

export function resolveEvidenceCompletenessFromLedger(params: {
  ledger: FileReviewLedgerEntry[];
  evidenceRegistry?: CaseEvidenceRegistryItem[] | null;
  corpus?: string | null;
}): EvidenceCategoryResolution[] {
  const corpus = (params.corpus ?? "").toLowerCase();
  return EVIDENCE_CATEGORY_RULES.map((rule) => {
    const matchedLedger = params.ledger.filter((entry) =>
      entry.evidenceCategoriesDetected.includes(rule.category) && entry.reviewedForDetermination
    );
    const candidateLedger = params.ledger.filter((entry) =>
      entry.evidenceCategoriesDetected.includes(rule.category) && !entry.reviewedForDetermination
    );
    const registryMatches = (params.evidenceRegistry ?? []).filter((item) =>
      rule.registrySourceTypes.includes(item.sourceType) || rule.pattern.test(`${item.label}\n${item.extractedText ?? ""}\n${item.extractedSummary ?? ""}`)
    );
    const referenced = rule.pattern.test(corpus);
    const requiredForThisCase = referenced || matchedLedger.length > 0 || candidateLedger.length > 0 || registryMatches.length > 0;
    const matchedFiles = dedupeStrings([
      ...matchedLedger.map((entry) => entry.filename),
      ...registryMatches.map((item) => item.label),
    ]);
    const candidateFiles = dedupeStrings(candidateLedger.map((entry) => entry.filename));
    const rejectedCandidates = params.ledger
      .filter((entry) => entry.evidenceCategoriesDetected.includes(rule.category) && entry.exclusionReason)
      .map((entry) => ({
        filename: entry.filename,
        reason: entry.exclusionReason ?? "not reviewed",
      }));
    const status = resolveCategoryStatus({
      category: rule.category,
      matchedFiles,
      candidateFiles,
      referenced,
      rejectedCandidates,
    });
    return {
      category: rule.category,
      requiredForThisCase,
      matchedFiles,
      candidateFiles,
      rejectedCandidates,
      matchConfidence: matchedFiles.length ? 0.9 : candidateFiles.length ? 0.55 : referenced ? 0.35 : 0,
      status,
      reason: buildCategoryReason(rule.label, status, matchedFiles, candidateFiles),
    };
  });
}

export function detectEvidenceCategories(value: string, mimeType = ""): EvidenceCompletenessCategory[] {
  const text = value.toLowerCase();
  const categories: EvidenceCompletenessCategory[] = [];
  for (const rule of EVIDENCE_CATEGORY_RULES) {
    if (rule.pattern.test(text)) categories.push(rule.category);
  }
  if (mimeType.startsWith("image/") && !categories.some((category) => /photo$/.test(category))) {
    categories.push("progress_photo");
  }
  return dedupeStrings(categories) as EvidenceCompletenessCategory[];
}

function resolveCategoryStatus(params: {
  category: EvidenceCompletenessCategory;
  matchedFiles: string[];
  candidateFiles: string[];
  referenced: boolean;
  rejectedCandidates: Array<{ filename: string; reason: string }>;
}): EvidenceCompletenessStatus {
  if (params.matchedFiles.length > 0) {
    if (params.category === "final_invoice" && !params.matchedFiles.some((file) => /final|paid|closed/i.test(file))) {
      return "present_but_not_final";
    }
    if (params.category === "calibration_record" || params.category === "alignment_printout") {
      return "present_but_not_line_tied";
    }
    return "present";
  }
  if (params.candidateFiles.length > 0) return "not_reviewed";
  if (params.rejectedCandidates.length > 0) return "excluded";
  if (params.referenced) return "referenced_not_produced";
  return "not_found";
}

function buildCategoryReason(
  label: string,
  status: EvidenceCompletenessStatus,
  matchedFiles: string[],
  candidateFiles: string[]
) {
  if (status === "present") return `${label} located in reviewed files: ${matchedFiles.join(", ")}.`;
  if (status === "present_but_not_line_tied") return `${label} located but not tied to specific estimate lines.`;
  if (status === "present_but_not_final") return `${label} candidate located, but final/paid status was not confirmed.`;
  if (status === "not_reviewed") return `${label} uploaded but not reviewed: ${candidateFiles.join(", ")}.`;
  if (status === "excluded") return `${label} candidate was excluded from review.`;
  if (status === "referenced_not_produced") return `${label} referenced but not produced or not retrieved.`;
  return `${label} not located in reviewed files.`;
}

function classifyLedgerSourceType(
  attachment: StoredAttachment,
  categories: EvidenceCompletenessCategory[]
): CaseEvidenceSourceType {
  const text = `${attachment.filename}\n${attachment.type}\n${attachment.text}`.toLowerCase();
  if (attachment.classification === "ccc_awf") return "ccc_awf";
  if (attachment.classification === "ccc_workfile") return "ccc_workfile";
  if (attachment.classification === "ccc_companion_file") return "ccc_companion_file";
  if (attachment.type.startsWith("image/")) return "photo";
  if (categories.includes("policy_document")) return "policy_document";
  if (categories.includes("final_invoice") || categories.includes("parts_invoice") || categories.includes("material_invoice")) return "invoice";
  if (categories.includes("scan_pre") || categories.includes("scan_post") || categories.includes("scan_in_process") || categories.includes("diagnostic_report")) return "scan_report";
  if (categories.includes("calibration_record") || categories.includes("revvadas_record")) return "calibration_report";
  if (categories.includes("oem_procedure") || categories.includes("position_statement")) return "oem_documentation";
  if (/\b(shop|repair facility|approved repairs?)\b/i.test(text)) return "shop_estimate";
  if (/\b(carrier estimate|insurance estimate|insurer estimate|staff estimate|sor)\b/i.test(text)) return "carrier_estimate";
  if (/\b(supplement|supp|sor)\b/i.test(text)) return "supplement";
  return "other_supporting_document";
}

function getLedgerExclusionReason(
  attachment: StoredAttachment,
  detectedType: CaseEvidenceSourceType,
  duplicateOf: string | null
): ExcludedFromReviewReason | null {
  if (duplicateOf) return "DUPLICATE";
  if (isPdfAttachment(attachment)) return null;
  if (detectedType === "photo") return null;
  if (attachment.classification === "ccc_awf" || attachment.classification === "ccc_workfile") return null;
  if (attachment.classification === "ccc_companion_file") return "INTERNAL_CONTAINER";
  if (attachment.type.startsWith("video/") || attachment.classification === "video") return "UNSUPPORTED_TYPE";
  if (!attachment.text?.trim() && !attachment.imageDataUrl) return "EMPTY_FILE";
  return null;
}

function isSupportOnlyDocumentType(
  documentType: FileReviewLedgerEntry["documentType"],
  categories: EvidenceCompletenessCategory[]
) {
  if (
    documentType === "estimate" ||
    documentType === "carrier_estimate" ||
    documentType === "shop_estimate" ||
    documentType === "supplement" ||
    categories.includes("shop_estimate") ||
    categories.includes("carrier_estimate") ||
    categories.includes("supplement")
  ) {
    return false;
  }
  return documentType === "work_authorization" ||
    documentType === "support_contract" ||
    categories.includes("work_authorization") ||
    categories.includes("physical_inspection_demand");
}

function resolveParserReviewer(attachment: StoredAttachment, isPdf: boolean, isImage: boolean) {
  if (attachment.classification === "ccc_workfile" || attachment.classification === "ccc_awf") return "ccc_workfile_parser";
  if (isPdf) return "server_pdf_text_extraction";
  if (isImage) return "vision_ocr";
  return "metadata_text_parser";
}

function buildReviewabilityHint(reason: ExcludedFromReviewReason | null, supportOnly: boolean) {
  if (!reason && supportOnly) return "Reviewable as support context only; not a primary estimate source.";
  if (!reason) return "Reviewable and included in file determination.";
  if (reason === "DUPLICATE") return "Use the retained duplicate listed in duplicateOf.";
  if (reason === "UNSUPPORTED_TYPE") return "Upload a PDF, supported image, or extracted text version.";
  if (reason === "EMPTY_FILE") return "Upload a readable copy or OCR text.";
  if (reason === "INTERNAL_CONTAINER") return "Use the extracted companion files instead of the internal container.";
  return "Provide a readable, supported, non-duplicate document.";
}

function isPdfAttachment(attachment: Pick<StoredAttachment, "filename" | "type" | "classification">) {
  return attachment.classification === "pdf" || attachment.type === "application/pdf" || /\.pdf$/i.test(attachment.filename);
}

function getExtension(filename: string) {
  const match = filename.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

function dedupeStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

const EVIDENCE_CATEGORY_RULES: Array<{
  category: EvidenceCompletenessCategory;
  label: string;
  pattern: RegExp;
  registrySourceTypes: CaseEvidenceSourceType[];
}> = [
  { category: "shop_estimate", label: "Shop estimate", pattern: /\b(shop|repair facility|body shop|approved repairs?)\b.*\bestimate\b|\bshop\s+\d+\.pdf\b/i, registrySourceTypes: ["shop_estimate"] },
  { category: "carrier_estimate", label: "Carrier estimate", pattern: /\b(carrier|insurer|insurance|sor)\b.*\bestimate\b|\bsor\d*\.pdf\b/i, registrySourceTypes: ["carrier_estimate"] },
  { category: "supplement", label: "Supplement", pattern: /\b(supplement|supp|sor)\b/i, registrySourceTypes: ["supplement"] },
  { category: "final_invoice", label: "Final invoice", pattern: /\b(final invoice|paid invoice|closed repair order|repair invoice|invoice)\b/i, registrySourceTypes: ["invoice"] },
  { category: "parts_invoice", label: "Parts invoice", pattern: /\b(parts? invoice|vendor invoice|parts receipt)\b/i, registrySourceTypes: ["invoice", "sublet_document"] },
  { category: "material_invoice", label: "Material invoice", pattern: /\b(material invoice|paint material|p&m|paint\s*&\s*material|receipt)\b/i, registrySourceTypes: ["invoice", "sublet_document"] },
  { category: "scan_pre", label: "Pre-repair scan", pattern: /\b(pre[-\s]?repair scan|pre scan)\b/i, registrySourceTypes: ["scan_report", "adas_report"] },
  { category: "scan_post", label: "Post-repair scan", pattern: /\b(post[-\s]?repair scan|post scan|final scan)\b/i, registrySourceTypes: ["scan_report", "adas_report"] },
  { category: "scan_in_process", label: "In-process scan", pattern: /\b(in[-\s]?process scan|interim scan)\b/i, registrySourceTypes: ["scan_report", "adas_report"] },
  { category: "diagnostic_report", label: "Diagnostic report", pattern: /\b(scan|dtc|diagnostic|witech|tesla toolbox|module report)\b/i, registrySourceTypes: ["scan_report", "adas_report"] },
  { category: "calibration_record", label: "Calibration record", pattern: /\b(calibration|calibrate|adas|radar|camera|aiming|target|initialization|programming|seat belt function)\b/i, registrySourceTypes: ["calibration_report", "adas_report"] },
  { category: "revvadas_record", label: "REVVADAS record", pattern: /\b(revvadas|revv adas|revv)\b/i, registrySourceTypes: ["adas_report", "calibration_report"] },
  { category: "alignment_printout", label: "Alignment printout", pattern: /\b(alignment|align|toe|camber|caster|thrust angle|hunter)\b/i, registrySourceTypes: ["sublet_document"] },
  { category: "teardown_photo", label: "Teardown photo", pattern: /\b(teardown|disassembly|damage photo|hidden damage)\b/i, registrySourceTypes: ["photo"] },
  { category: "progress_photo", label: "Progress photo", pattern: /\b(progress photo|repair photo|during repair|mounting|bracket|wheelhouse)\b/i, registrySourceTypes: ["photo"] },
  { category: "completion_photo", label: "Completion photo", pattern: /\b(completion photo|after photo|final photo|completed repair)\b/i, registrySourceTypes: ["photo"] },
  { category: "oem_procedure", label: "OEM procedure", pattern: /\b(oem procedure|repair procedure|service manual|repair manual|mopar|stellantis|fca|chrysler|repairconnect|oe docs|procedure research|procedure documentation)\b/i, registrySourceTypes: ["oem_documentation", "procedure_link"] },
  { category: "position_statement", label: "Position statement", pattern: /\b(position statement|oem position)\b/i, registrySourceTypes: ["oem_documentation", "procedure_link"] },
  { category: "work_authorization", label: "Work authorization", pattern: /\b(work auth|work authorization|authorization|contract of repair|customer acknowledges repairer has posted labor rates)\b/i, registrySourceTypes: ["other_supporting_document"] },
  { category: "physical_inspection_demand", label: "Physical inspection demand", pattern: /\b(physical inspection demand|assignment of proceeds|defense and indemnification)\b/i, registrySourceTypes: ["other_supporting_document"] },
  { category: "carrier_correspondence", label: "Carrier correspondence", pattern: /\b(carrier correspondence|adjuster email|insurer letter|claim communication)\b/i, registrySourceTypes: ["other_supporting_document"] },
  { category: "policy_document", label: "Policy document", pattern: /\b(policy|declarations?|endorsement|coverage|appraisal clause|duties after loss)\b/i, registrySourceTypes: ["policy_document"] },
  { category: "payment_ledger", label: "Payment ledger", pattern: /\b(payment ledger|payment history|claim payment|check issued|paid amount)\b/i, registrySourceTypes: ["invoice", "other_supporting_document"] },
];
