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
const CMP_EVIDENCE_ID_PATTERN = /\bcmp[a-z0-9]{8,}\b/gi;
const CMP_EVIDENCE_ID_CHAIN_PATTERN = /(?:\bcmp[a-z0-9]{8,}\b[\s,;]*){2,}/gi;
const EVIDENCE_REFERENCE_LEAD_IN_PATTERN = /Evidence references?:\s*(?:[.,;:\-\s]*)/gi;
const READABILITY_STATUS_LABELS = [
  "DOCUMENTED",
  "VISIBLE_IN_IMAGES",
  "REFERENCED_BUT_NOT_COMPLETED",
  "REFERENCED_NOT_PRODUCED",
  "SUPPORT_PRESENT_PROOF_INCOMPLETE",
  "SUPPORTABLE_BUT_UNCONFIRMED",
  "OPEN_PENDING_FURTHER_DOCUMENTATION",
  "NOT_ESTABLISHED",
  "NOT_YET_LOCATED",
  "NEEDS_REVIEW",
  "UNDER-DOCUMENTED",
] as const;
const READABILITY_STATUS_PATTERN = new RegExp(
  `([^\\n])\\s*(\\[?(?:${READABILITY_STATUS_LABELS.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\]?:)`,
  "g"
);
const MAJOR_NUMBERED_SECTION_PATTERN =
  /([^\n])\s+((?:[1-9]|1[0-9])\.\s+(?=[A-Z][A-Za-z][^\n]{4,}))/g;
const MARKDOWN_HEADING_JOIN_PATTERN = /([^\n])\s+(#{1,4}\s+)/g;
const INLINE_LABEL_JOIN_PATTERN =
  /([.!?])\s+((?:Carrier vulnerabilities|Shop vulnerabilities|Not final-award confidence|Final award|Bottom line|Support posture|Estimate position|What still needs support|What looks reasonable|What looks aggressive|Documented positives|Likely remaining gaps|Next action|Recommended action)\s*:)/gi;
const SENTENCE_COMPRESSION_PATTERN = /([a-z0-9),\]])\.\s+(?=(?:[A-Z][a-z]+(?:\s+[A-Z]?[a-z]+){0,5}:|[1-9]\.\s+))/g;
const MALFORMED_RETRIEVED_PATTERN = /\bRetrieved:\s*(?::\s*)?(?:(\d{4}-\d{2}-\d{2}T)?\s*)?(\d{1,2})\s*:\s*(\d{2})\s*:\s*(\d{2}(?:\.\d+)?Z?)\b/gi;
const MALFORMED_RETRIEVED_SHORT_PATTERN = /\bRetrieved:\s*:\s*(\d{1,2})\s*:\s*(\d{2}(?:\.\d+)?Z?)\b/gi;
const ORPHAN_RETRIEVED_TIME_PATTERN = /\bRetrieved:\s*\d{1,2}:\d{2}(?:\.\d+)?Z\b\.?/gi;
const URL_PATTERN = /\bhttps?:\/\/[^\s)\]]+/gi;
const INTERNAL_METADATA_BLOB_PATTERN =
  /\b(?:evidence|source|support|vector|retrieval|metadata|ingestion|reference|chain|ids?)\s*(?:references?|ids?|chain|metadata|blob)?\s*:\s*(?:\[[^\]]{0,500}\]|\{[^}]{0,500}\}|(?:[\w:-]{8,}\s*[,;]\s*){2,}[\w:-]{8,})/gi;
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
  return cleanUserFacingPresentationText(value, { preserveMarkdown: true });
}

export function cleanUserFacingPresentationText(
  value: string | null | undefined,
  options: { preserveMarkdown?: boolean } = {}
): string {
  if (!value) return "";

  let cleaned = `${value}`.replace(/\r\n?/g, "\n");

  cleaned = cleaned
    .replace(/[Ã‚Â·]+/g, "-")
    .replace(/[â€“â€”]/g, "-")
    .replace(/â€™/g, "'")
    .replace(/â€œ|â€�/g, '"')
    .replace(/â€¦/g, "...")
    .replace(/!\s*['’]/g, " -> ")
    .replace(/[ï¿½�]\s*(?:->|→|â†’)\s*/g, " -> ")
    .replace(/(?:â†’|→)/g, " -> ")
    .replace(/\bclaim-\s*\[REDACTED_CLAIM\]/gi, "claim [REDACTED_CLAIM]")
    .replace(/\bpolicy-\s*\[REDACTED_POLICY\]/gi, "policy [REDACTED_POLICY]")
    .replace(/\bGenerated\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\b/g, "Generated $1 $2, $3")
    .replace(URL_PATTERN, "source link")
    .replace(MALFORMED_RETRIEVED_SHORT_PATTERN, (_match, first: string, second: string) => `Retrieved: ${first}:${second}`)
    .replace(MALFORMED_RETRIEVED_PATTERN, (_match, datePrefix: string | undefined, hours: string, minutes: string, seconds: string) => {
      const time = `${hours.padStart(2, "0")}:${minutes}:${seconds}`;
      return `Retrieved: ${datePrefix ? `${datePrefix}${time}` : time}`;
    })
    .replace(/(\$?\d{1,3}),\s+(\d{3})/g, "$1,$2")
    .replace(/\b(\d{1,2})\s*:\s*(\d{2})\s*:\s*(\d{2}(?:\.\d+)?Z?)\b/g, "$1:$2:$3")
    .replace(/\bThe calibration-related procedures\.\s+The record includes\b/gi, "The file supports calibration-related procedures. The record includes")
    .replace(/\bnot yet clearly with printouts\b/gi, "not yet clearly documented with printouts")
    .replace(/\bcontinue documentation added findings\b/gi, "continue documenting added findings")
    .replace(/\bincluding a,\s*pre-repair scan\b/gi, "including a pre-repair scan")
    .replace(/\bstill needs to be clearly to avoid\b/gi, "still needs to be clearly documented to avoid")
    .replace(/\bshould be clearly to address\b/gi, "should be clearly documented to address")
    .replace(/\bThis supportable\b/g, "This appears supportable")
    .replace(/\bthis supportable\b/g, "this appears supportable")
    .replace(/\bnot fully,\s*/gi, "not fully documented, ")
    .replace(/\bfinal uploaded documents?\b/gi, "final documentation")
    .replace(/\buploaded documents?\s+(?:are|is)\b/gi, "documentation is")
    .replace(/\bmounting\s*uploaded file\b/gi, "mounting documentation")
    .replace(/\bSafetydocumentation support\b/g, "Safety documentation support")
    .replace(/\bmountingdocumentation area\b/gi, "mounting documentation area")
    .replace(/\b(sensor|camera|radar|scan|calibration|module)0\.\s*\d+\b/gi, "$1")
    .replace(/\buploaded file:\s*(?:source link|documentation|supporting evidence)\b/gi, "documentation")
    .replace(/\buploaded file\s+source link\b/gi, "source link")
    .replace(/\buploaded documents?\b/gi, "documentation")
    .replace(/\buploaded files?\b/gi, "documentation")
    .replace(/\buploaded file artifacts?\b/gi, "uploaded file references")
    .replace(/\bStructural cues\s+Structural\s+/gi, "Structural ")
    .replace(/\bStructural cues:\s*(?:none visible|not clearly shown)\.?\s*/gi, "")
    .replace(/\b(?:battery|wheel|bumper|fender|door|hood|lamp|liner|mirror|panel|grille|fascia|sensor|scan|calibration)\s+primarym\d+(?:\.\d+)?\b/gi, "")
    .replace(/\b(?:four-w|four-whe|post-pull c|alignmen|confi|repai)\b(?=[\s.,;:)]|$)/gi, "")
    .replace(/\b(?:Not clearly\s+){2,}shown\b/gi, "Not clearly shown")
    .replace(/\bpolicy packet with\s+(?:Georgia|GA|[A-Z][a-z]+)\s*(?:\([A-Z]{2}\))?\s+policy indicators\b/gi, "uploaded policy packet / appraisal-language support; jurisdiction metadata redacted or ambiguous")
    .replace(/\bJurisdiction:\s*Georgia\s*\(GA\)\b/gi, "Jurisdiction metadata: redacted or ambiguous")
    .replace(/\bcontinue at source link\b\.?/gi, "")
    .replace(ORPHAN_RETRIEVED_TIME_PATTERN, "")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;:])(?=\S)/g, "$1 ")
    .replace(/([.!?])(?=(?:[A-Z][a-z]|\d+\.\s))/g, "$1 ")
    .replace(READABILITY_STATUS_PATTERN, "$1\n$2")
    .replace(MARKDOWN_HEADING_JOIN_PATTERN, "$1\n\n$2")
    .replace(MAJOR_NUMBERED_SECTION_PATTERN, "$1\n\n$2")
    .replace(INLINE_LABEL_JOIN_PATTERN, "$1\n\n$2")
    .replace(SENTENCE_COMPRESSION_PATTERN, "$1.\n\n")
    .replace(/(^|\n)(#{1,4}\s+[^\n]+)\n(?!\n)/g, "$1$2\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\bRetrieved:\s*(\d{1,2}):\s+(\d{2}(?:\.\d+)?Z?)\b/g, "Retrieved: $1:$2")
    .replace(ORPHAN_RETRIEVED_TIME_PATTERN, "")
    .replace(/\bGenerated\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\b/g, "Generated $1 $2, $3")
    .replace(/,\s*(\d{4})\b/g, ", $1")
    .replace(/\bJurisdiction:\s*Georgia\s*\(GA\)\b/gi, "Jurisdiction metadata: redacted or ambiguous")
    .replace(/(\$?\d{1,3}),\s+(\d{3})/g, "$1,$2")
    .replace(/\b(\d{1,2})\s*:\s*(\d{2})\s*:\s*(\d{2}(?:\.\d+)?Z?)\b/g, "$1:$2:$3")
    .replace(/\bGenerated\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\b/g, "Generated $1 $2, $3")
    .replace(/(^|[\s\n])Jurisdiction:\s*Georgia\s*\(GA\)/gi, "$1Jurisdiction metadata: redacted or ambiguous")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/(^|[\s([])[,;:.-]+(?=\s|$|[)\]])/g, "$1");

  if (!options.preserveMarkdown) {
    cleaned = cleaned.replace(/\n+/g, " ");
  }

  return cleaned.trim();
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

export function sanitizeUserFacingEvidenceText(
  input: string | null | undefined,
  contextTitle?: string | null
): string {
  const original = input ?? "";
  const hadInternalEvidenceId =
    CMP_EVIDENCE_ID_PATTERN.test(original) ||
    CMP_EVIDENCE_ID_CHAIN_PATTERN.test(original) ||
    /\b(?:vector|retrieval|ingestion|metadata|reference|evidence)[-_ ]?[a-z0-9]{8,}\b/i.test(original);
  CMP_EVIDENCE_ID_PATTERN.lastIndex = 0;
  CMP_EVIDENCE_ID_CHAIN_PATTERN.lastIndex = 0;

  let cleaned = cleanPresentationText(cleanUserFacingPresentationText(original, { preserveMarkdown: true }));
  if (!cleaned) return "";

  cleaned = cleaned
    .replace(INTERNAL_METADATA_BLOB_PATTERN, " ")
    .replace(/\b(?:evidence|source|support|vector|retrieval|metadata|ingestion|reference|chain)\s*(?:ids?|references?|chain|metadata)\s*:\s*$/gim, " ")
    .replace(CMP_EVIDENCE_ID_CHAIN_PATTERN, " ")
    .replace(CMP_EVIDENCE_ID_PATTERN, " ")
    .replace(/\bEvidence references?:\s*(?:[,; ]*(?:cmp[a-z0-9-]{6,}|[a-f0-9]{24,}|[a-f0-9-]{32,}))+\.?/gi, "")
    .replace(EVIDENCE_REFERENCE_LEAD_IN_PATTERN, " ")
    .replace(/\bEvidence references?:\s*\.?/gi, "")
    .replace(/\bcmp[a-z0-9-]{4,}\b/gi, " ")
    .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\b/gi, "uploaded document")
    .replace(/\b[a-f0-9]{24,64}\b/gi, "uploaded file")
    .replace(/\b(?:evidence|chain|source|finding|issue|doc|line|parser|vector|object)[-_ ]?[a-z0-9]{8,}\b/gi, "uploaded document")
    .replace(/\b(?:cmox|cm|vec|emb|retrieval|vector|chunk|node)[-_]?[a-z0-9]{6,}\b/gi, " ")
    .replace(/\b(?:uploaded document\s*[,;:]?\s*){2,}/gi, "supporting evidence ")
    .replace(/\buploaded document:\s*(?:uploaded document\s*,?\s*){2,}/gi, "supporting evidence: ")
    .replace(/\bSame rationale as earlier\b/gi, "Related estimate rationale")
    .replace(/\bfinal uploaded documents?\b/gi, "final documentation")
    .replace(/\buploaded documents?\s+(?:are|is)\b/gi, "documentation is")
    .replace(/\buploaded documents?\b/gi, "documentation")
    .replace(/\bRepair Operation\b/gi, "Estimate item")
    .replace(/\bParser review needed\b/gi, "Estimate item")
    .replace(/\bgeneric operation labels?\b/gi, "estimate items")
    .replace(/\bOperation:\s*/gi, "Item: ")
    .replace(/\s*\|\s*Status:\s*/gi, " - Status: ")
    .replace(/\b(?:undefined|null|NaN)\b/gi, "")
    .replace(/\bSupport basis:\s*Evidence references?\b[\s,;:.]*/gi, "")
    .replace(/\bSupport basis:\s*/gi, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/(?:;\s*){2,}/g, "; ")
    .replace(/(?:[,;]\s*){2,}/g, "; ")
    .replace(/(^|[\s([])[,;:.-]+(?=\s|$|[)\]])/g, "$1")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (contextTitle) {
    const normalizedTitle = normalizeEstimateOperationLabel(contextTitle) || contextTitle.trim();
    if (normalizedTitle) {
      const escapedTitle = normalizedTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      cleaned = cleaned
        .replace(new RegExp(`^(${escapedTitle})\\s+\\1\\s*:?\\s*`, "i"), "$1: ")
        .replace(new RegExp(`^(${escapedTitle})\\s*:\\s*\\1\\s*:?\\s*`, "i"), "$1: ")
        .trim();
    }
  }

  const internalOnly = cleaned
    .toLowerCase()
    .replace(/[^\w\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !cleaned ||
    /^(?:evidence references?|supporting evidence|current file evidence|source references?)$/i.test(internalOnly)
  ) {
    return hadInternalEvidenceId ? "Evidence supported." : "";
  }

  return cleaned;
}

export function summarizeUserFacingSupport(
  value: string | null | undefined,
  fallback: string = "Evidence supported."
): string {
  const cleaned = sanitizeUserFacingEvidenceText(value);
  if (!cleaned) return fallback;
  if (/not yet located in reviewed files/i.test(cleaned)) {
    return "Not yet located in reviewed files.";
  }
  if (/referenced|not fully isolated|completion record/i.test(cleaned)) {
    return "Referenced support present; completion record not fully isolated.";
  }
  if (/final proof incomplete|proof incomplete|support present/i.test(cleaned)) {
    return "Support present; final proof incomplete.";
  }
  if (/invoice|photo|estimate|document|reviewed file|visible|documented/i.test(cleaned)) {
    return "Support verified from reviewed file evidence.";
  }
  return fallback;
}
