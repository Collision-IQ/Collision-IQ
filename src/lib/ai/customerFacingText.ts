import type { CustomerReport } from "./generateCustomerReport";
import type { CarrierReportDocument } from "./builders/carrierPdfBuilder";
import { sanitizeEstimateLine, sanitizeUserFacingEvidenceText } from "@/lib/ui/presentationText";
import { normalizeNarrativeProse } from "@/lib/ai/narrativeNormalization";

const TECHNICAL_TRANSLATIONS: Array<[RegExp, string]> = [
  [
    /\bHidden\s+Mounting\s+Geometry\s*\/?\s*Teardown\s+Growth\b/gi,
    "Hidden mounting or structural damage is not verified from the reviewed file",
  ],
  [
    /\bADAS\s+Calibration\s+Procedure\s+Support\b/gi,
    "Scan and calibration documentation is not verified from the reviewed file",
  ],
  [
    /\bSide\s+Structure\s+Aperture\s+Door-?Shell\s+Fit\s+Verification\b/gi,
    "The doors and surrounding panels may need additional fit and alignment checks",
  ],
  [
    /\bFit\s+And\s+Finish\s+Validation\b/gi,
    "Fit and finish proof is not produced in the reviewed file",
  ],
  [
    /\bStructural\s+Measurement\s+Verification\b/gi,
    "Structural measurement or alignment proof is not produced in the reviewed file",
  ],
  [
    /\bFront\s+Structure\s+Scope\s*\/\s*Tie\s+Bar\s*\/\s*Upper\s+Rail\s+Reconciliation\b/gi,
    "The front structure and related mounting parts may need a closer repair-scope review",
  ],
  [
    /\bOEM\s+Fit-?Sensitive\s+Part\s+Posture\b/gi,
    "Fit-sensitive replacement part support is not verified from the reviewed file",
  ],
  [
    /\bRequest\s+the\s+missing\s+supporting\s+documentation\s+or\s+a\s+written\s+estimate\s+explanation\b/gi,
    "Ask the insurer or repair shop to explain whether this item is included, and if not, why.",
  ],
];

const INTERNAL_PATTERNS = [
  /\bevidence\s*chain\b/gi,
  /\bevidence\s+references?\b/gi,
  /\bsupport\s*basis\b/gi,
  /\brisk\s*if\s*omitted\b/gi,
  /\bsupport\s*confidence\b/gi,
  /\bconfidence\s*percentage\b/gi,
  /\binferred\s+support\b/gi,
  /\bverified\s+support\b/gi,
  /\bsupport\s*:\s*(?:verified|inferred|supported|unsupported|documented)\b/gi,
  /\bverified\s+percentage\b/gi,
  /\bunderwritten(?:\s+operation)?\b/gi,
  /\bsource\s+conflict\b/gi,
  /\bcitation\s+verification\b/gi,
  /\bimmutable\b/gi,
  /\bruntime\b/gi,
  /\bparser\b/gi,
  /\bcmox[a-z0-9_-]*\b/gi,
  /\b[A-Z]{2,}_[A-Z0-9_]{3,}\b/g,
  /\b(?:evidence|issue|finding|linked|drive|artifact|snapshot|render)[-_:]?[a-z0-9_-]{6,}\b/gi,
  /\b\d{1,3}%\s*(?:confidence|supported|verified)?\b/gi,
  /\b(?:documented|referenced|missing|inferred|verified)\s+evidence\s+at\s+\d{1,3}%\s+confidence\b/gi,
  /\bProc\s*\d+\s*#?\s*\*+\s*[^.;\n]*/gi,
  /\bwheelm\d+(?:\.\d+)?\b/gi,
  /\bbattery\s+primarym\d+(?:\.\d+)?\b/gi,
  /\b[a-z]{3,}m\d+\.\d+\b/gi,
];

const DEBUG_LINE_PATTERNS = [
  /\b(?:sha-?256|classification|parser status|artifact family|source archive)\b/i,
  /\bProc\s*\d+\s*#?\s*\*+/i,
  /\bwheelm\d+(?:\.\d+)?\b/i,
  /\bbattery\s+primarym\d+(?:\.\d+)?\b/i,
  /\b[a-z]{3,}m\d+\.\d+\b/i,
  /^[^a-zA-Z]*(?:\d+[#*]|[|_]{2,})/,
];

export function toCustomerFacingText(value?: string | null, fallback = ""): string {
  if (!value) return fallback;

  let output = value.replace(/\r/g, " ");
  for (const [pattern, replacement] of TECHNICAL_TRANSLATIONS) {
    output = output.replace(pattern, replacement);
  }

  output = output
    .split(/\n|(?<=\.)\s+(?=(?:Evidence|Risk if omitted|Support|Source|Confidence|Citation):)/i)
    .map((line) => {
      const trimmed = line.trim();
      const estimateLine = sanitizeEstimateLine(trimmed);
      if (!estimateLine.malformed) return trimmed;
      return estimateLine.hideFromCustomer ? "" : estimateLine.cleaned;
    })
    .filter((line) => line && !DEBUG_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join(" ");

  output = output.replace(
    /\bIt\s+\[REDACTED_INSURER\]\s*,?\s+but\b[^.?!]*(?:[.?!]|$)/gi,
    "Scan and calibration support still needs stronger file proof before it is treated as fully documented."
  );
  output = output
    .replace(/\b(?:The\s+)?\[REDACTED_INSURER\]\s*,?\s+but\b[^.?!]*(?:[.?!]|$)/gi, "The insurer's position still needs stronger file proof before it is treated as fully documented.")
    .replace(/\b(?:This|That)\s+\[REDACTED_[A-Z_]+\]\s*,?\s+but\b[^.?!]*(?:[.?!]|$)/gi, "This item still needs stronger file proof before it is treated as fully documented.")
    .replace(/\b(?:for|from|by|with)\s+\[REDACTED_[A-Z_]+\]\s+\[REDACTED_[A-Z_]+\]\b/gi, "for the reviewed claim")
    .replace(/\s+\[REDACTED_[A-Z_]+\](?=\s*(?:[.,;:]|$))/g, "");
  output = cleanCustomerExportFragments(output);

  for (const pattern of INTERNAL_PATTERNS) {
    output = output.replace(pattern, "");
  }

  output = output
    .replace(/(?:^|[\s;|])(?:Evidence|Evidence references?|Risk if omitted|Support|Support basis|Confidence|Source|Runtime|Immutable)\s*:\s*[^.;|\n]*/gi, " ")
    .replace(/\bDOCUMENTED\b|\bSUPPORTABLE_BUT_UNCONFIRMED\b|\bOPEN_PENDING_FURTHER_DOCUMENTATION\b|\bREFERENCED_NOT_PRODUCED\b/gi, "")
    .replace(/\bAI\s+audit\b|\baudit\s+language\b/gi, "")
    .replace(/\s*;\s*(?:Evidence|Risk|Support|Source|Confidence|Citation)\s*:[^.;]*/gi, "")
    .replace(/\s*\|\s*(?:Evidence|Risk|Support|Source|Confidence|Citation)\s*:[^|.]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s:;|.-]+|[\s:;|-]+$/g, "")
    .trim();

  const sanitized = sanitizeUserFacingEvidenceText(output);
  const normalized = normalizeNarrativeProse(sanitized, "CUSTOMER_SUMMARY");
  return cleanCustomerExportFragments(normalized) || cleanCustomerExportFragments(normalizeNarrativeProse(sanitizeUserFacingEvidenceText(fallback), "CUSTOMER_SUMMARY")) || fallback;
}

function cleanCustomerExportFragments(value: string): string {
  return value
    .replace(/\bCCC\s+Secure\s+Share\s+documentation\s+this\s+estimate\s+line\s+was\s+present\s+in\s+the\s+structured\s+estimate\s+data\.?/gi, "CCC Secure Share source confirms this estimate line was present in the structured estimate data.")
    .replace(/\bbut\s+the\s+the\b/gi, "but the")
    .replace(/\bBoth\s+(?:carrier|shop|insurer|insurance|appraiser)\s+area of damage\b/gi, "Both estimates describe the area of damage")
    .replace(/\bcontinue documentation any added findings\b/gi, "continue documenting any added findings")
    .replace(/\bpark\s+park\s+park\s+sensor\s+bezel\s+front\b/gi, "front park sensor bezel")
    .replace(/\bpark\s+sensor1ew63tzzaa1361\.000\.20\.0\b/gi, "park sensor")
    .replace(/\bsome of the repair steps are still only partly(?:\s+verified)?(?:\.\s*Verified\.)?/gi, "some of the repair steps are still only partly verified.")
    .replace(/\bif calibration, alignment, or hidden mounting issues were not fully(?:\s+verified)?(?:\.\s*Verified\.)?/gi, "if calibration, alignment, or hidden mounting issues were not fully verified.")
    .replace(/\brepairs are not complete\b|\brepair is unfinished\b|\bvehicle is still in teardown\b/gi, "repair completion status is not established from the reviewed file")
    .replace(/\bfinal repair path still depends on\b/gi, "the estimate comparison supports a documentation gap, not a repair-stage conclusion about")
    .replace(/\bif more damage shows up during teardown\b/gi, "if repairs are ongoing")
    .replace(/\bthe repair shop can inspect further\b/gi, "the reviewed file does not include completion proof for this item")
    .replace(/\badded findings can be and sent in as a supplement\b\.?/gi, "added findings can be documented and sent in as a supplement.")
    .replace(/\bmake sure the claim handling stays(?:\s+clear and documented)?(?:\.\s*Clear and\.)?/gi, "make sure the claim handling stays clear and documented.")
    .replace(/\bfinish documentation the repair path\b\.?/gi, "finish documenting the repair path.")
    .replace(/\bfinish documentation the structural checks\b\.?/gi, "finish documenting the structural checks.")
    .replace(/\bfinish documentation the structural measurements\b\.?/gi, "finish documenting the structural measurements.")
    .replace(/\bthe\s+the\b/gi, "the")
    .replace(/\b(?:proof|support|documentation)\s+remains\s+unclear\s+remains\s+unclear\b/gi, "$1 remains unclear")
    .replace(/\bask\s+for\s+for\b/gi, "ask for")
    .replace(/\bwith\s+with\b/gi, "with")
    .replace(/\bto\s+to\b/gi, "to")
    .replace(/\bstrongest documentation concern is the carrier note that the LKQ grille is not the correct style\b/gi, "strongest line-specific concern is the carrier note that the LKQ grille is not the correct style")
    .replace(/\bIn Pennsylvania,\s*the file supports asking for written communication when the repair position or delay needs to be explained\./gi, "If state-specific claim-handling rules apply, you may also be able to request written communication when the repair position or delay needs to be explained.")
    .replace(/\bIn Pennsylvania,\s*the file also supports asking for written status updates[^.]*\./gi, "If state-specific claim-handling rules apply, you may also be able to request written status updates when the claim is delayed or when the repair position is not being explained clearly.")
    .replace(/\bPennsylvania-specific options\b/gi, "state-specific options")
    .replace(/\bIf state-specific claim \[REDACTED_CLAIM\],\s*/gi, "If state-specific claim-handling rules apply, ")
    .replace(/\bIf you are in Pennsylvania\b/gi, "If state-specific claim-handling rules apply");
}

export function toCustomerFacingList(
  values: Array<string | null | undefined>,
  fallback: string[] = ["No additional items were noted."]
): string[] {
  const seen = new Set<string>();
  const cleaned = values
    .map((value) => toCustomerFacingText(value))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return cleaned.length ? cleaned : fallback;
}

export function sanitizeCustomerReportForRender(report: CustomerReport): CustomerReport {
  return {
    title: toCustomerFacingText(report.title, "Customer Report") || "Customer Report",
    openingSummary: toCustomerFacingText(report.openingSummary),
    whichRepairPlanLooksStronger: toCustomerFacingText(report.whichRepairPlanLooksStronger),
    safetyFirst: toCustomerFacingText(report.safetyFirst),
    whatStillNeedsProof: toCustomerFacingList(report.whatStillNeedsProof),
    yourOptions: toCustomerFacingList(report.yourOptions),
    bottomLine: toCustomerFacingText(report.bottomLine),
  };
}

export function sanitizeCustomerFacingDocument(document: CarrierReportDocument): CarrierReportDocument {
  return {
    ...document,
    brand: {
      ...document.brand,
      companyName: toCustomerFacingText(document.brand.companyName, document.brand.companyName),
      reportLabel: toCustomerFacingText(document.brand.reportLabel, document.brand.reportLabel),
    },
    header: {
      title: toCustomerFacingText(document.header.title, document.header.title),
      subtitle: toCustomerFacingText(document.header.subtitle, document.header.subtitle),
      generatedLabel: toCustomerFacingText(document.header.generatedLabel, document.header.generatedLabel),
    },
    summary: document.summary.map((item) => ({
      label: toCustomerFacingText(item.label, item.label),
      value: toCustomerFacingText(item.value, item.value),
    })),
    sections: document.sections.map((section) => ({
      ...section,
      title: toCustomerFacingText(section.title, section.title),
      body: section.body ? toCustomerFacingText(section.body) : undefined,
      bullets: section.bullets ? toCustomerFacingList(section.bullets, []) : undefined,
      comparisonRows: section.comparisonRows?.map((row) => ({
        label: toCustomerFacingText(row.label, row.label),
        leftLabel: toCustomerFacingText(row.leftLabel, row.leftLabel),
        leftValue: toCustomerFacingText(row.leftValue, row.leftValue),
        rightLabel: toCustomerFacingText(row.rightLabel, row.rightLabel),
        rightValue: toCustomerFacingText(row.rightValue, row.rightValue),
        delta: row.delta ? toCustomerFacingText(row.delta, row.delta) : undefined,
        note: row.note ? toCustomerFacingText(row.note) : undefined,
      })),
    })),
    footer: toCustomerFacingList(document.footer, []),
  };
}

export function containsCccWorkfileSignal(values: Array<string | null | undefined>) {
  return values.some((value) => /\b(?:ccc|awf|workfile)\b/i.test(value ?? ""));
}
