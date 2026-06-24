import type { StoredAttachment } from "@/lib/uploadedAttachmentStore";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";
import type { CitationDensityTargetEstimate } from "@/lib/reports/citationDensityIntent";
import {
  classifyCitationDensityAttachment,
  type CitationDensityDocumentClassification,
} from "./citationDensityDocumentClassifier";

export const NO_SOURCE_PDF_ERROR = "No estimate PDFs were found for Citation Density.";
export const NO_SOURCE_PDF_USER_MESSAGE =
  "No estimate PDFs were found for Citation Density.";

export type SourcePdfCandidateDiagnostics = {
  acceptedEstimateCandidates: Array<{
    filename: string;
    detectedDocumentType: string;
    estimateScore: number;
    evidenceSignals: string[];
  }>;
  rejectedSourceCandidates: Array<{
    filename: string;
    detectedDocumentType: string;
    reason: string;
  }>;
};

export type SourceEstimatePdfSelection = {
  attachment: StoredAttachment;
  selectedSourceDocumentId: string;
  selectedSourceLabel: string;
  selectedEstimateRole: "carrier" | "shop" | "uploaded" | "selected" | "unknown";
  selectedEstimateTotal: number | null;
  comparisonEstimateTotal?: number | null;
  targetEstimate: CitationDensityTargetEstimate;
  selectionReason: string;
  selectedDocumentType: CitationDensityDocumentClassification["detectedDocumentType"];
  selectedDocumentConfidence: number;
  selectionDiagnostics: SourcePdfCandidateDiagnostics;
};

export function isPdfDocument(type: string, filename: string) {
  return type === "application/pdf" || /\.pdf$/i.test(filename);
}

export function isAnnotatableEstimatePdf(attachment: StoredAttachment) {
  if (!isPdfDocument(attachment.type, attachment.filename) || !attachment.imageDataUrl) return false;
  return classifyCitationDensityAttachment(attachment).isEstimateLike;
}

export function buildCitationDensitySourcePdfDiagnostics(
  attachments: StoredAttachment[]
): SourcePdfCandidateDiagnostics {
  const acceptedEstimateCandidates: SourcePdfCandidateDiagnostics["acceptedEstimateCandidates"] = [];
  const rejectedSourceCandidates: SourcePdfCandidateDiagnostics["rejectedSourceCandidates"] = [];

  for (const attachment of attachments) {
    if (!isPdfDocument(attachment.type, attachment.filename)) continue;
    const classification = classifyCitationDensityAttachment(attachment);
    if (!attachment.imageDataUrl) {
      rejectedSourceCandidates.push({
        filename: attachment.filename,
        detectedDocumentType: classification.detectedDocumentType,
        reason: "PDF has no source bytes available for annotation.",
      });
      continue;
    }
    if (classification.isEstimateLike) {
      acceptedEstimateCandidates.push({
        filename: attachment.filename,
        detectedDocumentType: classification.detectedDocumentType,
        estimateScore: classification.estimateScore,
        evidenceSignals: classification.evidenceSignals,
      });
      continue;
    }
    rejectedSourceCandidates.push({
      filename: attachment.filename,
      detectedDocumentType: classification.detectedDocumentType,
      reason: classification.rejectionReasons.join("; ") || "Document is not estimate-like.",
    });
  }

  return { acceptedEstimateCandidates, rejectedSourceCandidates };
}

export function resolveSourceEstimatePdf(params: {
  attachments: StoredAttachment[];
  report: RepairIntelligenceReport;
  targetEstimate: CitationDensityTargetEstimate;
  findings: CitationDensityFinding[];
}) {
  return resolveSourceEstimatePdfSelection(params)?.attachment ?? null;
}

export function resolveSourceEstimatePdfSelection(params: {
  attachments: StoredAttachment[];
  report: RepairIntelligenceReport;
  targetEstimate: CitationDensityTargetEstimate;
  findings: CitationDensityFinding[];
}): SourceEstimatePdfSelection | null {
  if (params.targetEstimate === "both" || params.targetEstimate === "auto") {
    return resolveSourceEstimatePdfSelections(params)[0] ?? null;
  }

  const pdfs = params.attachments.filter(isAnnotatableEstimatePdf);
  const selectionDiagnostics = buildCitationDensitySourcePdfDiagnostics(params.attachments);
  if (pdfs.length === 0) return null;
  if (pdfs.length === 1) {
    return buildSelectionResult({
      attachment: pdfs[0],
      targetEstimate: params.targetEstimate,
      selectedEstimateRole: "uploaded",
      selectionReason: "Only one uploaded estimate PDF was available.",
      selectionDiagnostics,
    });
  }

  const evidenceTypeByLabel = new Map<string, string>();
  for (const item of params.report.evidenceRegistry ?? []) {
    const label = normalizeRoleText(item.label);
    if (label) evidenceTypeByLabel.set(label, item.sourceType);
  }

  const scored = pdfs
    .map((attachment, index) => {
      const score = scoreEstimatePdfCandidate({
        attachment,
        targetEstimate: params.targetEstimate,
        findings: params.findings,
        evidenceTypeByLabel,
      });
      return {
        attachment,
        index,
        score,
        role: inferEstimateRole(attachment, evidenceTypeByLabel),
        total: extractEstimateTotal(attachment),
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const best = scored[0];
  if (!best) return null;
  if (!isCompatibleSelection(best.role, params.targetEstimate, best.score)) {
    return null;
  }

  return buildSelectionResult({
    attachment: best.attachment,
    targetEstimate: params.targetEstimate,
    selectedEstimateRole: best.role === "unknown" && params.targetEstimate === "selected" ? "selected" : best.role,
    selectedEstimateTotal: best.total,
    selectionReason: buildSelectionReason(best.role, params.targetEstimate, best.score),
    selectionDiagnostics,
  });
}

export function resolveSourceEstimatePdfSelections(params: {
  attachments: StoredAttachment[];
  report: RepairIntelligenceReport;
  targetEstimate: CitationDensityTargetEstimate;
  findings: CitationDensityFinding[];
}): SourceEstimatePdfSelection[] {
  const pdfs = params.attachments.filter(isAnnotatableEstimatePdf);
  const selectionDiagnostics = buildCitationDensitySourcePdfDiagnostics(params.attachments);
  if (pdfs.length === 0) return [];
  if (pdfs.length === 1) {
    const only = buildSelectionResult({
      attachment: pdfs[0],
      targetEstimate: params.targetEstimate,
      selectedEstimateRole: "uploaded",
      selectionReason: "Only one uploaded estimate PDF was available.",
      selectionDiagnostics,
    });
    return [only];
  }

  if (params.targetEstimate === "both") {
    return [
      resolveSourceEstimatePdfSelection({ ...params, targetEstimate: "carrier" }),
      resolveSourceEstimatePdfSelection({ ...params, targetEstimate: "shop" }),
    ].filter((selection): selection is SourceEstimatePdfSelection => Boolean(selection));
  }

  if (params.targetEstimate === "auto") {
    const lowerEstimateSelection = resolveLowerEstimatePdfSelection(params);
    if (lowerEstimateSelection) return [lowerEstimateSelection];

    const roleCounts = params.findings.reduce(
      (counts, finding) => {
        const roles = finding.applicableEstimateRoles?.length
          ? finding.applicableEstimateRoles
          : inferFindingRoles(finding);
        roles.forEach((role) => {
          counts[role] += 1;
        });
        return counts;
      },
      { carrier: 0, shop: 0 }
    );
    const targetEstimate: CitationDensityTargetEstimate = roleCounts.shop > roleCounts.carrier ? "shop" : "carrier";
    const selection = resolveSourceEstimatePdfSelection({ ...params, targetEstimate });
    if (selection) {
      return [{
        ...selection,
        targetEstimate: "auto",
        selectionReason: `Auto-selected ${selection.selectedEstimateRole} estimate because most findings apply there.`,
      }];
    }
  }

  const selection = resolveSourceEstimatePdfSelection(params);
  return selection ? [selection] : [];
}

function resolveLowerEstimatePdfSelection(params: {
  attachments: StoredAttachment[];
  report: RepairIntelligenceReport;
  targetEstimate: CitationDensityTargetEstimate;
  findings: CitationDensityFinding[];
}): SourceEstimatePdfSelection | null {
  const pdfs = params.attachments.filter(isAnnotatableEstimatePdf);
  const selectionDiagnostics = buildCitationDensitySourcePdfDiagnostics(params.attachments);
  if (pdfs.length < 2) return null;

  const evidenceTypeByLabel = new Map<string, string>();
  for (const item of params.report.evidenceRegistry ?? []) {
    const label = normalizeRoleText(item.label);
    if (label) evidenceTypeByLabel.set(label, item.sourceType);
  }

  const candidates = pdfs
    .map((attachment, index) => ({
      attachment,
      index,
      role: inferEstimateRole(attachment, evidenceTypeByLabel),
      total: extractEstimateTotal(attachment),
    }))
    .filter((candidate): candidate is {
      attachment: StoredAttachment;
      index: number;
      role: SourceEstimatePdfSelection["selectedEstimateRole"];
      total: number;
    } => typeof candidate.total === "number" && Number.isFinite(candidate.total))
    .sort((a, b) => a.total - b.total || a.index - b.index);

  const lowest = candidates[0];
  if (!lowest) return null;
  const comparison = candidates.find((candidate) => candidate.attachment.id !== lowest.attachment.id);

  return buildSelectionResult({
    attachment: lowest.attachment,
    targetEstimate: "auto",
    selectedEstimateRole: lowest.role === "unknown" ? "selected" : lowest.role,
    selectedEstimateTotal: lowest.total,
    comparisonEstimateTotal: comparison?.total ?? null,
    selectionReason: `Auto-selected the lower estimate PDF as the Citation Density annotation base (total ${lowest.total}).`,
    selectionDiagnostics,
  });
}

export function scoreEstimatePdfCandidate(params: {
  attachment: StoredAttachment;
  targetEstimate: CitationDensityTargetEstimate;
  findings: CitationDensityFinding[];
  evidenceTypeByLabel: Map<string, string>;
}) {
  const text = normalizeRoleText(`${params.attachment.filename}\n${params.attachment.text}`);
  const classification = classifyCitationDensityAttachment(params.attachment);
  if (!classification.isEstimateLike) return -500;
  let score = 0;
  score += classification.estimateScore;
  score -= classification.supportScore * 2;

  if (/\bestimate\b|supplement|preliminary estimate|repair estimate/.test(text)) score += 30;
  if (/citation density|gap report|annotation legend|unanchored citation density/.test(text)) score -= 120;
  if (/carrier|insurer|insurance|appraiser|adjuster/.test(text)) score += params.targetEstimate === "shop" ? -18 : 45;
  if (/shop|repair facility|body shop|repairer|rta|right to apprais|appraisal|appraiser report/.test(text)) {
    score += params.targetEstimate === "shop" ? 45 : -28;
  }
  if (/lower cost|lower cost|carrier estimate|insurer estimate/.test(text)) score += params.targetEstimate === "shop" ? -12 : 35;
  if (/rta|right to apprais|appraisal|appraiser report|collision academy|academy report|higher cost preliminary/.test(text)) {
    score += params.targetEstimate === "carrier" ? -45 : 10;
  }
  if (/customer|invoice|repair order|policy|declarations|photo|image|scan report/.test(text)) score -= 14;

  const matchingEvidenceType = [...params.evidenceTypeByLabel.entries()]
    .find(([label]) => label && text.includes(label))?.[1];
  if (matchingEvidenceType === "carrier_estimate") score += params.targetEstimate === "shop" ? -10 : 55;
  if (matchingEvidenceType === "shop_estimate") score += params.targetEstimate === "shop" ? 55 : -10;
  if (matchingEvidenceType === "supplement") score += 10;

  const roleEvidence = params.targetEstimate === "shop"
    ? params.findings.map((finding) => finding.shopEvidence)
    : params.findings.map((finding) => finding.carrierEvidence);
  for (const evidence of roleEvidence) {
    if (!evidence) continue;
    if (evidence.sourceLabel && text.includes(normalizeRoleText(evidence.sourceLabel))) score += 20;
    const description = normalizeRoleText(evidence.description);
    if (description && text.includes(description.slice(0, 60))) score += 10;
  }

  return score;
}

function buildSelectionResult(params: {
  attachment: StoredAttachment;
  targetEstimate: CitationDensityTargetEstimate;
  selectedEstimateRole: SourceEstimatePdfSelection["selectedEstimateRole"];
  selectedEstimateTotal?: number | null;
  comparisonEstimateTotal?: number | null;
  selectionReason: string;
  selectionDiagnostics?: SourcePdfCandidateDiagnostics;
}): SourceEstimatePdfSelection {
  const classification = classifyCitationDensityAttachment(params.attachment);
  return {
    attachment: params.attachment,
    selectedSourceDocumentId: params.attachment.id,
    selectedSourceLabel: params.attachment.filename || "Uploaded estimate",
    selectedEstimateRole: params.selectedEstimateRole,
    selectedEstimateTotal: params.selectedEstimateTotal ?? extractEstimateTotal(params.attachment),
    comparisonEstimateTotal: params.comparisonEstimateTotal,
    targetEstimate: params.targetEstimate,
    selectionReason: params.selectionReason,
    selectedDocumentType: classification.detectedDocumentType,
    selectedDocumentConfidence: classification.confidence,
    selectionDiagnostics: params.selectionDiagnostics ?? buildCitationDensitySourcePdfDiagnostics([params.attachment]),
  };
}

function inferEstimateRole(
  attachment: StoredAttachment,
  evidenceTypeByLabel: Map<string, string>
): SourceEstimatePdfSelection["selectedEstimateRole"] {
  const text = normalizeRoleText(`${attachment.filename}\n${attachment.text}`);
  const matchingEvidenceType = [...evidenceTypeByLabel.entries()]
    .find(([label]) => label && text.includes(label))?.[1];
  if (matchingEvidenceType === "carrier_estimate") return "carrier";
  if (matchingEvidenceType === "shop_estimate") return "shop";
  if (/carrier estimate|insurer estimate|carrier|insurer|insurance|lower cost/.test(text)) return "carrier";
  if (/shop estimate|repair facility|body shop|repairer|higher cost|rta|right to apprais|appraisal|appraiser report/.test(text)) return "shop";
  return "unknown";
}

function extractEstimateTotal(attachment: StoredAttachment): number | null {
  const text = `${attachment.filename}\n${attachment.text ?? ""}`;
  const matches = [...text.matchAll(/(?:(?:estimate|repair|grand)\s+total|total|gross|net)\s*[:#=/-]?\s*\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2})?|[0-9]+(?:\.\d{2})?)/gi)];
  const raw = matches.at(-1)?.[1];
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function isCompatibleSelection(
  role: SourceEstimatePdfSelection["selectedEstimateRole"],
  targetEstimate: CitationDensityTargetEstimate,
  score: number
) {
  if (targetEstimate === "selected" || targetEstimate === "auto") return score > -80;
  if (targetEstimate === "carrier") return role === "carrier" && score > 0;
  if (targetEstimate === "shop") return role === "shop" && score > 0;
  if (targetEstimate === "both") return (role === "carrier" || role === "shop") && score > 0;
  return false;
}

function buildSelectionReason(
  role: SourceEstimatePdfSelection["selectedEstimateRole"],
  targetEstimate: CitationDensityTargetEstimate,
  score: number
) {
  if (targetEstimate === "carrier") {
    return `Selected the carrier/lower-cost estimate PDF based on document role signals (score ${score}).`;
  }
  if (targetEstimate === "shop") {
    return `Selected the shop estimate PDF based on document role signals (score ${score}).`;
  }
  if (targetEstimate === "both") return `Selected ${role} estimate PDF for a both-estimates annotation request.`;
  if (targetEstimate === "auto") return `Auto-selected ${role} estimate PDF based on finding assignment and document role signals.`;
  if (role === "selected") return "Selected the active review estimate PDF.";
  return `Selected the best matching uploaded estimate PDF based on document role signals (score ${score}).`;
}

function inferFindingRoles(finding: CitationDensityFinding): Array<"carrier" | "shop"> {
  if (finding.primaryAnnotationRole === "both") return ["carrier", "shop"];
  if (finding.primaryAnnotationRole === "carrier" || finding.primaryAnnotationRole === "shop") {
    return [finding.primaryAnnotationRole];
  }
  if (finding.estimateGapType === "reduced_by_carrier") return ["carrier", "shop"];
  if (finding.estimateGapType === "missing_from_carrier") return finding.shopEvidence ? ["shop", "carrier"] : ["carrier"];
  if (finding.shopEvidence && !finding.carrierEvidence) return ["shop"];
  if (finding.carrierEvidence && !finding.shopEvidence) return ["carrier"];
  if (finding.shopEvidence && finding.carrierEvidence) return ["carrier", "shop"];
  return ["carrier"];
}

// True only when an uploaded estimate is genuinely carrier/insurer/adjuster-authored.
// A shop estimate that merely prints an "Insurance Company: USAA" field is NOT carrier
// authored — that is a header field, not authorship. Without this distinction a shop-to-shop
// comparison gets mislabeled "carrier estimate" / inverted roles (DEFECT A).
export function hasCarrierAuthoredEstimate(candidates: StoredAttachment[]): boolean {
  return candidates.some((candidate) => isCarrierAuthoredEstimate(candidate));
}

function isCarrierAuthoredEstimate(candidate: StoredAttachment): boolean {
  const filename = (candidate.filename ?? "").toLowerCase();
  if (/\b(?:carrier|insurer|adjuster|appraiser|sor\d*)\b/.test(filename)) return true;
  if (/\b(?:state farm|geico|progressive|allstate|usaa|nationwide|liberty mutual|farmers|travelers)\b[^\n]{0,20}\bestimate\b/i.test(filename)) {
    return true;
  }
  const text = candidate.text ?? "";
  // Explicit carrier/SOR authorship in the body. Deliberately NOT matched: a plain
  // "Insurance Company: <name>" field or a shop "prepared by <estimator>" line — both appear
  // on shop estimates, so matching them would re-introduce the shop-as-carrier mislabel.
  if (
    /\b(?:carrier estimate|insurer estimate|sor\s*\d*\s*estimate|estimate of record\b[^\n]{0,40}\bcarrier)\b/i.test(text) ||
    /\bprepared by\b[^\n]{0,40}\b(?:adjuster|appraiser|claims?\s+(?:rep|representative|adjuster|department))\b/i.test(text)
  ) {
    return true;
  }
  return false;
}

export function describeReviewTarget(
  attachment: StoredAttachment,
  targetEstimate: CitationDensityTargetEstimate,
  candidates: StoredAttachment[]
) {
  if (candidates.filter((candidate) => isPdfDocument(candidate.type, candidate.filename)).length === 1) {
    return "Uploaded estimate";
  }
  // When no uploaded estimate is carrier-authored, this is a shop-to-shop (or version-to-
  // version) comparison. Use neutral source wording, never "carrier estimate".
  if (!hasCarrierAuthoredEstimate(candidates)) {
    return "Source/lower estimate";
  }
  if (targetEstimate === "carrier") return "Carrier estimate";
  if (targetEstimate === "shop") return "Shop estimate";
  return attachment.filename || "Selected estimate";
}

function normalizeRoleText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9.$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
