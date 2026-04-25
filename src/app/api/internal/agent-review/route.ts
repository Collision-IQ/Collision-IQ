import { NextRequest, NextResponse } from "next/server";
import { assertCompliantOutput } from "@/lib/ai/policy/assertCompliantOutput";
import { sanitizeOutput } from "@/lib/ai/policy/sanitizeOutput";
import { SAFE_ANALYSIS_RULES } from "@/lib/ai/policy/agentRules";
import { runEstimateAgent } from "@/lib/ai/agents/estimateAgent";
import { runADASAgent } from "@/lib/ai/agents/adasAgent";
import { runProcedureAgent } from "@/lib/ai/agents/procedureAgent";
import { runSupplementAgent } from "@/lib/ai/agents/supplementAgent";
import type { AgentFindingEnhanced } from "@/lib/ai/types/analysis";
import {
  buildClaimFingerprint,
  buildEvidenceMap,
  buildReportAgenda,
  countGenericNarrativePhrases,
  shouldIncludeFinding,
  suppressGenericNarratives,
  type ClaimFingerprint,
  type EvidenceMap,
  type GatedFinding,
} from "@/lib/ai/claimFingerprint";
import { extractEstimateOps, parseEstimate } from "@/lib/ai/extractors/estimateExtractor";
import {
  extractComparisonFacts,
  type ComparisonFacts,
} from "@/lib/ai/extractors/comparisonExtractor";
import { extractOemRequirements } from "@/lib/ai/extractors/oemProcedureExtractor";

type RetrievedDocumentSource = "google-drive" | "web";

type RetrievedDocument = {
  source: RetrievedDocumentSource;
  title: string;
  url?: string;
  text?: string;
  metadata?: Record<string, unknown>;
};

type AgentReviewRequestBody = {
  caseId?: unknown;
  jurisdiction?: unknown;
  mode?: unknown;
  userQuery?: unknown;
  shopEstimateText?: unknown;
  insurerEstimateText?: unknown;
  oemProcedureText?: unknown;
  retrievedDocuments?: unknown;
};

type GatedAgentResult = {
  ok: boolean;
  error?: string;
  data: GatedFinding[];
  genericPhraseSuppressionCount: number;
  suppressedFindings: Array<{
    issue: string;
    reasonExcluded: string;
  }>;
};

type RetrievalSummary = {
  driveDocsUsed: number;
  webSourcesUsed: number;
  serperStatus: "SUCCESS" | "FAILED" | "NOT_RUN";
  oemEvidenceFound: boolean;
  sourcesInfluencingFindings: Array<{
    title: string;
    sourceType: "drive" | "web" | "oem" | "estimate";
    url?: string;
    relatedFindingIds: string[];
  }>;
};

type DisputeStrategy = {
  leverageScore: number;
  priorityFindings: string[];
  easyWins: string[];
  hardFights: string[];
  recommendedSequence: string[];
};

function safeJson(payload: unknown, init?: ResponseInit) {
  const safe = sanitizeOutput(payload);
  assertCompliantOutput(safe);
  return NextResponse.json(safe, init);
}

function unwrapGated(
  result: PromiseSettledResult<unknown>,
  agent: string,
  fingerprint: ClaimFingerprint,
  evidenceMap: EvidenceMap
): GatedAgentResult {
  if (result.status === "rejected") {
    return {
      ok: false,
      error: `${agent}_failed`,
      data: [],
      genericPhraseSuppressionCount: 0,
      suppressedFindings: [],
    };
  }

  const enhancedFindings = extractEnhancedFindings(result.value);
  const genericPhraseSuppressionCount = countGenericNarrativePhrases(
    enhancedFindings.flatMap((finding) => [
      finding.issue,
      finding.finding,
      finding.secondLevelReasoning,
      finding.thirdLevelAction,
    ])
  );
  const rewrittenFindings = suppressGenericNarratives(enhancedFindings, fingerprint);
  const gatedFindings = rewrittenFindings.map((finding, index) => ({
    ...shouldIncludeFinding(finding, fingerprint, evidenceMap),
    id: `${agent}-${index + 1}-${slugify(finding.issue)}`,
  }));

  return {
    ok: true,
    data: gatedFindings.filter((finding) => finding.include),
    genericPhraseSuppressionCount,
    suppressedFindings: gatedFindings
      .filter((finding) => !finding.include)
      .map((finding) => ({
        issue: finding.issue,
        reasonExcluded: finding.reasonExcluded ?? "Excluded by claim-specific gate.",
      })),
  };
}

function extractEnhancedFindings(value: unknown): AgentFindingEnhanced[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractEnhancedFindings(item));
  }

  if (!isPlainObject(value)) {
    return [];
  }

  const enhanced = value.enhanced;
  if (isAgentFindingEnhanced(enhanced)) {
    return [enhanced];
  }

  if (Array.isArray(enhanced)) {
    return enhanced.filter(isAgentFindingEnhanced);
  }

  return Object.values(value).flatMap((item) => extractEnhancedFindings(item));
}

function isAgentFindingEnhanced(value: unknown): value is AgentFindingEnhanced {
  return (
    isPlainObject(value) &&
    typeof value.issue === "string" &&
    typeof value.finding === "string" &&
    typeof value.confidence === "number" &&
    typeof value.secondLevelReasoning === "string" &&
    typeof value.thirdLevelAction === "string"
  );
}

function collectSuppressedFindings(
  findings: Record<string, GatedAgentResult>
) {
  return Object.values(findings).flatMap((entry) => entry.suppressedFindings);
}

function collectIncludedFindings(findings: Record<string, GatedAgentResult>): GatedFinding[] {
  return Object.values(findings).flatMap((entry) => entry.data);
}

function collectGenericPhraseSuppressionCount(findings: Record<string, GatedAgentResult>): number {
  return Object.values(findings).reduce(
    (count, entry) => count + entry.genericPhraseSuppressionCount,
    0
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRetrievedDocuments(input: unknown): RetrievedDocument[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized: RetrievedDocument[] = [];

  for (const item of input) {
    if (!isPlainObject(item)) {
      continue;
    }

    const source =
      item.source === "google-drive" || item.source === "web"
        ? item.source
        : null;
    const title = typeof item.title === "string" ? item.title.trim() : "";

    if (!source || !title) {
      continue;
    }

    normalized.push({
      source,
      title,
      url: typeof item.url === "string" ? item.url : undefined,
      text: typeof item.text === "string" ? item.text : undefined,
      metadata: isPlainObject(item.metadata) ? item.metadata : undefined,
    });
  }

  return normalized;
}

function buildRetrievalImpact(
  documents: RetrievedDocument[],
  baseFacts: ComparisonFacts,
  enrichedFacts: ComparisonFacts
) {
  const webDocuments = documents.filter((d) => d.source === "web");
  const driveDocuments = documents.filter((d) => d.source === "google-drive");

  const serperWorked = webDocuments.some(
    (d) => d.metadata?.sourceType === "serper"
  );

  const allText = documents
    .map((d) => `${d.title}\n${d.text ?? ""}`)
    .join("\n")
    .toLowerCase();

  const oemSourcesFound =
    /oem|position statement|procedure|i-car|automaker/.test(allText);
  const legalSourcesFound =
    /statute|regulation|insurance code|commissioner|bad faith/.test(allText);

  const changedFindings: string[] = [];
  if (!baseFacts.insurer.preScan && enrichedFacts.insurer.preScan) {
    changedFindings.push("pre-repair scan");
  }
  if (!baseFacts.insurer.cavityWax && enrichedFacts.insurer.cavityWax) {
    changedFindings.push("corrosion protection");
  }
  if (!baseFacts.insurer.calibrationTransport && enrichedFacts.insurer.calibrationTransport) {
    changedFindings.push("calibration transport");
  }

  return {
    driveDocumentsUsed: driveDocuments.length,
    webDocumentsUsed: webDocuments.length,
    serperWorked,
    oemSourcesFound,
    legalSourcesFound,
    changedFindings,
    webRetrievalNote:
      webDocuments.length === 0
        ? "Public web/OEM retrieval returned no usable results for this run."
        : null,
  };
}

function buildRetrievalSummary(
  includedFindings: GatedFinding[],
  documents: RetrievedDocument[],
  evidenceMap: EvidenceMap
): RetrievalSummary {
  const sources = new Map<string, RetrievalSummary["sourcesInfluencingFindings"][number]>();
  const influencedDriveDocs = new Set<string>();
  const influencedWebDocs = new Set<string>();
  let serperInfluenced = false;
  const addSource = (
    key: string,
    source: RetrievalSummary["sourcesInfluencingFindings"][number]
  ) => {
    const existing = sources.get(key);
    if (existing) {
      existing.relatedFindingIds = unique([
        ...existing.relatedFindingIds,
        ...source.relatedFindingIds,
      ]);
      return;
    }
    sources.set(key, source);
  };

  for (const finding of includedFindings) {
    const findingId = finding.id ?? slugify(finding.issue);
    if (finding.sourceSupport.includes("estimate")) {
      addSource("estimate", {
        title: "Current estimate text",
        sourceType: "estimate",
        relatedFindingIds: [findingId],
      });
    }

    for (const document of documents) {
      if (!documentInfluencesFinding(document, finding, evidenceMap)) {
        continue;
      }
      const isOem = isOemDocument(document);
      const sourceType = isOem ? "oem" : document.source === "google-drive" ? "drive" : "web";
      if (document.source === "google-drive") {
        influencedDriveDocs.add(`${document.title}:${document.url ?? ""}`);
      }
      if (document.source === "web") {
        influencedWebDocs.add(`${document.title}:${document.url ?? ""}`);
      }
      if (document.metadata?.sourceType === "serper") {
        serperInfluenced = true;
      }
      addSource(`${sourceType}:${document.title}:${document.url ?? ""}`, {
        title: document.title,
        sourceType,
        url: document.url,
        relatedFindingIds: [findingId],
      });
    }
  }

  const influencingSources = Array.from(sources.values());
  const serperAttempted = documents.some((document) =>
    document.metadata?.sourceType === "serper" ||
    document.metadata?.serperStatus === "SUCCESS" ||
    document.metadata?.serperStatus === "FAILED" ||
    document.metadata?.serperStatus === "ERROR"
  );
  return {
    driveDocsUsed: influencedDriveDocs.size,
    webSourcesUsed: influencedWebDocs.size,
    serperStatus: serperInfluenced ? "SUCCESS" : serperAttempted ? "FAILED" : "NOT_RUN",
    oemEvidenceFound: influencingSources.some((source) => source.sourceType === "oem"),
    sourcesInfluencingFindings: influencingSources.slice(0, 10),
  };
}

function buildDisputeStrategy(includedFindings: GatedFinding[]): DisputeStrategy {
  const scored = includedFindings
    .map((finding) => ({
      finding,
      score: scoreFindingLeverage(finding),
    }))
    .sort((a, b) => b.score - a.score);

  const easyWins = scored
    .filter(({ finding, score }) =>
      score >= 72 &&
      (finding.evidenceLevel === "documented" || finding.evidenceLevel === "referenced") &&
      finding.claimSpecificity !== "low"
    )
    .map(({ finding }) => finding.issue)
    .slice(0, 5);
  const hardFights = scored
    .filter(({ finding, score }) =>
      score < 72 ||
      finding.evidenceLevel === "inferred" ||
      finding.confidence < 0.7 ||
      /procedure|fit|refinish|polish|calibration transport/i.test(finding.issue)
    )
    .map(({ finding }) => finding.issue)
    .filter((issue) => !easyWins.includes(issue))
    .slice(0, 5);

  return {
    leverageScore: scored.length === 0
      ? 0
      : Math.round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length),
    priorityFindings: scored.map(({ finding }) => finding.issue).slice(0, 5),
    easyWins,
    hardFights,
    recommendedSequence: scored
      .map(({ finding }) => finding.next_action || finding.thirdLevelAction || finding.issue)
      .slice(0, 5),
  };
}

function documentInfluencesFinding(
  document: RetrievedDocument,
  finding: GatedFinding,
  evidenceMap: EvidenceMap
): boolean {
  if (
    document.source === "google-drive" &&
    !finding.sourceSupport.includes("google-drive")
  ) {
    return false;
  }
  if (
    document.source === "web" &&
    !finding.sourceSupport.includes("web") &&
    !finding.sourceSupport.includes("serper")
  ) {
    return false;
  }

  const documentText = `${document.title}\n${document.text ?? ""}`.toLowerCase();
  const directSignals = finding.evidenceSignals.some((signal) =>
    signal.length > 3 && documentText.includes(signal.toLowerCase())
  );
  if (directSignals) {
    return true;
  }

  const issueLower = finding.issue.toLowerCase();
  const categorySignals = Object.entries(evidenceMap.corpusSignals)
    .filter(([category]) => issueLower.includes(category.toLowerCase().replace(/signals$/, "")))
    .flatMap(([, signals]) => signals);

  return categorySignals.some((signal) =>
    signal.length > 3 && documentText.includes(signal.toLowerCase())
  );
}

function isOemDocument(document: RetrievedDocument): boolean {
  const text = `${document.title}\n${document.text ?? ""}`.toLowerCase();
  return /\b(oem|position statement|repair procedure|service manual|automaker|i-car)\b/.test(text);
}

function scoreFindingLeverage(finding: GatedFinding): number {
  const evidenceScore =
    finding.evidenceLevel === "documented" ? 30 :
    finding.evidenceLevel === "referenced" ? 24 :
    finding.evidenceLevel === "inferred" ? 12 :
    4;
  const confidenceScore = Math.round(finding.confidence * 25);
  const specificityScore =
    finding.claimSpecificity === "high" ? 20 :
    finding.claimSpecificity === "medium" ? 13 :
    4;
  const sourceScore = Math.min(15, finding.sourceSupport.length * 5);
  const mismatchScore =
    finding.sourceSupport.includes("dueling-estimate") ||
    /gap|missing|absent|not included|not documented|excluded|vs/i.test(`${finding.issue} ${finding.finding ?? ""}`)
      ? 10
      : 0;
  const ambiguityPenalty =
    finding.evidenceLevel === "inferred" ||
    /may|depending|confirm|procedure-dependent|if /i.test(`${finding.finding ?? ""} ${finding.why_it_matters}`)
      ? 10
      : 0;

  return Math.max(0, Math.min(100, evidenceScore + confidenceScore + specificityScore + sourceScore + mismatchScore - ambiguityPenalty));
}

function logAgentReviewObservability(params: {
  fingerprint: ClaimFingerprint;
  retrievalSummary: RetrievalSummary;
  includedFindings: GatedFinding[];
  suppressedFindingsCount: number;
  disputeStrategy: DisputeStrategy;
  genericPhraseSuppressionCount: number;
  documentsReceived: number;
  agents: Record<string, GatedAgentResult>;
}) {
  const fingerprint = params.fingerprint;
  const agentStats = Object.fromEntries(
    Object.entries(params.agents).map(([agent, result]) => [
      agent,
      {
        ok: result.ok,
        includedFindings: result.data.length,
        suppressedFindings: result.suppressedFindings.length,
        genericPhraseSuppressions: result.genericPhraseSuppressionCount,
        errorCode: result.error ?? null,
      },
    ])
  );

  console.info("[agent-review:report-observability]", {
    schemaVersion: 1,
    claimFingerprintSummary: {
      vehicleProfile: {
        vehicleIdentityFieldsPresent: [
          fingerprint.vehicleProfile.year,
          fingerprint.vehicleProfile.make,
          fingerprint.vehicleProfile.model,
          fingerprint.vehicleProfile.trim,
        ].filter(Boolean).length,
        adasRelevant: fingerprint.vehicleProfile.adasRelevant,
      },
      damageProfile: {
        primaryImpactArea: fingerprint.damageProfile.primaryImpactArea,
        secondaryAreaCount: fingerprint.damageProfile.secondaryAreas.length,
        structuralSignalCount: fingerprint.damageProfile.structuralSignals.length,
        mechanicalSignalCount: fingerprint.damageProfile.mechanicalSignals.length,
        refinishSignalCount: fingerprint.damageProfile.refinishSignals.length,
        electricalSignalCount: fingerprint.damageProfile.electricalSignals.length,
        coolingSignalCount: fingerprint.damageProfile.coolingSignals.length,
        adasSignalCount: fingerprint.damageProfile.adasSignals.length,
      },
      estimateProfile: {
        hasDuelingEstimates: fingerprint.estimateProfile.hasDuelingEstimates,
        laborDeltaDriverCount: fingerprint.estimateProfile.laborDeltaDrivers.length,
        partsDeltaDriverCount: fingerprint.estimateProfile.partsDeltaDrivers.length,
        procedureDeltaDriverCount: fingerprint.estimateProfile.procedureDeltaDrivers.length,
        uniqueShopOperationCount: fingerprint.estimateProfile.uniqueShopOperations.length,
        uniqueCarrierOperationCount: fingerprint.estimateProfile.uniqueCarrierOperations.length,
        unsupportedOperationCount: fingerprint.estimateProfile.unsupportedOperations.length,
      },
      priorityCount: fingerprint.claimSpecificPriorities.length,
      retrievalCategories: fingerprint.retrievalProfile.categories,
    },
    retrievalCounts: {
      documentsReceived: params.documentsReceived,
      driveDocsUsed: params.retrievalSummary.driveDocsUsed,
      webSourcesUsed: params.retrievalSummary.webSourcesUsed,
      sourcesInfluencingFindingsCount: params.retrievalSummary.sourcesInfluencingFindings.length,
    },
    serperStatus: params.retrievalSummary.serperStatus,
    includedFindingsCount: params.includedFindings.length,
    suppressedFindingsCount: params.suppressedFindingsCount,
    oemEvidenceFound: params.retrievalSummary.oemEvidenceFound,
    disputeLeverageScore: params.disputeStrategy.leverageScore,
    genericPhraseSuppressionCount: params.genericPhraseSuppressionCount,
    agentStats,
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "finding";
}

function buildDriveProcedureContextText(documents: RetrievedDocument[]): string {
  const procedureDocs = documents.filter((document) => {
    const haystack = `${document.title}\n${document.text ?? ""}`.toLowerCase();
    return /oem|procedure|calibration|scan|corrosion|position statement/.test(haystack);
  });

  return procedureDocs
    .map((document) => `${document.title}\n${document.text ?? ""}`.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);
}

function enrichComparisonFactsWithRetrievedDocs(
  facts: ComparisonFacts,
  documents: RetrievedDocument[]
): ComparisonFacts {
  const corpus = documents
    .map((document) => `${document.title}\n${document.text ?? ""}`)
    .join("\n")
    .toLowerCase();

  const insurer = { ...facts.insurer };

  if (/pre-?repair scan|pre-?scan/.test(corpus)) {
    insurer.preScan = true;
  }

  if (/cavity\s*wax|corrosion\s*protection/.test(corpus)) {
    insurer.cavityWax = true;
  }

  if (/transport.*calibration|calibration.*transport|sublet.*calibration/.test(corpus)) {
    insurer.calibrationTransport = true;
  }

  if (/finish\s*sand\s*(and|&)\s*polish/.test(corpus)) {
    insurer.finishSandPolish = true;
  }

  return {
    shop: facts.shop,
    insurer,
  };
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-internal-agent-key");

  if (!apiKey || apiKey !== process.env.INTERNAL_AGENT_API_KEY) {
    return safeJson({ error: "Unauthorized" }, { status: 401 });
  }

  let body: AgentReviewRequestBody;

  try {
    body = (await req.json()) as AgentReviewRequestBody;
  } catch {
    return safeJson({ error: "Invalid JSON body" }, { status: 400 });
  }

  const agentInput = {
    ...body,
    caseId: typeof body.caseId === "string" ? body.caseId : undefined,
    jurisdiction:
      typeof body.jurisdiction === "string" ? body.jurisdiction : undefined,
    mode: typeof body.mode === "string" ? body.mode : undefined,
    userQuery: typeof body.userQuery === "string" ? body.userQuery : undefined,
    shopEstimateText:
      typeof body.shopEstimateText === "string" ? body.shopEstimateText : "",
    insurerEstimateText:
      typeof body.insurerEstimateText === "string" ? body.insurerEstimateText : "",
    oemProcedureText:
      typeof body.oemProcedureText === "string" ? body.oemProcedureText : "",
    retrievedDocuments: normalizeRetrievedDocuments(body.retrievedDocuments),
    complianceRules: SAFE_ANALYSIS_RULES,
  };

  const claimFingerprint = buildClaimFingerprint(agentInput);
  const evidenceMap = buildEvidenceMap(agentInput);

  const driveDocuments = agentInput.retrievedDocuments.filter(
    (document) => document.source === "google-drive"
  );
  const driveProcedureContext = buildDriveProcedureContextText(driveDocuments);
  const effectiveProcedureText = [agentInput.oemProcedureText, driveProcedureContext]
    .filter(Boolean)
    .join("\n\n");

  const operations = extractEstimateOps(agentInput.shopEstimateText);
  const baseComparisonFacts = extractComparisonFacts(
    parseEstimate(agentInput.shopEstimateText),
    parseEstimate(agentInput.insurerEstimateText)
  );
  const comparisonFacts = enrichComparisonFactsWithRetrievedDocs(
    baseComparisonFacts,
    driveDocuments
  );
  const oemRequirements = extractOemRequirements(effectiveProcedureText);

  const [estimate, adas, procedure, supplement] = await Promise.allSettled([
    runEstimateAgent(agentInput),
    runADASAgent(operations),
    runProcedureAgent(comparisonFacts, oemRequirements),
    runSupplementAgent(comparisonFacts),
  ]);

  const gatedFindings: Record<string, ReturnType<typeof unwrapGated>> = {
    estimate: unwrapGated(estimate, "estimate", claimFingerprint, evidenceMap),
    adas: unwrapGated(adas, "adas", claimFingerprint, evidenceMap),
    procedure: unwrapGated(procedure, "procedure", claimFingerprint, evidenceMap),
    supplement: unwrapGated(supplement, "supplement", claimFingerprint, evidenceMap),
  };
  const includedFindings = collectIncludedFindings(gatedFindings);
  const reportAgenda = buildReportAgenda(claimFingerprint, evidenceMap);
  const suppressedFindings = collectSuppressedFindings(gatedFindings);
  const genericPhraseSuppressionCount = collectGenericPhraseSuppressionCount(gatedFindings);
  const retrievalSummary = buildRetrievalSummary(
    includedFindings,
    agentInput.retrievedDocuments,
    evidenceMap
  );
  const disputeStrategy = buildDisputeStrategy(includedFindings);

  logAgentReviewObservability({
    fingerprint: claimFingerprint,
    retrievalSummary,
    includedFindings,
    suppressedFindingsCount: suppressedFindings.length,
    disputeStrategy,
    genericPhraseSuppressionCount,
    documentsReceived: agentInput.retrievedDocuments.length,
    agents: gatedFindings,
  });

  const result = {
    ok: true,
    retrieval: {
      documentsReceived: agentInput.retrievedDocuments.length,
      driveDocumentsUsed: driveDocuments.length,
    },
    retrievalImpact: buildRetrievalImpact(agentInput.retrievedDocuments, baseComparisonFacts, comparisonFacts),
    reportAgenda,
    findings: gatedFindings,
    retrievalSummary,
    disputeStrategy,
    debug: {
      claimFingerprint,
      evidenceMap,
      reportAgenda,
      suppressedFindings,
      retrievalSummaryDebug: {
        countedOnlyIncludedFindings: true,
        includedFindingIds: includedFindings.map((finding) => finding.id),
        documentsReceived: agentInput.retrievedDocuments.length,
        serperStatusBasis: retrievalSummary.serperStatus,
      },
      disputeStrategyDebug: {
        scoringBasis:
          "Evidence level, confidence, claim specificity, source support, estimate mismatch, and procedure ambiguity.",
        findingScores: includedFindings.map((finding) => ({
          id: finding.id,
          issue: finding.issue,
          score: scoreFindingLeverage(finding),
          evidenceLevel: finding.evidenceLevel,
          confidence: finding.confidence,
          claimSpecificity: finding.claimSpecificity,
        })),
      },
    },
  };

  return safeJson(result);
}
