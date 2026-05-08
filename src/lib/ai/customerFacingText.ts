const TECHNICAL_TRANSLATIONS: Array<[RegExp, string]> = [
  [
    /\bHidden\s+Mounting\s+Geometry\s*\/?\s*Teardown\s+Growth\b/gi,
    "Possible hidden mounting or structural damage may still need inspection after teardown",
  ],
  [
    /\bADAS\s+Calibration\s+Procedure\s+Support\b/gi,
    "The vehicle may need scan and calibration work after repairs",
  ],
  [
    /\bSide\s+Structure\s+Aperture\s+Door-?Shell\s+Fit\s+Verification\b/gi,
    "The doors and surrounding panels may need additional fit and alignment checks",
  ],
  [
    /\bFit\s+And\s+Finish\s+Validation\b/gi,
    "The repaired panels, lights, bumper, and trim should be checked for proper fit before the job is finished",
  ],
  [
    /\bStructural\s+Measurement\s+Verification\b/gi,
    "The structure may need measurement or alignment checks before repairs are finalized",
  ],
  [
    /\bFront\s+Structure\s+Scope\s*\/\s*Tie\s+Bar\s*\/\s*Upper\s+Rail\s+Reconciliation\b/gi,
    "The front structure and related mounting parts may need a closer repair-scope review",
  ],
  [
    /\bOEM\s+Fit-?Sensitive\s+Part\s+Posture\b/gi,
    "Fit-sensitive replacement parts should be reviewed carefully before final repairs",
  ],
  [
    /\bRequest\s+the\s+missing\s+supporting\s+documentation\s+or\s+a\s+written\s+estimate\s+explanation\b/gi,
    "Ask the insurer or repair shop to explain whether this item is included, and if not, why.",
  ],
];

const INTERNAL_PATTERNS = [
  /\bevidence\s*chain\b/gi,
  /\bsupport\s*basis\b/gi,
  /\brisk\s*if\s*omitted\b/gi,
  /\bsupport\s*confidence\b/gi,
  /\bconfidence\s*percentage\b/gi,
  /\binferred\s+support\b/gi,
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
  /\bProc\s*\d+\s*#?\*+\s*[^.;\n]*/gi,
  /\bwheelm\d+(?:\.\d+)?\b/gi,
  /\b[a-z]{3,}m\d+\.\d+\b/gi,
];

const DEBUG_LINE_PATTERNS = [
  /\b(?:sha-?256|classification|parser status|artifact family|source archive|runtime|immutable|cmox)\b/i,
  /\bProc\s*\d+\s*#?\*+/i,
  /\bwheelm\d+(?:\.\d+)?\b/i,
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
    .map((line) => line.trim())
    .filter((line) => line && !DEBUG_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join(" ");

  for (const pattern of INTERNAL_PATTERNS) {
    output = output.replace(pattern, "");
  }

  output = output
    .replace(/\bDOCUMENTED\b|\bSUPPORTABLE_BUT_UNCONFIRMED\b|\bOPEN_PENDING_FURTHER_DOCUMENTATION\b|\bREFERENCED_NOT_PRODUCED\b/gi, "")
    .replace(/\bAI\s+audit\b|\baudit\s+language\b/gi, "")
    .replace(/\s*;\s*(?:Evidence|Risk|Support|Source|Confidence|Citation)\s*:[^.;]*/gi, "")
    .replace(/\s*\|\s*(?:Evidence|Risk|Support|Source|Confidence|Citation)\s*:[^|.]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s:;|.-]+|[\s:;|-]+$/g, "")
    .trim();

  return output || fallback;
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

export function containsCccWorkfileSignal(values: Array<string | null | undefined>) {
  return values.some((value) => /\b(?:ccc|awf|workfile)\b/i.test(value ?? ""));
}
