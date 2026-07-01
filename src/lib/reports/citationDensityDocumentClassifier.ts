import type { StoredAttachment } from "@/lib/uploadedAttachmentStore";

export type CitationDensityDocumentType =
  | "estimate"
  | "work_authorization"
  | "support_contract"
  | "invoice"
  | "photo_or_scan"
  | "legal_support"
  | "generated_report"
  | "unknown";

export type CitationDensityDocumentClassification = {
  detectedDocumentType: CitationDensityDocumentType;
  confidence: number;
  estimateScore: number;
  supportScore: number;
  evidenceSignals: string[];
  rejectionReasons: string[];
  isEstimateLike: boolean;
};

const ESTIMATE_SIGNAL_PATTERNS: Array<[RegExp, string, number]> = [
  [/\b(?:carrier|insurer|shop|repair facility)\s+estimate\b/i, "role-labeled estimate", 36],
  [/\bestimate\b/i, "estimate keyword", 24],
  [/\bsupplement\b/i, "supplement keyword", 24],
  [/\b(?:ccc|mitchell|audatex)\b/i, "estimating platform keyword", 22],
  [/\bpreliminary estimate\b/i, "Preliminary Estimate", 32],
  [/\bestimate of record\b/i, "Estimate of Record", 38],
  [/\bsupplement of record\b/i, "Supplement of Record", 38],
  [/\bsupplement summary\b/i, "Supplement Summary", 30],
  [/\bline\s+oper\s+description\s+part\s+number\s+qty\s+extended\s+price\s+labor\s+paint\b/i, "CCC line-item header", 46],
  [/\bestimate totals?\b/i, "ESTIMATE TOTALS", 28],
  [/\bgrand total\b/i, "Grand Total", 26],
  [/\btotal cost of repairs\b/i, "Total Cost of Repairs", 28],
  [/\bnet cost of repairs\b/i, "Net Cost of Repairs", 28],
  [/\brepair facility\b/i, "Repair Facility", 20],
  [/\bwritten by\b/i, "Written By", 18],
  [/\bworkfile id\b/i, "Workfile ID", 24],
  [/\bccc one estimating\b/i, "CCC ONE Estimating", 34],
  [/\b(?:repl|r&i|rpr|subl|refn|add|o\/h)\b.{0,80}(?:\$?\d[\d,.]*|\d+(?:\.\d+)?\s*(?:hrs?|@))/i, "estimate operation row", 34],
];

const SUPPORT_SIGNAL_PATTERNS: Array<[RegExp, string, number, CitationDensityDocumentType]> = [
  [/\bcontract of repair\b/i, "CONTRACT OF REPAIR", 55, "support_contract"],
  [/\bwork authorization\b/i, "Work Authorization", 55, "work_authorization"],
  [/\bcustomer acknowledges repairer has posted labor rates\b/i, "posted labor rates acknowledgement", 60, "work_authorization"],
  [/\bpayment\b/i, "Payment", 10, "support_contract"],
  [/\bwarranty\b/i, "Warranty", 16, "support_contract"],
  [/\bpersonal items\b/i, "Personal Items", 16, "support_contract"],
  [/\bassignment of proceeds\b/i, "Assignment of Proceeds", 45, "legal_support"],
  [/\bdefense and indemnification\b/i, "Defense and Indemnification", 42, "legal_support"],
  [/\bphysical inspection demand\b/i, "Physical inspection demand", 46, "legal_support"],
  [/\bpa motor vehicle physical damage appraiser act\b/i, "PA Motor Vehicle Physical Damage Appraiser Act", 50, "legal_support"],
  [/\bcustomer signature\b/i, "Customer Signature", 30, "support_contract"],
  [/\bvehicle owner\b.{0,60}\bdate\b/i, "vehicle owner/date signature block", 26, "support_contract"],
  [/\b(?:work auth|authorization|auth|contract)\b/i, "support filename", 36, "work_authorization"],
  [/\binvoice\b/i, "invoice", 34, "invoice"],
  [/\b(?:invoice\s*(?:#|no|number)|bill\s+to|remit\s+to|amount\s+due|astech|material\s+invoice|parts?\s+invoice|sublet\s+invoice)\b/i, "invoice document markers", 46, "invoice"],
  [/\b(?:adas\s+report|calibration\s+report|revvadas|pre-?scan\s+report|post-?scan\s+report|diagnostic\s+report|scan\s+result)\b/i, "ADAS/scan report", 46, "photo_or_scan"],
  [/\b(?:photo|image|scan report|scan invoice|alignment printout)\b/i, "photo/scan/alignment document", 34, "photo_or_scan"],
  [/\b(?:citation density|gap report|annotation legend|repair intelligence report|policy rights review|doi complaint|collision snapshot|customer report)\b/i, "generated report", 80, "generated_report"],
];

export function classifyCitationDensityDocument(input: {
  filename?: string | null;
  text?: string | null;
}): CitationDensityDocumentClassification {
  const filename = input.filename ?? "";
  const text = normalizeDocumentText(`${filename}\n${input.text ?? ""}`);
  let estimateScore = 0;
  let supportScore = 0;
  const evidenceSignals: string[] = [];
  const rejectionReasons: string[] = [];
  const supportTypeWeights = new Map<CitationDensityDocumentType, number>();

  for (const [pattern, signal, weight] of ESTIMATE_SIGNAL_PATTERNS) {
    if (!pattern.test(text)) continue;
    estimateScore += weight;
    evidenceSignals.push(signal);
  }

  for (const [pattern, signal, weight, type] of SUPPORT_SIGNAL_PATTERNS) {
    if (!pattern.test(text)) continue;
    supportScore += weight;
    supportTypeWeights.set(type, (supportTypeWeights.get(type) ?? 0) + weight);
    rejectionReasons.push(signal);
  }

  let detectedDocumentType: CitationDensityDocumentType = "unknown";
  if (supportTypeWeights.size > 0 && supportScore >= Math.max(30, estimateScore + 8)) {
    detectedDocumentType = [...supportTypeWeights.entries()].sort((a, b) => b[1] - a[1])[0][0];
  } else if (estimateScore >= 24 && estimateScore >= supportScore) {
    detectedDocumentType = "estimate";
  } else if (supportTypeWeights.size > 0) {
    detectedDocumentType = [...supportTypeWeights.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  const isEstimateLike = detectedDocumentType === "estimate";
  return {
    detectedDocumentType,
    confidence: Math.min(0.99, Math.max(0.1, Math.abs(estimateScore - supportScore) / 100 + (isEstimateLike ? 0.55 : 0.45))),
    estimateScore,
    supportScore,
    evidenceSignals,
    rejectionReasons,
    isEstimateLike,
  };
}

export function classifyCitationDensityAttachment(attachment: Pick<StoredAttachment, "filename" | "text">) {
  return classifyCitationDensityDocument({
    filename: attachment.filename,
    text: attachment.text,
  });
}

export function isBadCitationDensityAnchorText(value: string | null | undefined) {
  const text = normalizeDocumentText(value ?? "");
  return /\b(?:contract of repair|customer acknowledges repairer has posted labor rates|payment|warranty|assignment of proceeds|physical inspection demand|customer signature|pa motor vehicle physical damage appraiser act|defense and indemnification)\b/.test(text);
}

export function classifyCitationDensityAnchorRow(value: string | null | undefined):
  | "support_contract"
  | "legal_notice"
  | "insurer_boilerplate"
  | "vehicle_identity_header_footer"
  | "generic_section_text"
  | "estimate_row" {
  const text = normalizeDocumentText(value ?? "");
  if (/\b(?:contract of repair|work authorization|customer acknowledges repairer has posted labor rates|payment|warranty|customer signature)\b/.test(text)) {
    return "support_contract";
  }
  if (/\b(?:assignment of proceeds|physical inspection demand|pa motor vehicle physical damage appraiser act|defense and indemnification)\b/.test(text)) {
    return "legal_notice";
  }
  if (/\b(?:disclaimer|not an authorization|terms and conditions|insurer reserves|subject to review)\b/.test(text)) {
    return "insurer_boilerplate";
  }
  if (/^(?:claim|vehicle|owner|vin|license|estimate|page)\b/.test(text) && !/\$?\d[\d,.]*|\b(?:repl|r&i|rpr|subl|refn|add|o\/h)\b/.test(text)) {
    return "vehicle_identity_header_footer";
  }
  if (!/\$?\d[\d,.]*|\b(?:repl|r&i|rpr|subl|refn|add|o\/h)\b/.test(text)) {
    return "generic_section_text";
  }
  return "estimate_row";
}

function normalizeDocumentText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.$/@&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
