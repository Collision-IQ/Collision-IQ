import type { StoredAttachment } from "@/lib/uploadedAttachmentStore";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";
import type { CitationDensityTargetEstimate } from "@/lib/reports/citationDensityIntent";

export const NO_SOURCE_PDF_ERROR = "No original estimate PDF was found for annotation.";
export const NO_SOURCE_PDF_USER_MESSAGE =
  "No original estimate PDF was found for annotation. Please select or upload the estimate PDF you want annotated.";

export function isPdfDocument(type: string, filename: string) {
  return type === "application/pdf" || /\.pdf$/i.test(filename);
}

export function resolveSourceEstimatePdf(params: {
  attachments: StoredAttachment[];
  report: RepairIntelligenceReport;
  targetEstimate: CitationDensityTargetEstimate;
  findings: CitationDensityFinding[];
}) {
  const pdfs = params.attachments.filter((attachment) =>
    isPdfDocument(attachment.type, attachment.filename) && Boolean(attachment.imageDataUrl)
  );
  if (pdfs.length === 0) return null;
  if (pdfs.length === 1) return pdfs[0];

  const evidenceTypeByLabel = new Map<string, string>();
  for (const item of params.report.evidenceRegistry ?? []) {
    const label = normalizeRoleText(item.label);
    if (label) evidenceTypeByLabel.set(label, item.sourceType);
  }

  const scored = pdfs
    .map((attachment, index) => ({
      attachment,
      index,
      score: scoreEstimatePdfCandidate({
        attachment,
        targetEstimate: params.targetEstimate,
        findings: params.findings,
        evidenceTypeByLabel,
      }),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return scored[0]?.attachment ?? null;
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
  if (/carrier|insurer|insurance|appraiser|adjuster/.test(text)) score += params.targetEstimate === "shop" ? -10 : 45;
  if (/shop|repair facility|body shop|repairer/.test(text)) score += params.targetEstimate === "shop" ? 45 : -8;
  if (/lower cost|lower cost|carrier estimate|insurer estimate/.test(text)) score += params.targetEstimate === "shop" ? -12 : 35;
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
