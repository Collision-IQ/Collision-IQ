import type { StoredAttachment } from "@/lib/uploadedAttachmentStore";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";
import type { CitationDensityTargetEstimate } from "@/lib/reports/citationDensityIntent";

export const NO_SOURCE_PDF_ERROR = "No original estimate PDF was found for annotation.";
export const NO_SOURCE_PDF_USER_MESSAGE =
  "No original estimate PDF was found for annotation. Please select or upload the estimate PDF you want annotated.";

export type SourceEstimatePdfSelection = {
  attachment: StoredAttachment;
  selectedSourceDocumentId: string;
  selectedSourceLabel: string;
  selectedEstimateRole: "carrier" | "shop" | "uploaded" | "selected" | "unknown";
  selectedEstimateTotal: number | null;
  targetEstimate: CitationDensityTargetEstimate;
  selectionReason: string;
};

export function isPdfDocument(type: string, filename: string) {
  return type === "application/pdf" || /\.pdf$/i.test(filename);
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
  const pdfs = params.attachments.filter((attachment) =>
    isPdfDocument(attachment.type, attachment.filename) && Boolean(attachment.imageDataUrl)
  );
  if (pdfs.length === 0) return null;
  if (pdfs.length === 1) {
    return buildSelectionResult({
      attachment: pdfs[0],
      targetEstimate: params.targetEstimate,
      selectedEstimateRole: "uploaded",
      selectionReason: "Only one uploaded estimate PDF was available.",
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
  });
}

export function scoreEstimatePdfCandidate(params: {
  attachment: StoredAttachment;
  targetEstimate: CitationDensityTargetEstimate;
  findings: CitationDensityFinding[];
  evidenceTypeByLabel: Map<string, string>;
}) {
  const text = normalizeRoleText(`${params.attachment.filename}\n${params.attachment.text}`);
  let score = 0;

  if (/\bestimate\b|supplement|preliminary estimate|repair estimate/.test(text)) score += 30;
  if (/citation density|gap report|annotation legend|unanchored citation density/.test(text)) score -= 120;
  if (/carrier|insurer|insurance|appraiser|adjuster/.test(text)) score += params.targetEstimate === "shop" ? -18 : 45;
  if (/shop|repair facility|body shop|repairer/.test(text)) score += params.targetEstimate === "shop" ? 45 : -28;
  if (/lower cost|lower cost|carrier estimate|insurer estimate/.test(text)) score += params.targetEstimate === "shop" ? -12 : 35;
  if (/rta|right to apprais|appraisal|appraiser report|collision academy|academy report|higher cost preliminary/.test(text)) {
    score += params.targetEstimate === "carrier" ? -45 : -10;
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
  selectionReason: string;
}): SourceEstimatePdfSelection {
  return {
    attachment: params.attachment,
    selectedSourceDocumentId: params.attachment.id,
    selectedSourceLabel: params.attachment.filename || "Uploaded estimate",
    selectedEstimateRole: params.selectedEstimateRole,
    selectedEstimateTotal: params.selectedEstimateTotal ?? extractEstimateTotal(params.attachment),
    targetEstimate: params.targetEstimate,
    selectionReason: params.selectionReason,
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
  if (/shop estimate|repair facility|body shop|repairer|higher cost/.test(text)) return "shop";
  return "unknown";
}

function extractEstimateTotal(attachment: StoredAttachment): number | null {
  const text = `${attachment.filename}\n${attachment.text ?? ""}`;
  const matches = [...text.matchAll(/(?:estimate|net|grand|repair)?\s*total\s*[:#-]?\s*\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2})?|[0-9]+(?:\.\d{2})?)/gi)];
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
  if (targetEstimate === "selected") return score > -80;
  if (targetEstimate === "carrier") return role === "carrier" && score > 0;
  if (targetEstimate === "shop") return role === "shop" && score > 0;
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
  if (role === "selected") return "Selected the active review estimate PDF.";
  return `Selected the best matching uploaded estimate PDF based on document role signals (score ${score}).`;
}

export function describeReviewTarget(
  attachment: StoredAttachment,
  targetEstimate: CitationDensityTargetEstimate,
  candidates: StoredAttachment[]
) {
  if (candidates.filter((candidate) => isPdfDocument(candidate.type, candidate.filename)).length === 1) {
    return "Uploaded estimate";
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
