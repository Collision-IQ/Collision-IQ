const LEAKED_TIME_FRAGMENT_BASES = [
  "battery",
  "wheel",
  "bumper",
  "fender",
  "door",
  "hood",
  "lamp",
  "liner",
  "mirror",
  "panel",
  "grille",
  "fascia",
  "sensor",
  "scan",
  "calibration",
] as const;

const leakedTimeFragmentPattern = new RegExp(
  `\\b(${LEAKED_TIME_FRAGMENT_BASES.join("|")})m\\d+(?:\\.\\d+)?\\b`,
  "gi"
);
const ORPHAN_SECTION_LABEL_PATTERN =
  /(?:^|\n)\s*(?:what looks reasonable|what still needs support|what looks aggressive|what stands out|documented positives|likely remaining gaps|support posture|estimate position)\s*:\s*(?=\n|$)/gim;
const OPERATION_DISPLAY_FALLBACK = "Repair Operation";
const PARSER_REVIEW_NEEDED_LABEL = "Parser review needed";
const MALFORMED_PROC_PATTERN = /\bproc\s*\d+\s*#?\s*\*+/i;
const LEAKED_SUFFIX_ONLY_PATTERN = /^\s*[a-z][a-z\s/-]*m\d+(?:\.\d+)?\s*$/i;
const FUSED_PART_TOKEN_PATTERN = /\b([a-z][a-z/&'-]{2,}?)(?:m?0\.[1-9]|\d{6,}[a-z]{0,3})\b/gi;
const CODE_HEAVY_TOKEN_PATTERN = /\b[A-Za-z]*\d[A-Za-z0-9.-]{7,}\b/g;
const GENERIC_OPERATION_ONLY_PATTERN = /^(?:r\s*&\s*i|r\s*&\s*r|repl|rpr|refn|o\s*\/\s*h|subl|add|overlap|repair operation|labor paint|labor|paint)$/i;
const KNOWN_OPERATION_VERBS = [
  "R&I",
  "R&R",
  "Repl",
  "Rpr",
  "Refn",
  "O/H",
  "Subl",
  "Add",
  "Overlap",
  "Proc",
  "Algn",
  "Test fit",
  "Measure",
  "Realign",
  "Set up",
] as const;

export type EstimateOperationLabelInput = {
  description?: string | null;
  operation?: string | null;
  partName?: string | null;
  category?: string | null;
  label?: string | null;
};

export type EstimateLineSanitization = {
  raw: string;
  cleaned: string;
  technicalLabel: string;
  malformed: boolean;
  hideFromCustomer: boolean;
};

export function cleanPresentationText(value: string | null | undefined): string {
  if (!value) return "";

  return value
    .replace(ORPHAN_SECTION_LABEL_PATTERN, "\n")
    .replace(/[Â·]+/g, "·")
    .replace(leakedTimeFragmentPattern, "$1")
    .replace(/\b([A-Z]{2,})\s*[-|/]\s*(scan|module|dtc|fault)\b/gi, "$1")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanPresentationMarkdown(value: string): string {
  return cleanPresentationText(value);
}

export function sanitizeEstimateLine(value: string | null | undefined): EstimateLineSanitization {
  const raw = `${value ?? ""}`.replace(/\r/g, " ").trim();
  if (!raw) {
    return {
      raw: "",
      cleaned: "",
      technicalLabel: PARSER_REVIEW_NEEDED_LABEL,
      malformed: false,
      hideFromCustomer: true,
    };
  }

  const hasLeakedTimeFragment = leakedTimeFragmentPattern.test(raw);
  leakedTimeFragmentPattern.lastIndex = 0;
  const hasCodeHeavyToken = CODE_HEAVY_TOKEN_PATTERN.test(raw);
  CODE_HEAVY_TOKEN_PATTERN.lastIndex = 0;
  const leakedTokenCount = raw.match(/\b[a-z][a-z\s/-]*m\d+(?:\.\d+)?\b/gi)?.length ?? 0;
  const malformed =
    MALFORMED_PROC_PATTERN.test(raw) ||
    LEAKED_SUFFIX_ONLY_PATTERN.test(raw) ||
    hasLeakedTimeFragment ||
    hasCodeHeavyToken;

  const cleaned = cleanPresentationText(raw)
    .replace(MALFORMED_PROC_PATTERN, " ")
    .replace(FUSED_PART_TOKEN_PATTERN, "$1")
    .replace(CODE_HEAVY_TOKEN_PATTERN, " ")
    .replace(/\b(?:procedure\s+research|primary)\b/gi, " ")
    .replace(/[#+*|_~]+/g, " ")
    .replace(/\b\d+(?:\.\d+){2,}\b/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  const display = cleanOperationDisplayText(cleaned);
  const isGeneric = !display || display === OPERATION_DISPLAY_FALLBACK || /^(?:wheel|battery|proc|procedure|primary)$/i.test(display);
  const hideFromCustomer = malformed && (isGeneric || cleaned.length < 8 || leakedTokenCount >= 2);

  return {
    raw,
    cleaned: hideFromCustomer ? "" : display,
    technicalLabel: malformed && isGeneric ? PARSER_REVIEW_NEEDED_LABEL : display || PARSER_REVIEW_NEEDED_LABEL,
    malformed,
    hideFromCustomer,
  };
}

export function isMalformedEstimateLine(value: string | null | undefined): boolean {
  return sanitizeEstimateLine(value).malformed;
}

export function cleanEstimateLineForCustomer(value: string | null | undefined): string {
  const result = sanitizeEstimateLine(value);
  return result.hideFromCustomer ? "" : result.cleaned;
}

export function cleanEstimateLineForTechnicalExport(value: string | null | undefined): string {
  return sanitizeEstimateLine(value).technicalLabel;
}

export function cleanOperationDisplayText(value: string | null | undefined): string {
  const normalized = normalizeEstimateOperationLabel(value);
  return normalized || OPERATION_DISPLAY_FALLBACK;
}

export function normalizeEstimateOperationLabel(
  value: string | EstimateOperationLabelInput | null | undefined
): string {
  const input = typeof value === "string" ? { label: value } : value ?? {};
  const description = cleanOperationCandidate(input.description);
  const operation = cleanOperationCandidate(input.operation);
  const partName = cleanOperationCandidate(input.partName);
  const category = cleanOperationCandidate(input.category);
  const label = cleanOperationCandidate(input.label);
  const verb = resolveOperationVerb(operation || label || "");
  const labelWithoutVerb = dropLeadingOperationVerb(label, verb);
  const descriptionWithoutVerb = dropLeadingOperationVerb(description, verb);
  const partWithoutVerb = dropLeadingOperationVerb(partName, verb);

  const candidates = [
    description,
    combineVerbAndDetail(verb, descriptionWithoutVerb),
    combineVerbAndDetail(verb, partWithoutVerb),
    category,
    label,
    combineVerbAndDetail(verb, labelWithoutVerb),
    operation,
  ];

  for (const candidate of candidates) {
    const resolved = finalizeOperationLabel(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return "";
}

export function cleanVehicleSummaryLabel(value: string | null | undefined): string {
  const base = cleanPresentationText(value);
  const cleaned = preserveCanonicalVehicleSummary(base);

  if (!cleaned) return "";
  if (cleaned.length > 60) return "";
  if (!/[A-Za-z]/.test(cleaned)) return "";
  return cleaned;
}

export function cleanVehicleTrimLabel(value: string | null | undefined): string {
  const cleaned = preserveCanonicalVehicleTrim(cleanPresentationText(value));
  if (!cleaned) return "";
  if (cleaned.length > 36) return "";
  if (/(scan|module|dtc|fault|code|title)/i.test(cleaned)) return "";
  return cleaned;
}

function preserveCanonicalVehicleSummary(value: string): string {
  if (!value) return "";

  if (looksLikeCanonicalVehicleSummary(value)) {
    return value;
  }

  return value.replace(/\b(scan|module|dtc|fault|code|title)\b.*$/i, "").trim();
}

function preserveCanonicalVehicleTrim(value: string): string {
  if (!value) return "";

  if (looksLikeCanonicalVehicleTrim(value)) {
    return value;
  }

  return value.replace(/\b(scan|module|dtc|fault|code|title)\b.*$/i, "").trim();
}

function looksLikeCanonicalVehicleSummary(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const hasYear = /\b(?:19|20)\d{2}\b/.test(trimmed);
  const hasMultiWordVehicle =
    /\b[A-Za-z]{2,}\b/.test(trimmed) && trimmed.split(/\s+/).filter(Boolean).length >= 3;
  const hasVinOnly = /\b[A-HJ-NPR-Z0-9]{17}\b/i.test(trimmed);

  return (hasYear && hasMultiWordVehicle) || hasVinOnly;
}

function looksLikeCanonicalVehicleTrim(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  if (/^(?:[0-9]{1,3}[A-Za-z]{0,2}(?:\s+(?:AWD|FWD|RWD|4WD|2WD))?)$/i.test(trimmed)) {
    return true;
  }

  if (
    /^(?:AWD|FWD|RWD|4WD|2WD|SPORT|LIMITED|PLATINUM|PREMIUM|PERFORMANCE|LONG RANGE)$/i.test(
      trimmed
    )
  ) {
    return true;
  }

  return false;
}

function cleanOperationDisplayToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  if (/^\d{5,}$/.test(trimmed)) return "";
  if (/^(?:\d+[.:,-]){2,}\d+$/.test(trimmed)) return "";

  let cleaned = trimmed
    .replace(/^[^A-Za-z0-9&(-]+|[^A-Za-z0-9).-]+$/g, "")
    .replace(/\d{5,}/g, "")
    .replace(/\d+(?:\.\d+){2,}/g, "")
    .replace(/(?:\d{2,}[.:,-]){2,}\d*/g, "");

  const alphaPrefix = cleaned.match(/^[A-Za-z][A-Za-z&()/-]*?(?=\d|$)/)?.[0] ?? "";
  if (/\d/.test(cleaned)) {
    const lettersOnly = cleaned.replace(/[^A-Za-z]/g, "");
    if (alphaPrefix && alphaPrefix.length >= 2 && lettersOnly.length === alphaPrefix.length) {
      cleaned = alphaPrefix;
    } else {
      cleaned = cleaned.replace(/\d+/g, "");
    }
  }

  cleaned = cleaned.replace(/^[^A-Za-z]+|[^A-Za-z)-]+$/g, "");

  if (!cleaned) return "";
  if (!/[A-Za-z]/.test(cleaned)) return "";

  return cleaned;
}

function cleanOperationCandidate(value: string | null | undefined): string {
  if (!value) return "";

  const cleaned = cleanPresentationText(value)
    .replace(/^\s*operations?\s*[-:]+\s*/i, "")
    .replace(/^\s*#?\s*\d+\s+/i, "")
    .replace(/\b(?:incl(?:uded)?\.?|n\/?a|none|unknown)\b/gi, " ")
    .replace(/\b\d+\.\d+\.\d+(?:\.\d+)*\b/g, " ")
    .replace(/\b[+-]?\d+(?:\.\d+)?%\b/g, " ")
    .replace(/\b\$?\d{1,4}(?:,\d{3})*(?:\.\d{2})\b/g, " ")
    .replace(/\b([A-Za-z][A-Za-z/&'-]{2,})\d[A-Za-z0-9.-]{4,}\b/g, "$1")
    .replace(/\b(?:[A-Z]*\d[A-Z0-9-]{5,}|\d{6,}[A-Za-z]{0,4})\b/g, " ")
    .replace(/\b[a-z]{1,5}\d[a-z0-9.]{5,}\b/gi, " ")
    .replace(/(?:\b(?:t|m|hr|hrs|ea|qty)\b\s*)+$/i, " ")
    .replace(/[|_~]+/g, " ")
    .replace(/\.(?=\d)/g, " ")
    .replace(/\s*\/+\s*/g, " ")
    .split(/\s+/)
    .map(cleanOperationDisplayToken)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

function resolveOperationVerb(value: string): string {
  const cleaned = cleanOperationCandidate(value).toLowerCase();
  if (!cleaned) return "";

  const matched = KNOWN_OPERATION_VERBS.find((token) =>
    new RegExp(`^${token.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&").replace(/\\s+/g, "\\s+")}(?:\\b|$)`, "i").test(cleaned)
  );

  if (matched) {
    return matched;
  }

  const simpleMatch = cleaned.match(/^(r\s*&\s*i|r\s*&\s*r|repl|rpr|refn|subl|add|overlap|algn|proc|o\s*\/\s*h)\b/i);
  if (!simpleMatch) return "";

  const canonical = simpleMatch[1].replace(/\s+/g, " ").toLowerCase();
  if (canonical.includes("r & i")) return "R&I";
  if (canonical.includes("r & r")) return "R&R";
  if (canonical === "repl") return "Repl";
  if (canonical === "rpr") return "Rpr";
  if (canonical === "refn") return "Refn";
  if (canonical === "subl") return "Subl";
  if (canonical === "add") return "Add";
  if (canonical === "overlap") return "Overlap";
  if (canonical === "algn") return "Algn";
  if (canonical === "proc") return "Proc";
  if (canonical.includes("o / h")) return "O/H";
  return "";
}

function dropLeadingOperationVerb(value: string, verb: string): string {
  if (!value) return "";
  if (!verb) return value;

  const escaped = verb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return value.replace(new RegExp(`^${escaped}\\b[\\s:-]*`, "i"), "").trim();
}

function combineVerbAndDetail(verb: string, detail: string): string {
  const cleanedDetail = detail.trim();
  if (verb && cleanedDetail) {
    return `${verb} ${cleanedDetail}`.trim();
  }
  return cleanedDetail || verb;
}

function finalizeOperationLabel(value: string): string {
  const cleaned = cleanOperationCandidate(value);
  if (!cleaned) return "";
  if (!/[A-Za-z]/.test(cleaned)) return "";

  const withoutDuplicateVerb = cleaned.replace(
    /^(R&I|R&R|Repl|Rpr|Refn|Subl|Add|Overlap|Algn|Proc|O\/H)\s+\1\b\s*/i,
    "$1 "
  ).trim();
  if (!withoutDuplicateVerb) return "";

  const normalized = formatOperationDisplayCase(withoutDuplicateVerb);
  if (!normalized) return "";
  if (GENERIC_OPERATION_ONLY_PATTERN.test(normalized)) return "";
  if (/^(?:operations?|procedure|proc)$/i.test(normalized)) return "";

  return normalized;
}

function formatOperationDisplayCase(value: string): string {
  if (/[A-Z]/.test(value)) {
    return value;
  }

  return value
    .split(/\s+/)
    .map((token) =>
      token
        .split("-")
        .map((segment) => formatOperationDisplaySegment(segment))
        .join("-")
    )
    .join(" ");
}

function formatOperationDisplaySegment(value: string): string {
  if (!value) return value;
  if (/^[A-Z0-9&()]{2,5}$/.test(value)) return value;

  const lowered = value.toLowerCase();
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}

export function sanitizeUserFacingEvidenceText(input: string): string {
  // Implementation of the sanitizer
  return input.trim();
}
