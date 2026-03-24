export type DerivedRenderSupplementItem = {
  title: string;
  category: string;
  kind:
    | "missing_operation"
    | "underwritten_operation"
    | "disputed_repair_path"
    | "missing_verification";
  rationale: string;
  evidence?: string;
  source: string;
  priority: "low" | "medium" | "high";
};

export type DerivedValuation = {
  acvStatus: "provided" | "estimated_range" | "not_determinable";
  acvValue?: number;
  acvRange?: { low: number; high: number };
  acvConfidence?: "low" | "medium" | "high";
  acvReasoning: string;
  acvMissingInputs: string[];
  dvStatus: "provided" | "estimated_range" | "not_determinable";
  dvValue?: number;
  dvRange?: { low: number; high: number };
  dvConfidence?: "low" | "medium" | "high";
  dvReasoning: string;
  dvMissingInputs: string[];
};

export type DerivedRenderInsights = {
  narrative?: string;
  supplementItems: DerivedRenderSupplementItem[];
  request?: string;
  valuation: DerivedValuation;
};

const OPERATION_KEYWORDS = [
  "structural",
  "setup",
  "measuring",
  "realignment",
  "scan",
  "calibration",
  "adas",
  "camera",
  "radar",
  "sensor",
  "alignment",
  "test fit",
  "fit-sensitive",
  "fit sensitive",
  "bumper",
  "lamp",
  "fender",
  "coolant",
  "purge",
  "corrosion protection",
  "measure",
  "section",
  "sectioning",
  "weld",
  "airbag",
  "seat belt",
  "pretensioner",
  "corrosion",
  "seam sealer",
  "cavity wax",
  "tie bar",
  "upper tie bar",
  "lock support",
  "support area",
  "upper rail",
  "core support",
  "oem",
  "aftermarket",
  "one-time-use",
  "one time use",
  "road test",
  "diagnostic",
  "bleed",
  "refill",
  "access",
  "weld protection",
];

const REPAIR_SECTION_HEADERS = [
  "supplement",
  "missing operations",
  "underwritten operations",
  "repair position",
  "position",
  "request",
  "recommendation",
  "recommended supplements",
];

const META_COMMENTARY_PATTERNS = [
  "repair strategy",
  "parts posture",
  "repair posture",
  "estimate posture",
  "estimate reviewed",
  "both estimates were reviewed",
  "it s mainly",
  "it's mainly",
  "mainly repair strategy",
  "missing access procedure items",
  "access/procedure items",
  "support gaps",
  "repair-path items",
  "repair path items",
];

export function deriveRenderInsightsFromChat(
  assistantAnalysis: string | null | undefined
): DerivedRenderInsights {
  const text = (assistantAnalysis ?? "").replace(/\r/g, "").trim();

  return {
    narrative: extractNarrative(text),
    supplementItems: extractSupplementItems(text),
    request: extractRequest(text),
    valuation: extractValuation(text),
  };
}

function extractNarrative(text: string): string | undefined {
  if (!text) return undefined;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => stripMarkdown(part).trim())
    .filter(Boolean);

  const scored = paragraphs
    .filter((paragraph) => !looksLikeMetaCommentary(paragraph))
    .map((paragraph) => ({ paragraph, score: scoreNarrativeParagraph(paragraph) }))
    .sort((left, right) => right.score - left.score);

  return scored.find(({ paragraph }) => {
    const lower = paragraph.toLowerCase();
    return (
      paragraph.length > 60 &&
      !lower.startsWith("please review") &&
      !lower.startsWith("request") &&
      !lower.startsWith("supplement") &&
      !lower.startsWith("diminished value") &&
      !lower.startsWith("acv") &&
      !lower.startsWith("actual cash value") &&
      !lower.startsWith("dv")
    );
  })?.paragraph;
}

function extractSupplementItems(text: string): DerivedRenderSupplementItem[] {
  if (!text) return [];

  const blocks = extractReasoningBlocks(text);
  const candidates = blocks
    .filter((line, index, all) => all.indexOf(line) === index)
    .filter((line) => looksLikeOperationSupportLine(line) && !looksLikeEstimateNoise(line))
    .filter((line) => !looksLikeMetaCommentary(line))
    .flatMap((line) => buildSupplementItemsFromReasoning(line))
    .filter((item) => item.title && item.rationale.length > 25);

  const deduped = new Map<string, DerivedRenderSupplementItem>();
  for (const item of candidates) {
    const key = item.title.toLowerCase();
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }

    deduped.set(
      key,
      scoreSupplementCandidate(item) > scoreSupplementCandidate(existing) ? item : existing
    );
  }

  return [...deduped.values()].sort(
    (left, right) => scoreSupplementCandidate(right) - scoreSupplementCandidate(left)
  );
}

function extractRequest(text: string): string | undefined {
  if (!text) return undefined;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => sanitizeHumanText(stripMarkdown(part)))
    .filter(Boolean);

  return paragraphs.find((paragraph) => {
    const lower = paragraph.toLowerCase();
    return lower.startsWith("please review") || lower.startsWith("please provide");
  });
}

function extractValuation(text: string): DerivedValuation {
  const lower = text.toLowerCase();
  const acvBlock = findValuationBlock(text, ["acv", "actual cash value"]);
  const dvBlock = findValuationBlock(text, ["diminished value", "dv"]);
  const acvNumbers = extractCurrencyValues(acvBlock ?? "");
  const dvNumbers = extractCurrencyValues(dvBlock ?? "").filter((value) => value <= 50000);
  const dvExplicitRange = explicitlySignalsRange(dvBlock ?? "");
  const acvMissingInputs = acvNumbers.length > 0
    ? []
    : ["vehicle condition", "mileage", "trim/options", "market comparable data"];
  const dvMissingInputs =
    dvNumbers.length > 0
      ? []
      : ["repair severity context", "damage photos or confirmed repair scope", "pre-loss market context"];

  return {
    acvStatus:
      acvNumbers.length >= 2
        ? "estimated_range"
        : acvNumbers.length === 1
          ? "provided"
          : "not_determinable",
    ...(acvNumbers.length === 1 ? { acvValue: acvNumbers[0] } : {}),
    ...(acvNumbers.length >= 2
      ? { acvRange: { low: Math.min(...acvNumbers), high: Math.max(...acvNumbers) } }
      : {}),
    acvConfidence:
      acvNumbers.length >= 2
        ? "medium"
        : acvNumbers.length === 1
          ? "medium"
          : undefined,
    acvReasoning:
      sanitizeHumanText(acvBlock ?? "") ||
      (lower.includes("acv") || lower.includes("actual cash value")
        ? "ACV was discussed, but the current documents do not support a reliable exact value."
        : "ACV is not determinable from the current documents."),
    acvMissingInputs,
    dvStatus:
      dvNumbers.length >= 2 || (dvExplicitRange && dvNumbers.length === 2)
        ? "estimated_range"
        : dvNumbers.length === 1
          ? "provided"
          : "not_determinable",
    ...(dvNumbers.length === 1 ? { dvValue: dvNumbers[0] } : {}),
    ...(dvNumbers.length >= 2
      ? { dvRange: { low: Math.min(...dvNumbers), high: Math.max(...dvNumbers) } }
      : {}),
    dvConfidence:
      dvNumbers.length >= 2
        ? "medium"
        : dvNumbers.length === 1
          ? "medium"
          : undefined,
    dvReasoning:
      sanitizeHumanText(dvBlock ?? "") ||
      (lower.includes("diminished value") || /\bdv\b/.test(lower)
        ? "DV was discussed, but the current documents do not support a reliable quantified amount."
        : "DV is not determinable from the current documents."),
    dvMissingInputs,
  };
}

function stripMarkdown(value: string): string {
  return value.replace(/^[-*#>\s]+/, "").replace(/\*\*/g, "").trim();
}

function looksLikeOperationSupportLine(line: string): boolean {
  const lower = line.toLowerCase();

  if (
    lower.startsWith("vehicle:") ||
    lower.startsWith("vin:") ||
    lower.startsWith("confidence:") ||
    lower.startsWith("reason:")
  ) {
    return false;
  }

  const mentionsKeyword = OPERATION_KEYWORDS.some((keyword) => lower.includes(keyword));
  const mentionsGap =
    lower.includes("missing") ||
    lower.includes("not shown") ||
    lower.includes("not documented") ||
    lower.includes("not clearly represented") ||
    lower.includes("not clearly supported") ||
    lower.includes("not fully supported") ||
    lower.includes("underwritten") ||
    lower.includes("under-allowed") ||
    lower.includes("lighter on") ||
    lower.includes("less complete") ||
    lower.includes("more complete") ||
    lower.includes("not supported") ||
    lower.includes("requires") ||
    lower.includes("should include") ||
    lower.includes("should document") ||
    lower.includes("omitted") ||
    lower.includes("unclear") ||
    lower.includes("not reflected") ||
    lower.includes("not carried") ||
    lower.includes("replace vs repair") ||
    lower.includes("repair vs replace") ||
    lower.includes("fit-sensitive") ||
    lower.includes("fit sensitive") ||
    lower.includes("should be replaced") ||
    lower.includes("needs documentation") ||
    lower.includes("replace vs repair") ||
    lower.includes("repair vs replace") ||
    lower.includes("fit-sensitive posture") ||
    lower.includes("aftermarket risk") ||
    lower.includes("gap concern") ||
    lower.includes("finish concern") ||
    lower.includes("verification caveat");

  return mentionsKeyword && mentionsGap;
}

function deriveOperationTitles(line: string): string[] {
  const lower = line.toLowerCase();
  const titles: string[] = [];

  if (looksLikeMetaCommentary(line)) {
    return [];
  }
  if (lower.includes("oem") || lower.includes("aftermarket")) {
    titles.push("OEM Fit-Sensitive Part Posture");
  }
  if (lower.includes("lock support")) {
    titles.push("Upper Tie Bar / Lock Support Reconciliation");
  }
  if (
    lower.includes("front structure") ||
    lower.includes("support area") ||
    lower.includes("upper rail") ||
    lower.includes("upper tie bar") ||
    lower.includes("tie bar") ||
    lower.includes("core support")
  ) {
    titles.push("Front Structure Scope / Tie Bar / Upper Rail Reconciliation");
  }
  if (lower.includes("post-repair scan") || lower.includes("post repair scan")) {
    titles.push("Post-Repair Scan");
  }
  if (lower.includes("pre-repair scan") || lower.includes("pre repair scan")) {
    titles.push("Pre-Repair Scan");
  }
  if (lower.includes("steering angle")) {
    titles.push("Steering Angle Sensor Calibration");
  }
  if (lower.includes("fender") && (lower.includes("replace") || lower.includes("repair"))) {
    titles.push("Fender Replace vs Repair Justification");
  }
  if (lower.includes("fit-sensitive") || lower.includes("fit sensitive")) {
    titles.push("OEM Fit-Sensitive Part Posture");
  }
  if (
    (lower.includes("bumper") || lower.includes("lamp") || lower.includes("fender")) &&
    lower.includes("test fit")
  ) {
    titles.push("Pre-Paint Test Fit");
  } else if (lower.includes("test fit")) {
    titles.push("Test Fit / Mock-Up");
  }
  if (lower.includes("coolant") || lower.includes("purge") || lower.includes("bleed") || lower.includes("refill")) {
    titles.push("Coolant Fill and Bleed");
  }
  if (
    lower.includes("adas") ||
    lower.includes("calibration") ||
    lower.includes("procedure support") ||
    lower.includes("camera") ||
    lower.includes("radar") ||
    lower.includes("sensor")
  ) {
    titles.push("ADAS / Calibration Procedure Support");
  }
  if (lower.includes("seat belt")) {
    titles.push("Seat Belt Function Check");
  }
  if (lower.includes("airbag") || lower.includes("srs")) {
    titles.push("SRS / Airbag System Verification");
  }
  if (
    lower.includes("cavity wax") ||
    lower.includes("corrosion protection") ||
    lower.includes("seam sealer") ||
    lower.includes("weld protection")
  ) {
    titles.push("Corrosion Protection / Weld Restoration");
  }
  if (lower.includes("alignment")) {
    titles.push("Four-Wheel Alignment");
  }
  if (lower.includes("setup") || lower.includes("realignment")) {
    titles.push("Structural Setup and Pull Verification");
  }
  if (lower.includes("measure") || lower.includes("measuring") || lower.includes("structural")) {
    titles.push("Structural Measurement Verification");
  }

  return [...new Set(titles)];
}

function inferCategory(line: string): string {
  const lower = line.toLowerCase();

  if (lower.includes("scan") || lower.includes("diagnostic")) return "scan";
  if (
    lower.includes("calibration") ||
    lower.includes("camera") ||
    lower.includes("radar") ||
    lower.includes("sensor")
  ) {
    return "calibration";
  }
  if (
    lower.includes("setup") ||
    lower.includes("measure") ||
    lower.includes("structural") ||
    lower.includes("section") ||
    lower.includes("weld")
  ) {
    return "structural";
  }
  if (lower.includes("seam") || lower.includes("corrosion") || lower.includes("wax")) {
    return "material";
  }

  return "labor";
}

function inferPriority(line: string): "low" | "medium" | "high" {
  const lower = line.toLowerCase();

  if (
    lower.includes("safety") ||
    lower.includes("structural") ||
    lower.includes("setup") ||
    lower.includes("realignment") ||
    lower.includes("tie bar") ||
    lower.includes("lock support") ||
    lower.includes("support area") ||
    lower.includes("upper rail") ||
    lower.includes("core support") ||
    lower.includes("coolant") ||
    lower.includes("test fit") ||
    lower.includes("fit-sensitive") ||
    lower.includes("fit sensitive") ||
    lower.includes("replace vs repair") ||
    lower.includes("repair vs replace") ||
    lower.includes("oem") ||
    lower.includes("aftermarket") ||
    lower.includes("airbag") ||
    lower.includes("seat belt") ||
    lower.includes("critical")
  ) {
    return "high";
  }

  if (
    lower.includes("scan") ||
    lower.includes("calibration") ||
    lower.includes("underwritten") ||
    lower.includes("missing")
  ) {
    return "medium";
  }

  return "low";
}

function findValuationBlock(text: string, keywords: string[]): string | undefined {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => stripMarkdown(part).trim())
    .filter(Boolean);

  const paragraphMatch = paragraphs.find((paragraph) =>
    keywords.some((keyword) => paragraph.toLowerCase().includes(keyword))
  );
  if (paragraphMatch) return paragraphMatch;

  return text
    .split("\n")
    .map((line) => stripMarkdown(line).trim())
    .find((line) => keywords.some((keyword) => line.toLowerCase().includes(keyword)));
}

function extractCurrencyValues(text: string): number[] {
  return [...text.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function splitIntoReasoningUnits(text: string): string[] {
  return text
    .split(/\n|;|\.(?=\s+[A-Z])/)
    .map((part) => sanitizeHumanText(stripMarkdown(part)))
    .filter((part) => part.length > 30);
}

function buildSupplementItemsFromReasoning(line: string): DerivedRenderSupplementItem[] {
  const cleaned = sanitizeHumanText(line);
  const titles = deriveOperationTitles(cleaned);
  const resolvedTitles = titles.length > 0 ? titles : inferFallbackTitles(cleaned);

  return resolvedTitles.map((title) => ({
    title,
    category: inferCategory(`${title} ${cleaned}`),
    kind: inferSupplementKind(`${title} ${cleaned}`),
    rationale: inferItemReason(title, cleaned),
    evidence: undefined,
    source: "Assistant reasoning",
    priority: inferPriority(`${title} ${cleaned}`),
  }));
}

function sanitizeHumanText(value: string): string {
  return value
    .replace(/^[^A-Za-z0-9$]+/, "")
    .replace(/\bshould clearl\b/gi, "should clearly")
    .replace(/\bclearl\b/gi, "clearly")
    .replace(/\b(R&I|RPR|REPL|BLND|REFN|CAL|SCAN)\b(?:\s+\b(R&I|RPR|REPL|BLND|REFN|CAL|SCAN)\b)+/gi, "")
    .replace(/\s+[/:|-]\s*$/g, "")
    .replace(/[:;,\-]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeEstimateNoise(value: string): boolean {
  const lower = value.toLowerCase();
  const estimateTokens = ["r&i", "rpr", "repl", "blnd", "refn", "scan", "cal"];
  const matchCount = estimateTokens.filter((token) => lower.includes(token)).length;
  return matchCount >= 4;
}

function extractReasoningBlocks(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => sanitizeHumanText(stripMarkdown(part)))
    .filter(Boolean);
  const lines = text
    .split("\n")
    .map((line) => sanitizeHumanText(stripMarkdown(line)))
    .filter(Boolean);
  const sentences = splitIntoReasoningUnits(text);

  return [...paragraphs, ...lines, ...sentences].flatMap((entry) => splitOperationalClauses(entry));
}

function splitOperationalClauses(value: string): string[] {
  return value
    .split(/\s+-\s+|,\s+(?=(?:pre|post|test|coolant|corrosion|alignment|scan|calibration|structural|setup|upper|lock|core|seat|airbag))/i)
    .map((part) => sanitizeHumanText(part))
    .filter((part) => part.length > 25 && !looksLikeSectionHeader(part) && !looksLikeMetaCommentary(part));
}

function looksLikeSectionHeader(value: string): boolean {
  const lower = value.toLowerCase().replace(/:$/, "").trim();
  return REPAIR_SECTION_HEADERS.includes(lower);
}

function scoreSupplementCandidate(item: DerivedRenderSupplementItem): number {
  const lower = `${item.title} ${item.rationale}`.toLowerCase();
  let score = item.priority === "high" ? 300 : item.priority === "medium" ? 200 : 100;
  if (item.kind === "missing_operation") score += 45;
  if (item.kind === "underwritten_operation") score += 35;
  if (item.kind === "disputed_repair_path") score += 30;
  if (item.category === "structural") score += 120;
  if (
    lower.includes("front structure") ||
    lower.includes("tie bar") ||
    lower.includes("lock support") ||
    lower.includes("support area") ||
    lower.includes("core support") ||
    lower.includes("upper rail")
  ) score += 125;
  if (lower.includes("replace vs repair") || lower.includes("repair vs replace")) score += 105;
  if (lower.includes("fit-sensitive") || lower.includes("fit sensitive")) score += 100;
  if (lower.includes("adas") || lower.includes("calibration procedure support")) score += 95;
  if (lower.includes("test fit")) score += 100;
  if (lower.includes("coolant") || lower.includes("bleed") || lower.includes("refill")) score += 90;
  if (lower.includes("corrosion") || lower.includes("cavity wax") || lower.includes("seam sealer")) score += 85;
  if (lower.includes("alignment")) score += 80;
  if (lower.includes("scan") || lower.includes("calibration")) score += 50;
  if (lower.includes("not documented") || lower.includes("not clearly") || lower.includes("underwritten")) score += 40;
  if (looksLikeMetaCommentary(item.rationale)) score -= 400;
  score += Math.min(item.rationale.length, 120);
  return score;
}

function explicitlySignalsRange(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("range") ||
    lower.includes("between") ||
    lower.includes("low") && lower.includes("high")
  );
}

function inferSupplementKind(
  line: string
): DerivedRenderSupplementItem["kind"] {
  const lower = line.toLowerCase();

  if (
    lower.includes("verification") ||
    lower.includes("documented measurements") ||
    lower.includes("calibration procedure support") ||
    lower.includes("scan") ||
    lower.includes("alignment") ||
    lower.includes("measuring")
  ) {
    return "missing_verification";
  }

  if (
    lower.includes("missing") ||
    lower.includes("omitted") ||
    lower.includes("not shown") ||
    lower.includes("not carried") ||
    lower.includes("not reflected")
  ) {
    return "missing_operation";
  }

  if (
    lower.includes("underwritten") ||
    lower.includes("not clearly supported") ||
    lower.includes("not clearly represented") ||
    lower.includes("not documented") ||
    lower.includes("needs documentation") ||
    lower.includes("access burden") ||
    lower.includes("test fit burden")
  ) {
    return "underwritten_operation";
  }

  return "disputed_repair_path";
}

function inferItemReason(title: string, line: string): string {
  const lower = line.toLowerCase();

  if (title === "Structural Measurement Verification") {
    return "Frame setup, measuring, or realignment burden appears supportable here, but the current material does not clearly document the measurement process or verification results.";
  }
  if (title === "Structural Setup and Pull Verification") {
    return "The apparent repair path suggests setup, pull, or realignment time, but that structural burden is not clearly supported in the current estimate.";
  }
  if (title === "Fender Replace vs Repair Justification") {
    return "The fender posture still needs a documented replace-versus-repair rationale, especially where mounting alignment, wheel-opening shape, or adjacent support damage could affect final fit.";
  }
  if (title === "OEM Fit-Sensitive Part Posture") {
    return "This front-end repair path appears fit-sensitive, so OEM-versus-aftermarket posture should be documented clearly to address gap, finish, and stack-up risk.";
  }
  if (title === "Front Structure Scope / Tie Bar / Upper Rail Reconciliation") {
    return "Front structure scope, tie bar or upper-rail-related reconciliation, and nearby support-area logic still appear underwritten relative to the likely repair path.";
  }
  if (title === "Upper Tie Bar / Lock Support Reconciliation") {
    return "Upper tie bar or lock-support-related scope still needs a clearer structural rationale, including how the support area will be repaired or reconciled.";
  }
  if (title === "ADAS / Calibration Procedure Support") {
    return "ADAS and calibration support remain incomplete, and the current material does not clearly document the procedure path, required calibrations, or related verification steps.";
  }
  if (title === "Seat Weight / Occupant Classification Calibration") {
    return "Seat-weight or occupant-classification calibration may be relevant, but that verification item should be considered alongside the broader repair-path support issues rather than as the sole conclusion.";
  }
  if (title === "Four-Wheel Alignment") {
    return "Alignment support appears relevant to this repair path, but the current estimate does not clearly show the justification or post-repair documentation.";
  }
  if (title === "Pre-Paint Test Fit") {
    return "Pre-paint test fit burden appears supportable here because final fit and adjacent panel relationships may need to be confirmed before finish work is locked in.";
  }
  if (title === "Corrosion Protection / Weld Restoration") {
    return "Corrosion protection, cavity wax, seam restoration, or weld-protection steps are not clearly documented even though the repair path appears to support them.";
  }
  if (title === "Coolant Fill and Bleed") {
    return "Cooling-system refill, bleed, or related access burden appears supportable here, but the current estimate does not clearly carry that operation.";
  }

  if (lower.includes("not documented") || lower.includes("not clearly")) {
    return sanitizeHumanText(line);
  }

  return "This issue appears supportable in the likely repair path, but the current material does not clearly document the required rationale, process, or verification.";
}

function inferFallbackTitles(line: string): string[] {
  const lower = line.toLowerCase();
  const titles: string[] = [];

  if (lower.includes("aftermarket") || lower.includes("oem")) {
    titles.push("OEM Fit-Sensitive Part Posture");
  }
  if (lower.includes("fender") && (lower.includes("repair") || lower.includes("replace"))) {
    titles.push("Fender Replace vs Repair Justification");
  }
  if (
    lower.includes("tie bar") ||
    lower.includes("lock support") ||
    lower.includes("upper rail") ||
    lower.includes("front structure") ||
    lower.includes("support area")
  ) {
    titles.push("Front Structure Scope / Tie Bar / Upper Rail Reconciliation");
  }
  if (lower.includes("setup") || lower.includes("measure") || lower.includes("realignment")) {
    titles.push("Structural Setup and Pull Verification");
    titles.push("Structural Measurement Verification");
  }
  if (
    lower.includes("adas") ||
    lower.includes("calibration") ||
    lower.includes("camera") ||
    lower.includes("radar") ||
    lower.includes("sensor")
  ) {
    titles.push("ADAS / Calibration Procedure Support");
  }
  if (lower.includes("alignment")) {
    titles.push("Four-Wheel Alignment");
  }

  return [...new Set(titles)];
}

function looksLikeMetaCommentary(value: string): boolean {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return true;

  if (
    META_COMMENTARY_PATTERNS.some((pattern) => normalized.includes(pattern.replace(/[^a-z0-9\s]/g, " ")))
  ) {
    return true;
  }

  return (
    !normalized.includes("test fit") &&
    !normalized.includes("alignment") &&
    !normalized.includes("scan") &&
    !normalized.includes("calibration") &&
    !normalized.includes("coolant") &&
    !normalized.includes("tie bar") &&
    !normalized.includes("lock support") &&
    !normalized.includes("core support") &&
    !normalized.includes("cavity wax") &&
    !normalized.includes("corrosion") &&
    !normalized.includes("fender") &&
    !normalized.includes("bumper") &&
    !normalized.includes("lamp") &&
    normalized.includes("repair strategy")
  );
}

function scoreNarrativeParagraph(value: string): number {
  const lower = value.toLowerCase();
  let score = value.length;
  if (lower.includes("underwritten")) score += 80;
  if (lower.includes("more complete")) score += 70;
  if (lower.includes("carrier estimate")) score += 50;
  if (lower.includes("shop estimate")) score += 50;
  if (lower.includes("repair path")) score += 40;
  if (lower.includes("materially")) score += 30;
  if (lower.includes("support")) score += 20;
  if (looksLikeMetaCommentary(value)) score -= 120;
  return score;
}
