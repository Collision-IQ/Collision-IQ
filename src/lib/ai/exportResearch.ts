import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { retrieveDriveSupport } from "@/lib/ai/driveRetrievalService";
import type {
  ExportResearchAgentName,
  ExportResearchSnapshot,
  ExportResearchSource,
  ExportResearchSupportCategory,
  RepairIntelligenceReport,
} from "@/lib/ai/types/analysis";

const VERIFIED_LAW_CONFIDENCE_THRESHOLD = 0.7;

export type ResearchableExportType = ExportResearchSnapshot["reportType"];

type ResearchQuery = {
  agent: ExportResearchAgentName;
  query: string;
  sourceTarget: "drive" | "internet";
};

const RESEARCH_AGENTS: ExportResearchAgentName[] = [
  "Legal / Regulation Agent",
  "Policy Rights Agent",
  "OEM Procedure Agent",
  "Estimate Scrubber Agent",
  "Citation Verification Agent",
  "Source Conflict Agent",
];

export async function buildExportResearchSnapshot(params: {
  reportType: ResearchableExportType;
  report: RepairIntelligenceReport;
  caseId?: string | null;
}): Promise<ExportResearchSnapshot> {
  const generatedAt = new Date().toISOString();
  const queries = buildResearchQueries(params.reportType, params.report);
  const driveQueries = queries.filter((query) => query.sourceTarget === "drive");
  const internetQueries = queries.filter((query) => query.sourceTarget === "internet");
  const driveSources = await runDriveResearch(driveQueries, params.report);
  const internetSources = await runInternetResearch(internetQueries, params.report);
  const reviewed = [...driveSources, ...internetSources];
  const verified = verifyResearchSources(reviewed, inferJurisdiction(params.report));
  const citationMap = buildCitationMap(verified.accepted);
  const unsupportedFindings = buildUnsupportedFindings(citationMap, verified.rejected, params.reportType);
  const snapshotBase = {
    id: randomUUID(),
    reportType: params.reportType,
    generatedAt,
    retrievalTimestamp: generatedAt,
    agentsRun: RESEARCH_AGENTS,
    searchQueriesUsed: queries,
    sourcesReviewed: reviewed,
    sourcesAccepted: verified.accepted,
    sourcesRejected: verified.rejected,
    citationMap,
    verificationSummary: verified.summary,
    unsupportedFindings,
  };
  const immutableSnapshotHash = hashSnapshot(snapshotBase);

  return {
    ...snapshotBase,
    immutableSnapshotHash,
  };
}

export async function persistExportResearchAuditSnapshot(params: {
  caseId?: string | null;
  snapshot: ExportResearchSnapshot;
}): Promise<void> {
  await prisma.exportResearchAuditSnapshot.create({
    data: {
      caseId: params.caseId ?? null,
      reportType: params.snapshot.reportType,
      snapshotHash: params.snapshot.immutableSnapshotHash,
      snapshot: params.snapshot,
      generatedAt: new Date(params.snapshot.generatedAt),
    },
  });
}

function buildResearchQueries(
  reportType: ResearchableExportType,
  report: RepairIntelligenceReport
): ResearchQuery[] {
  const state = inferJurisdiction(report);
  const vehicle = [report.vehicle?.year, report.vehicle?.make, report.vehicle?.model]
    .filter(Boolean)
    .join(" ");
  const operations = [
    ...report.missingProcedures,
    ...report.supplementOpportunities,
    ...(report.findingReasoning ?? []).map((finding) => finding.issue),
  ].slice(0, 4);
  const operationText = operations.join(" ");
  const base = [state, vehicle, operationText].filter(Boolean).join(" ");

  const queries: ResearchQuery[] = [
    {
      agent: "Legal / Regulation Agent",
      sourceTarget: "drive",
      query: `${state || "state"} insurance regulation appraisal claim handling consumer rights`,
    },
    {
      agent: "Policy Rights Agent",
      sourceTarget: "drive",
      query: `${state || "state"} insurance policy appraisal clause duties after loss repair rights`,
    },
    {
      agent: "OEM Procedure Agent",
      sourceTarget: "drive",
      query: `${vehicle || "vehicle"} OEM procedure position statement scan calibration structural corrosion ${operationText}`,
    },
    {
      agent: "Estimate Scrubber Agent",
      sourceTarget: "drive",
      query: `${vehicle || "vehicle"} refinish materials one time use DEG SCRS estimate missing operations ${operationText}`,
    },
    {
      agent: "Legal / Regulation Agent",
      sourceTarget: "internet",
      query: `${state || "state"} insurance department regulation appraisal rights collision repair estimate`,
    },
    {
      agent: "OEM Procedure Agent",
      sourceTarget: "internet",
      query: `${vehicle || "manufacturer"} OEM position statement collision repair scan calibration structural repair`,
    },
    {
      agent: "Estimate Scrubber Agent",
      sourceTarget: "internet",
      query: `SCRS DEG collision repair ${operationText || "estimate omissions refinish materials calibration"}`,
    },
    {
      agent: "Citation Verification Agent",
      sourceTarget: "internet",
      query: `${base || reportType} current source verification effective date superseded regulation OEM requirement`,
    },
    {
      agent: "Source Conflict Agent",
      sourceTarget: "internet",
      query: `${base || reportType} conflicting OEM procedure insurer estimate denial logic`,
    },
  ];

  return queries.filter((query) => query.query.trim().length > 0);
}

async function runDriveResearch(
  queries: ResearchQuery[],
  report: RepairIntelligenceReport
): Promise<ExportResearchSource[]> {
  const results: ExportResearchSource[] = [];

  for (const query of queries) {
    const response = await retrieveDriveSupport({
      taskType: query.agent === "OEM Procedure Agent" ? "oem_procedure_insight" : "estimate_review",
      userQuery: query.query,
      estimateText: report.sourceEstimateText ?? report.analysis?.rawEstimateText ?? "",
      firstPassAnswer: report.analysis?.narrative ?? report.recommendedActions.join("\n"),
      jurisdiction: {
        stateCode: inferJurisdiction(report),
        confidence: inferJurisdiction(report) ? "medium" : "low",
        source: inferJurisdiction(report) ? "query_inferred" : "unknown",
      },
      analysis: null,
      maxResults: 5,
      maxExcerptChars: 650,
    }).catch(() => null);

    for (const item of response?.results ?? []) {
      const sourceType = mapDriveSourceType(item.sourceBucket, item.documentClass);
      results.push({
        id: stableSourceId(`drive:${item.id}:${query.agent}`),
        sourceType,
        sourceTitle: item.filename,
        locator: item.excerpt.pageLabel ?? item.metadata.pageHint ?? item.id,
        driveFileId: item.metadata.fileId,
        retrievalTimestamp: new Date().toISOString(),
        jurisdiction: item.metadata.jurisdictionRelevance ?? inferJurisdiction(report),
        confidenceScore: confidenceToScore(item.confidence),
        agent: query.agent,
        supportCategory: mapSupportCategory(sourceType, item.filename, {
          sourceJurisdiction: item.metadata.jurisdictionRelevance,
          detectedJurisdiction: inferJurisdiction(report),
          confidenceScore: confidenceToScore(item.confidence),
        }),
        accepted: true,
      });
    }
  }

  return dedupeSources(results);
}

async function runInternetResearch(
  queries: ResearchQuery[],
  report: RepairIntelligenceReport
): Promise<ExportResearchSource[]> {
  const apiKey = process.env.SERPER_API_KEY || process.env.GOOGLE_SERPER_API_KEY;
  if (!apiKey) {
    return queries.map((query) => ({
      id: stableSourceId(`web-not-configured:${query.query}`),
      sourceType: "inference",
      sourceTitle: `Internet deep search not configured: ${query.query}`,
      locator: "SERPER_API_KEY missing",
      retrievalTimestamp: new Date().toISOString(),
      jurisdiction: inferJurisdiction(report),
      confidenceScore: 0,
      agent: query.agent,
      supportCategory: "Unsupported / Needs Review",
      accepted: false,
      rejectionReason: "Internet deep search provider is not configured.",
    }));
  }

  const results: ExportResearchSource[] = [];

  for (const query of queries) {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({ q: query.query, num: 6 }),
    }).catch(() => null);
    const payload = response?.ok ? ((await response.json().catch(() => null)) as SerperPayload | null) : null;

    for (const item of payload?.organic ?? []) {
      if (!item.title || !item.link) {
        continue;
      }

      const sourceType = mapWebSourceType(item.title, item.link);
      results.push({
        id: stableSourceId(`web:${item.link}:${query.agent}`),
        sourceType,
        sourceTitle: item.title,
        locator: item.link,
        url: item.link,
        retrievalTimestamp: new Date().toISOString(),
        jurisdiction: inferJurisdiction(report),
        confidenceScore: sourceType === "law" ? 0.72 : sourceType === "oem" ? 0.68 : 0.55,
        agent: query.agent,
        supportCategory: mapSupportCategory(sourceType, item.title, {
          sourceJurisdiction: inferJurisdiction(report),
          detectedJurisdiction: inferJurisdiction(report),
          confidenceScore: sourceType === "law" ? 0.72 : sourceType === "oem" ? 0.68 : 0.55,
        }),
        accepted: true,
      });
    }
  }

  return dedupeSources(results);
}

type SerperPayload = {
  organic?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    date?: string;
  }>;
};

function verifyResearchSources(sources: ExportResearchSource[], detectedJurisdiction?: string) {
  const accepted: ExportResearchSource[] = [];
  const rejected: ExportResearchSource[] = [];
  let uncitedLegalClaimsRejected = 0;
  let fabricatedStatutesRejected = 0;
  let staleOrSupersededRegulationsRejected = 0;
  let unsupportedOemRequirementsRejected = 0;
  let inferredPolicyRightsDowngraded = 0;

  for (const source of sources) {
    let rejectionReason: string | null = null;
    const lawJurisdictionVerified =
      source.sourceType !== "law" ||
      isVerifiedLawJurisdictionMatch({
        sourceJurisdiction: source.jurisdiction,
        detectedJurisdiction,
        confidenceScore: source.confidenceScore,
      });

    if (source.sourceType === "law" && !lawJurisdictionVerified) {
      accepted.push({
        ...source,
        supportCategory: "Research Leads - Not Jurisdiction Verified",
        confidenceScore: Math.min(source.confidenceScore, 0.55),
      });
      continue;
    }

    if (source.supportCategory === "Verified Law" && !source.url && !source.driveFileId) {
      rejectionReason = "Legal support has no URL or Drive file reference.";
      uncitedLegalClaimsRejected += 1;
    }
    if (source.supportCategory === "Verified Law" && /blog|forum|reddit|quora/i.test(source.locator)) {
      rejectionReason = "Legal support is not from an authoritative legal or DOI source.";
      fabricatedStatutesRejected += 1;
    }
    if (source.supportCategory === "Verified Law" && /superseded|repealed|archive/i.test(`${source.sourceTitle} ${source.locator}`)) {
      rejectionReason = "Regulation appears stale, archived, repealed, or superseded.";
      staleOrSupersededRegulationsRejected += 1;
    }
    if (source.supportCategory === "Verified OEM / Position Statement Support" && !source.url && !source.driveFileId) {
      rejectionReason = "OEM requirement has no URL or Drive file reference.";
      unsupportedOemRequirementsRejected += 1;
    }
    if (source.supportCategory === "Verified Policy Language" && source.sourceType !== "policy") {
      inferredPolicyRightsDowngraded += 1;
      accepted.push({
        ...source,
        supportCategory: "Inferred Repair Intelligence",
        confidenceScore: Math.min(source.confidenceScore, 0.35),
      });
      continue;
    }

    if (rejectionReason) {
      rejected.push({
        ...source,
        accepted: false,
        supportCategory: "Unsupported / Needs Review",
        confidenceScore: 0,
        rejectionReason,
      });
    } else {
      accepted.push(source);
    }
  }

  return {
    accepted,
    rejected,
    summary: {
      uncitedLegalClaimsRejected,
      fabricatedStatutesRejected,
      staleOrSupersededRegulationsRejected,
      unsupportedOemRequirementsRejected,
      inferredPolicyRightsDowngraded,
    },
  };
}

function buildCitationMap(sources: ExportResearchSource[]): ExportResearchSnapshot["citationMap"] {
  const categories: ExportResearchSupportCategory[] = [
    "Verified Law",
    "Research Leads - Not Jurisdiction Verified",
    "Verified Policy Language",
    "Verified OEM / Position Statement Support",
    "Internet-Sourced Industry Support",
    "Inferred Repair Intelligence",
    "Unsupported / Needs Review",
  ];

  return categories.map((category) => {
    const categorySources = sources.filter((source) => source.supportCategory === category);
    const confidenceScore = categorySources.length
      ? categorySources.reduce((sum, source) => sum + source.confidenceScore, 0) / categorySources.length
      : 0;
    return {
      assertionType: category,
      sourceIds: categorySources.map((source) => source.id),
      confidenceScore: Number(confidenceScore.toFixed(2)),
      status:
        categorySources.length === 0
          ? "unverified_needs_source"
          : category.startsWith("Verified")
            ? "verified"
            : "inferred",
    };
  });
}

function buildUnsupportedFindings(
  citationMap: ExportResearchSnapshot["citationMap"],
  rejected: ExportResearchSource[],
  reportType: ResearchableExportType
) {
  return [
    ...citationMap
      .filter((entry) => entry.status === "unverified_needs_source")
      .map((entry) => `${entry.assertionType}: Unverified / Needs Source for ${reportType}.`),
    ...rejected.map((source) => `${source.sourceTitle}: ${source.rejectionReason ?? "Rejected by citation verification."}`),
  ].slice(0, 20);
}

function mapDriveSourceType(bucket: string, documentClass: string): ExportResearchSource["sourceType"] {
  if (bucket === "pa_law" || documentClass === "state_law_pa") return "law";
  if (bucket === "insurer_guidelines") return "policy";
  if (bucket === "oem_procedures" || bucket === "oem_position_statements") return "oem";
  return "drive";
}

function mapWebSourceType(title: string, url: string): ExportResearchSource["sourceType"] {
  if (/doi|insurance department|insurance commissioner|statute|regulation|appraisal/i.test(`${title} ${url}`)) return "law";
  if (/oem|manufacturer|position statement|repair procedure|service information/i.test(`${title} ${url}`)) return "oem";
  if (/scrs|deg|estimating|refinish|material/i.test(`${title} ${url}`)) return "industry";
  return "industry";
}

function mapSupportCategory(
  sourceType: ExportResearchSource["sourceType"],
  title: string,
  options?: {
    sourceJurisdiction?: string | null;
    detectedJurisdiction?: string;
    confidenceScore?: number;
  }
): ExportResearchSupportCategory {
  if (sourceType === "law") {
    return isVerifiedLawJurisdictionMatch({
      sourceJurisdiction: options?.sourceJurisdiction,
      detectedJurisdiction: options?.detectedJurisdiction,
      confidenceScore: options?.confidenceScore ?? 0,
    })
      ? "Verified Law"
      : "Research Leads - Not Jurisdiction Verified";
  }
  if (sourceType === "policy") return "Verified Policy Language";
  if (sourceType === "oem") return "Verified OEM / Position Statement Support";
  if (sourceType === "industry") return "Internet-Sourced Industry Support";
  if (/inferred|runtime|analysis/i.test(title)) return "Inferred Repair Intelligence";
  return "Unsupported / Needs Review";
}

function isVerifiedLawJurisdictionMatch(params: {
  sourceJurisdiction?: string | null;
  detectedJurisdiction?: string;
  confidenceScore: number;
}) {
  if (params.confidenceScore < VERIFIED_LAW_CONFIDENCE_THRESHOLD) {
    return false;
  }

  const detected = normalizeJurisdictionToken(params.detectedJurisdiction);
  const source = `${params.sourceJurisdiction ?? ""}`.trim();
  if (!source) return false;

  if (/\b(national|federal|us|u\.s\.|united states)\b/i.test(source)) {
    return true;
  }

  if (!detected) return false;

  const sourceTokens = extractJurisdictionTokens(source);
  return sourceTokens.has(detected);
}

function extractJurisdictionTokens(value: string) {
  const tokens = new Set<string>();
  const normalized = value.toUpperCase();
  const stateCodes = normalized.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/g) ?? [];
  for (const code of stateCodes) tokens.add(code);

  const stateNameMap: Record<string, string> = {
    PENNSYLVANIA: "PA",
    TEXAS: "TX",
    GEORGIA: "GA",
    NEW_YORK: "NY",
    NEW_JERSEY: "NJ",
    CALIFORNIA: "CA",
    FLORIDA: "FL",
  };

  const nameKey = normalized.replace(/[^A-Z]+/g, "_");
  for (const [name, code] of Object.entries(stateNameMap)) {
    if (nameKey.includes(name)) tokens.add(code);
  }

  return tokens;
}

function normalizeJurisdictionToken(value: string | null | undefined) {
  return extractJurisdictionTokens(value ?? "").values().next().value ?? "";
}

function inferJurisdiction(report: RepairIntelligenceReport): string | undefined {
  const text = [
    report.analysis?.narrative,
    report.recommendedActions.join(" "),
    report.factualCore?.currentCaseSummary,
  ].filter(Boolean).join(" ");
  const match = text.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/i);
  return match?.[1]?.toUpperCase();
}

function confidenceToScore(confidence: "low" | "medium" | "high") {
  if (confidence === "high") return 0.85;
  if (confidence === "medium") return 0.65;
  return 0.4;
}

function dedupeSources(sources: ExportResearchSource[]): ExportResearchSource[] {
  return [...new Map(sources.map((source) => [source.id, source])).values()].slice(0, 40);
}

function stableSourceId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function hashSnapshot(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
