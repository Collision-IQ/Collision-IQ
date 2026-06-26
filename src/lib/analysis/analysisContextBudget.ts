import type { StoredAttachment } from "@/lib/uploadedAttachmentStore";

export type AnalysisDocumentClass =
  | "carrier_estimate"
  | "shop_estimate"
  | "supplement"
  | "policy_document"
  | "generated_report_artifact"
  | "oem_documentation"
  | "p_page_database"
  | "work_authorization"
  | "invoice_or_sublet"
  | "photo_or_scan"
  | "other_supporting_document";

export type AnalysisContextToolTrace = Array<{
  tool: string;
  status: "success" | "skipped" | "error";
  reason?: string;
  query?: string;
  resultCount?: number;
}>;

export type AnalysisContextBudgetDiagnostics = {
  rawAttachmentTextChars: number;
  selectedContextTextChars: number;
  droppedContextChars: number;
  contextBudgetLimit: number;
  contextReductionApplied: boolean;
  generatedReportArtifactExcluded: boolean;
  retryAfterContextError: boolean;
  attachmentClassifications: Array<{
    id: string;
    filename: string;
    documentClass: AnalysisDocumentClass;
    rawTextChars: number;
    selectedTextChars: number;
    excludedAsPrimary: boolean;
    reason?: string;
  }>;
  policyExtractionConfidence: "high" | "medium" | "low" | "failed" | "not_run";
  policyVehicleMismatch: string | null;
  authoritySearchQueries: string[];
  toolUsageTrace: AnalysisContextToolTrace;
};

const DEFAULT_OPENAI_ANALYSIS_CONTEXT_CHAR_LIMIT = 60000;
// Claude opus-4-8 ships a 1M-token context window, so the analysis pipeline can
// keep far more evidence in context than the legacy OpenAI budget allowed. This
// directly improves report completeness (fewer "falsely missing" evidence items
// and broader citation-density coverage).
const DEFAULT_ANTHROPIC_ANALYSIS_CONTEXT_CHAR_LIMIT = 220000;
const GENERATED_REPORT_NOTE_LIMIT = 900;
const LONG_DOC_CHUNK_SIZE = 2400;
const LONG_DOC_CHUNK_OVERLAP = 180;

export function resolveAnalysisContextBudgetLimit(params: {
  provider?: string | null;
  model?: string | null;
}) {
  const provider = params.provider?.toLowerCase() || "anthropic";
  const model = params.model?.toLowerCase() || "";
  if (provider === "openai" && /mini/.test(model)) return DEFAULT_OPENAI_ANALYSIS_CONTEXT_CHAR_LIMIT;
  if (provider === "openai") return 80000;
  if (provider === "anthropic") return DEFAULT_ANTHROPIC_ANALYSIS_CONTEXT_CHAR_LIMIT;
  return DEFAULT_ANTHROPIC_ANALYSIS_CONTEXT_CHAR_LIMIT;
}

export function applyAnalysisContextBudget(params: {
  attachments: StoredAttachment[];
  userIntent?: string | null;
  provider?: string | null;
  model?: string | null;
  contextBudgetLimit?: number;
  forceAggressive?: boolean;
}): {
  attachments: StoredAttachment[];
  diagnostics: AnalysisContextBudgetDiagnostics;
} {
  const limit = params.contextBudgetLimit ?? resolveAnalysisContextBudgetLimit({
    provider: params.provider,
    model: params.model,
  });
  const rawAttachmentTextChars = params.attachments.reduce((sum, attachment) => sum + attachment.text.length, 0);
  const classes = params.attachments.map((attachment) => ({
    attachment,
    documentClass: classifyAnalysisAttachment(attachment),
  }));
  const activeEstimateVehicle = inferActiveEstimateVehicle(classes);
  const authoritySearchQueries = buildAuthoritySearchQueries(params.userIntent ?? "", classes);
  const toolUsageTrace: AnalysisContextToolTrace = [
    {
      tool: "document_classifier",
      status: "success",
      resultCount: classes.length,
    },
    {
      tool: "context_budget_manager",
      status: "success",
      reason: params.forceAggressive ? "Aggressive context reduction requested after provider context error." : undefined,
    },
    authoritySearchQueries.length
      ? {
          tool: "google_drive_internal_query_generation",
          status: "success",
          resultCount: authoritySearchQueries.length,
          query: authoritySearchQueries.join(" | "),
        }
      : {
          tool: "google_drive_internal_query_generation",
          status: "skipped",
          reason: "No OEM, policy, CCC/MOTOR/P-page, ADAS, warranty, wheel/hub, Tesla/EV, or procedure query terms detected.",
        },
  ];

  const budgeted = classes.map(({ attachment, documentClass }) => {
    const policyDiagnostic = documentClass === "policy_document"
      ? extractPolicyBudgetDiagnostic(attachment.text, activeEstimateVehicle)
      : null;
    const text = buildBudgetedAttachmentText({
      attachment,
      documentClass,
      userIntent: params.userIntent ?? "",
      policyMismatchWarning: policyDiagnostic?.vehicleMismatchWarning ?? null,
      forceAggressive: params.forceAggressive === true,
    });
    return {
      attachment,
      documentClass,
      policyDiagnostic,
      budgetedAttachment: {
        ...attachment,
        text,
      },
    };
  });

  const globallyReduced = reduceToGlobalBudget(
    budgeted.map((item) => item.budgetedAttachment),
    limit
  );
  const selectedContextTextChars = globallyReduced.reduce((sum, attachment) => sum + attachment.text.length, 0);
  const generatedReportArtifactExcluded = budgeted.some((item) =>
    item.documentClass === "generated_report_artifact" &&
    item.attachment.text.length > item.budgetedAttachment.text.length
  );
  const policyDiagnostic = budgeted.find((item) => item.policyDiagnostic)?.policyDiagnostic ?? null;

  return {
    attachments: globallyReduced,
    diagnostics: {
      rawAttachmentTextChars,
      selectedContextTextChars,
      droppedContextChars: Math.max(0, rawAttachmentTextChars - selectedContextTextChars),
      contextBudgetLimit: limit,
      contextReductionApplied: selectedContextTextChars < rawAttachmentTextChars,
      generatedReportArtifactExcluded,
      retryAfterContextError: params.forceAggressive === true,
      attachmentClassifications: budgeted.map((item) => {
        const selected = globallyReduced.find((attachment) => attachment.id === item.attachment.id);
        return {
          id: item.attachment.id,
          filename: item.attachment.filename,
          documentClass: item.documentClass,
          rawTextChars: item.attachment.text.length,
          selectedTextChars: selected?.text.length ?? 0,
          excludedAsPrimary: item.documentClass === "generated_report_artifact",
          reason: item.documentClass === "generated_report_artifact"
            ? "Generated Collision IQ report artifacts are excluded as primary evidence unless explicitly audited."
            : item.policyDiagnostic?.vehicleMismatchWarning ?? undefined,
        };
      }),
      policyExtractionConfidence: policyDiagnostic?.confidence ?? "not_run",
      policyVehicleMismatch: policyDiagnostic?.vehicleMismatchWarning ?? null,
      authoritySearchQueries,
      toolUsageTrace,
    },
  };
}

export function classifyAnalysisAttachment(attachment: StoredAttachment): AnalysisDocumentClass {
  const haystack = `${attachment.filename}\n${attachment.type}\n${attachment.text}`.toLowerCase();
  if (isGeneratedCollisionIqReport(haystack)) return "generated_report_artifact";
  if (/\b(policy|declarations?|endorsement|coverage|deductible|if we cannot agree|payment of loss|appraisal)\b/.test(haystack)) {
    return "policy_document";
  }
  if (/\b(work auth|work authorization|authorization to repair|power of attorney|direction to pay)\b/.test(haystack)) {
    return "work_authorization";
  }
  if (/\b(ccc|motor|p-?page|database|included|not included|deg|estimating guide)\b/.test(haystack)) {
    return "p_page_database";
  }
  if (/\b(oem|repair procedure|position statement|service manual|tesla service)\b/.test(haystack)) {
    return "oem_documentation";
  }
  if (/\b(shop|repair facility|body shop)\b/.test(haystack) && /\bestimate\b/.test(haystack)) return "shop_estimate";
  if (/\b(carrier|insurer|insurance|allstate|geico|progressive|state farm|sor\d*)\b/.test(haystack) && /\b(estimate|supplement|sor)\b/.test(haystack)) {
    return /\bsupp(?:lement)?|sor\d*\b/.test(haystack) ? "supplement" : "carrier_estimate";
  }
  if (/\b(supplement|sor\d*)\b/.test(haystack)) return "supplement";
  if (/\b(invoice|sublet|receipt|bill|repair order|mount\/balance|alignment)\b/.test(haystack)) return "invoice_or_sublet";
  if (attachment.type.startsWith("image/") || /\b(scan report|calibration report|photo)\b/.test(haystack)) return "photo_or_scan";
  return "other_supporting_document";
}

function buildBudgetedAttachmentText(params: {
  attachment: StoredAttachment;
  documentClass: AnalysisDocumentClass;
  userIntent: string;
  policyMismatchWarning: string | null;
  forceAggressive: boolean;
}) {
  const { attachment, documentClass } = params;
  const maxChars = params.forceAggressive
    ? Math.floor(getPerDocumentLimit(documentClass) * 0.55)
    : getPerDocumentLimit(documentClass);
  if (documentClass === "generated_report_artifact") {
    return [
      "Generated Collision IQ report artifact excluded as primary evidence.",
      `Filename: ${attachment.filename}`,
      "Use only if the user explicitly asks to audit the generated report.",
      "Original generated report body omitted from analysis context to prevent recursive evidence inflation.",
    ].join("\n");
  }
  if (documentClass === "policy_document") {
    return [
      "POLICY DOCUMENT STRUCTURED FACTS",
      extractPolicyStructuredFacts(attachment.text),
      params.policyMismatchWarning ? `WARNING: ${params.policyMismatchWarning}` : null,
      selectRelevantChunks(attachment.text, params.userIntent, maxChars),
    ].filter(Boolean).join("\n\n");
  }
  if (attachment.text.length <= maxChars) return attachment.text;
  return [
    `DOCUMENT SUMMARY: ${attachment.filename}`,
    summarizeTextFacts(attachment.text, Math.min(1400, Math.floor(maxChars * 0.25))),
    "SELECTED RELEVANT EXCERPTS",
    selectRelevantChunks(attachment.text, params.userIntent, maxChars - 1600),
  ].join("\n\n");
}

function getPerDocumentLimit(documentClass: AnalysisDocumentClass) {
  switch (documentClass) {
    case "shop_estimate":
    case "carrier_estimate":
    case "supplement":
      return 14000;
    case "policy_document":
      return 9000;
    case "p_page_database":
    case "oem_documentation":
      return 8000;
    case "invoice_or_sublet":
      return 5500;
    case "generated_report_artifact":
      return GENERATED_REPORT_NOTE_LIMIT;
    default:
      return 4200;
  }
}

function reduceToGlobalBudget(attachments: StoredAttachment[], limit: number) {
  let remaining = limit;
  return attachments.map((attachment) => {
    if (remaining <= 0) {
      return {
        ...attachment,
        text: `Context omitted after budget limit reached. Filename: ${attachment.filename}`,
      };
    }
    if (attachment.text.length <= remaining) {
      remaining -= attachment.text.length;
      return attachment;
    }
    const truncated = `${attachment.text.slice(0, Math.max(0, remaining - 160))}\n[Context truncated by analysis budget manager.]`;
    remaining = 0;
    return {
      ...attachment,
      text: truncated,
    };
  });
}

function selectRelevantChunks(text: string, userIntent: string, maxChars: number) {
  const chunks = chunkText(text);
  const queryTerms = buildQueryTerms(userIntent);
  const scored = chunks
    .map((chunk, index) => ({
      chunk,
      index,
      score: scoreChunk(chunk, queryTerms, index),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: string[] = [];
  let used = 0;
  for (const item of scored) {
    if (used >= maxChars) break;
    const next = item.chunk.slice(0, Math.max(0, maxChars - used));
    if (!next.trim()) continue;
    selected.push(next);
    used += next.length;
  }
  return selected.join("\n\n--- selected chunk ---\n\n");
}

function chunkText(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const chunks: string[] = [];
  for (let index = 0; index < normalized.length; index += LONG_DOC_CHUNK_SIZE - LONG_DOC_CHUNK_OVERLAP) {
    chunks.push(normalized.slice(index, index + LONG_DOC_CHUNK_SIZE));
  }
  return chunks.length ? chunks : [normalized];
}

function buildQueryTerms(userIntent: string) {
  const base = userIntent.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  const domain = [
    "tesla", "ev", "adas", "calibration", "radar", "camera", "sensor",
    "wheel", "hub", "bearing", "suspension", "steering", "lkq", "capa",
    "aftermarket", "warranty", "crash", "policy", "deductible", "appraisal",
    "motor", "ccc", "p-page", "sand", "polish", "battery", "reset",
  ];
  return [...new Set([...base, ...domain])];
}

function scoreChunk(chunk: string, queryTerms: string[], index: number) {
  const lower = chunk.toLowerCase();
  let score = index === 0 ? 4 : 0;
  for (const term of queryTerms) {
    if (term.length > 2 && lower.includes(term)) score += 3;
  }
  if (/\b(total|line\s+\d+|estimate|supplement|policy number|vin|deductible|appraisal|if we cannot agree)\b/i.test(chunk)) score += 8;
  return score;
}

function summarizeTextFacts(text: string, maxChars: number) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .filter((line) => /\b(?:vehicle|vin|estimate|total|line|policy|deductible|appraisal|wheel|hub|adas|calibration|battery|sand|polish|oem|ccc|motor|warranty)\b/i.test(line))
    .slice(0, 40)
    .join("\n");
  const summary = lines || text.replace(/\s+/g, " ").trim();
  return summary.slice(0, maxChars);
}

function isGeneratedCollisionIqReport(haystack: string) {
  return /\b(citation density|oem citation density|repair intelligence report|collision iq|annotation legend|unanchored citation density|finding details|customer report|policy rights review|doi complaint packet)\b/.test(haystack);
}

function buildAuthoritySearchQueries(userIntent: string, classes: Array<{ attachment: StoredAttachment; documentClass: AnalysisDocumentClass }>) {
  const text = `${userIntent}\n${classes.map((item) => `${item.attachment.filename}\n${item.attachment.text.slice(0, 3000)}`).join("\n")}`;
  const queries: string[] = [];
  const add = (query: string) => {
    if (!queries.includes(query)) queries.push(query);
  };
  if (/\b(?:tesla|ev|model y|model 3|high voltage)\b/i.test(text)) add("Tesla EV OEM repair procedure ADAS calibration high voltage wheel suspension");
  if (/\b(?:ccc|motor|p-?page|denib|sand|polish|buff|refinish correction)\b/i.test(text)) add("CCC MOTOR P-page finish sand polish denib color sand buff refinish correction");
  if (/\b(?:a\/m|aftermarket|lkq|capa|warranty|crash-test|crash test|sensor alignment)\b/i.test(text)) add("AM LKQ CAPA aftermarket warranty ADAS crash-tested equivalency manufacturer warranty");
  if (/\b(?:wheel|hub|bearing|suspension|steering)\b/i.test(text)) add("OEM wheel hub bearing suspension steering wheel-end procedure safety");
  if (/\b(?:policy|declarations|appraisal|if we cannot agree|payment of loss|deductible)\b/i.test(text)) add("policy appraisal if we cannot agree payment of loss deductible vehicle declarations");
  if (/\b(?:battery|reset electronics|disconnect|reconnect|12v|state of charge)\b/i.test(text)) add("OEM battery disconnect reconnect reset electronics 12V HV state of charge procedure");
  return queries.slice(0, 6);
}

function inferActiveEstimateVehicle(classes: Array<{ attachment: StoredAttachment; documentClass: AnalysisDocumentClass }>) {
  const estimate = classes.find((item) =>
    item.documentClass === "carrier_estimate" ||
    item.documentClass === "shop_estimate" ||
    item.documentClass === "supplement"
  );
  return estimate ? extractVehicleLabel(estimate.attachment.text) : null;
}

function extractPolicyBudgetDiagnostic(policyText: string, activeEstimateVehicle: string | null) {
  const confidence = isGarbled(policyText)
    ? "failed"
    : /\b(policy|declarations?|deductible|appraisal|vin)\b/i.test(policyText)
      ? "high"
      : "low";
  const policyVehicle = extractVehicleLabel(policyText);
  const warning = policyVehicle && activeEstimateVehicle && !vehicleLabelsMatch(policyVehicle, activeEstimateVehicle)
    ? `Policy uploaded, but it appears to insure ${policyVehicle}. Active estimate appears to be ${activeEstimateVehicle}. Confirm applicability before relying on policy language.`
    : null;
  return { confidence: confidence as "high" | "medium" | "low" | "failed", vehicleMismatchWarning: warning };
}

function extractPolicyStructuredFacts(text: string) {
  if (isGarbled(text)) {
    return "- Policy document exists, but structured facts were not confidently extracted. OCR/image extraction fallback or encoding repair is needed before relying on policy language.";
  }
  const clean = text.replace(/\s+/g, " ");
  const fields = [
    ["Policy number", clean.match(/\bpolicy\s*(?:number|no\.?|#)\s*[:#]?\s*([A-Z0-9-]{4,})/i)?.[1]],
    ["Claim number", clean.match(/\bclaim\s*(?:number|no\.?|#)\s*[:#]?\s*([A-Z0-9-]{4,})/i)?.[1]],
    ["Effective dates", clean.match(/\b(?:effective|policy period)\b[^.:\n]{0,40}[: ]\s*([A-Za-z0-9 ,/-]{8,60})/i)?.[1]],
    ["Insured vehicle", extractVehicleLabel(clean)],
    ["VIN", clean.match(/\bVIN\b\s*[:#]?\s*([A-HJ-NPR-Z0-9]{11,17})/i)?.[1]],
    ["Collision deductible", clean.match(/\bcollision\b[^$]{0,80}(\$[\d,]+)/i)?.[1]],
    ["Comprehensive deductible", clean.match(/\bcomprehensive\b[^$]{0,80}(\$[\d,]+)/i)?.[1]],
    ["Appraisal/payment sections", ["appraisal", "right to appraisal", "if we cannot agree", "payment of loss"].filter((term) => new RegExp(term.replace(/\s+/g, "\\s+"), "i").test(clean)).join(", ")],
    ["Action against insurer", /\baction against (?:us|insurer|company)\b/i.test(clean) ? "found" : null],
    ["Governing law/jurisdiction", clean.match(/\b(?:governing law|jurisdiction|laws of)\b[^.]{0,90}/i)?.[0]],
    ["Policy forms/endorsements", [...clean.matchAll(/\b(?:form|endorsement)\s+([A-Z0-9-]{3,})/gi)].map((match) => match[1]).slice(0, 12).join(", ")],
  ];
  return fields
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`)
    .join("\n") || "- Policy document exists, but structured facts were not confidently extracted. OCR/image extraction fallback may be needed.";
}

function extractVehicleLabel(text: string) {
  const explicit = text.match(/\b(?:vehicle|auto|insured vehicle|covered auto)\b[^.:\n]{0,50}[: ]\s*((?:19|20)\d{2}\s+[A-Z][A-Za-z-]+(?:\s+[A-Za-z0-9-]+){0,4}(?:\s+VIN\s+[A-HJ-NPR-Z0-9]{11,17})?)/i)?.[1];
  if (explicit) return explicit.trim();
  const vehicle = text.match(/\b((?:19|20)\d{2}\s+(?:Tesla|Jeep|Ford|Chevrolet|Chevy|GMC|Honda|Toyota|Nissan|Hyundai|Kia|BMW|Mercedes|Audi|Volkswagen|Ram|Dodge|Subaru|Mazda|Lexus|Acura|Rivian|Lucid)\s+[A-Za-z0-9-]+(?:\s+[A-Za-z0-9-]+){0,3})\b/i)?.[1];
  const vin = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i)?.[1];
  return vehicle ? `${vehicle}${vin ? ` VIN ${vin}` : ""}` : vin ? `VIN ${vin}` : null;
}

function vehicleLabelsMatch(a: string, b: string) {
  const vinA = a.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0];
  const vinB = b.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0];
  if (vinA && vinB) return vinA.toUpperCase() === vinB.toUpperCase();
  const tokensA = normalizeVehicleTokens(a);
  const tokensB = new Set(normalizeVehicleTokens(b));
  return tokensA.filter((token) => tokensB.has(token)).length >= Math.min(3, tokensA.length);
}

function normalizeVehicleTokens(value: string) {
  return value.toLowerCase().match(/[a-z0-9]{2,}/g)?.filter((token) => !/^vin$/.test(token)).slice(0, 6) ?? [];
}

function isGarbled(text: string) {
  const mojibake = (text.match(/(?:Ã|Â|â€|â€™|â€œ|â€|ï¿½|�)/g) ?? []).length;
  return mojibake >= 3;
}
