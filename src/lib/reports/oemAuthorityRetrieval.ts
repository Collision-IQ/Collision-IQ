/**
 * OEM AUTHORITY RETRIEVAL — extracted so the surviving report can use it.
 *
 * This engine (Drive lane + Serper internet fallback) was defined INSIDE the
 * OEM Citation Density route. That is why Test 94 retrieved the Tesla collision
 * procedures, the Tesla scanning position statement, and 31 Pa. Code § 62.3 and
 * then ORPHANED all three: the delta route — the report that owns the findings
 * and that survives the merge — had no way to reach it, and the OEM route never
 * passed its output to attachResolvedAuthoritiesToFindings().
 *
 * Moved verbatim, no behaviour change in this step. Wiring it to finding ids is
 * the next commit; deleting the OEM route is later still.
 */
import { getUploadedAttachments } from "@/lib/uploadedAttachmentStore";
import {
  GTE_GENERAL_GUIDANCE_LABEL,
  GTE_SOURCE_LABEL,
  isGteUrl,
} from "@/lib/ai/gteResearch";
import { retrieveDriveSupport } from "@/lib/ai/driveRetrievalService";
import {
  retrieveWebSupport,
  type WebRetrievalResult,
} from "@/lib/ai/webRetrievalService";
import { isDriveEnabled } from "@/lib/drive/download";
import {
  buildDriveRetrievalRequest,
  type DriveRetrievalRequest,
  type DriveRetrievalResult,
} from "@/lib/ai/contracts/driveRetrievalContract";
import {
  buildVehicleLabel,
  extractVehicleIdentityFromText,
} from "@/lib/ai/vehicleContext";
import type {
  ComparisonEstimateText,
  OemCitationDensityAuthoritySource,
  OemCitationDensityAuthorityTrace,
} from "@/lib/reports/annotatedCitationDensityEstimate";
import type { SourceEstimatePdfSelection } from "@/lib/reports/citationDensitySourcePdf";

export async function buildOemAuthorityTrace(params: {
  /** Only the label is read. Narrowed from the full selection so callers whose
   *  selection type is widened elsewhere can still reach the engine. */
  selection: Pick<SourceEstimatePdfSelection, "selectedSourceLabel">;
  sourceDocument: Awaited<ReturnType<typeof getUploadedAttachments>>[number];
  sourceDocuments: Awaited<ReturnType<typeof getUploadedAttachments>>;
  comparisonEstimateTexts: ComparisonEstimateText[];
}): Promise<OemCitationDensityAuthorityTrace> {
  const driveSearchAvailable = isDriveEnabled();
  const estimateText = [
    params.sourceDocument.text ?? "",
    ...params.comparisonEstimateTexts.map((item) => item.text),
  ].join("\n\n");
  const vehicle = extractVehicleSummary([
    params.sourceDocument.filename ?? "",
    params.sourceDocument.text ?? "",
    ...params.sourceDocuments.map((document) => `${document.filename ?? ""}\n${document.text ?? ""}`),
  ].join("\n"));
  const userQuery = [
    "OEM Citation Density authority retrieval for an estimate PDF.",
    vehicle ? `Vehicle: ${vehicle}.` : "",
    `Selected estimate: ${params.selection.selectedSourceLabel}.`,
    "Find OEM procedures, OEM position statements, ADAS procedures, MOTOR/P-page support, SCRS/DEG-style estimating support, policy, and legal support relevant to the estimate rows.",
  ].filter(Boolean).join(" ");

  // Built once and reused for the internet (Serper) lane so the web fallback runs against the
  // same vehicle/topics/jurisdiction the Drive lane would have used.
  const retrievalRequest = buildDriveRetrievalRequest({
    taskType: "oem_procedure_insight",
    userQuery,
    estimateText,
    analysis: null,
    maxResults: 8,
    maxExcerptChars: 700,
  });

  const base = buildBaseOemAuthorityTrace({
    driveSearchAvailable,
    vehicle,
    blockedReason: driveSearchAvailable
      ? null
      : "Google Drive/internal authority retrieval is disabled or not configured for this server.",
  });

  // Drive disabled → go straight to the internet (Serper) lane so the OEM report still retrieves
  // OEM/jurisdictional/industry authority instead of returning an empty "trace incomplete".
  if (!driveSearchAvailable) {
    return attemptOemWebFallback(base, retrievalRequest);
  }

  try {
    const response = await retrieveDriveSupport({
      taskType: "oem_procedure_insight",
      userQuery,
      estimateText,
      firstPassAnswer: "OEM Citation Density export must retrieve authority before labeling findings citation-ready.",
      maxResults: 8,
      maxExcerptChars: 700,
    });

    if (!response || response.results.length === 0) {
      // Internal retrieval produced nothing usable. A healthy Drive that simply found zero
      // matches is a COMPLETE search (no line authority) — keep that completion state; only a
      // missing response is incomplete. Either way, also try the internet lane to add sources.
      return attemptOemWebFallback(
        {
          ...base,
          authorityTraceCompleted: Boolean(response),
          authorityCoverageStatus: response ? "complete" : "incomplete",
          googleDriveOrInternalSearchRan: true,
          driveSearchAttempted: true,
          driveSearchCompleted: Boolean(response),
          driveMatchedFoldersCount: 0,
          driveDocumentsReviewedCount: 0,
          driveSearchTerms: extractDriveSearchTerms(response?.request),
          authorityTraceBlockedReason: response ? null : "Google Drive/internal authority retrieval did not return a response.",
          skippedReason: response ? undefined : "Google Drive/internal authority retrieval did not return a response.",
        },
        retrievalRequest
      );
    }

    const authoritySources = response.results.map(mapDriveResultToAuthoritySource);
    const reviewedDocuments = uniqueStrings(response.results.map((result) => result.filename).filter(Boolean));
    const folders = uniqueStrings(response.results.map((result) => result.metadata.source).filter(Boolean));
    const contextText = buildAuthorityContextText(response.results);

    return {
      ...base,
      authorityTraceCompleted: true,
      authorityTraceBlockedReason: null,
      authorityCoverageStatus: "partial",
      googleDriveOrInternalSearchRan: true,
      skippedReason: undefined,
      driveSearchAttempted: true,
      driveSearchAvailable: true,
      driveSearchCompleted: true,
      driveMatchedFoldersCount: folders.length,
      driveDocumentsReviewedCount: reviewedDocuments.length,
      driveSearchTerms: extractDriveSearchTerms(response.request),
      driveMakeModelFolderMatched: response.results.some((result) =>
        result.metadata.vehicleMatchLevel === "exact_vehicle_match" ||
        result.metadata.vehicleMatchLevel === "manufacturer_match"
      ),
      driveMatchedFolders: folders,
      driveDocumentsReviewed: reviewedDocuments,
      oemSourcesReviewed: uniqueStrings(response.results
        .filter((result) => result.sourceBucket === "oem_procedures" || result.sourceBucket === "oem_position_statements")
        .map((result) => result.filename)),
      adasSourcesReviewed: uniqueStrings(response.results
        .filter((result) => result.documentClass === "adas_document" || /adas|calibration|scan/i.test(`${result.filename} ${result.excerpt.excerpt}`))
        .map((result) => result.filename)),
      motorPPageSourcesReviewed: uniqueStrings(response.results
        .filter((result) => /motor|p-?page|database|estimating/i.test(`${result.filename} ${result.excerpt.excerpt}`))
        .map((result) => result.filename)),
      policyLegalSourcesReviewed: uniqueStrings(response.results
        .filter((result) => result.sourceBucket === "pa_law" || result.sourceBucket === "insurer_guidelines")
        .map((result) => result.filename)),
      jurisdictionSourcesReviewed: uniqueStrings(response.results
        .filter((result) => result.sourceBucket === "pa_law")
        .map((result) => result.filename)),
      authoritySources,
      authorityContextText: contextText,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Internal retrieval errored — still attempt the internet lane before giving up.
    return attemptOemWebFallback(
      {
        ...base,
        googleDriveOrInternalSearchRan: true,
        driveSearchAttempted: true,
        authorityTraceBlockedReason: `Google Drive/internal authority retrieval failed: ${message}`,
        skippedReason: `Google Drive/internal authority retrieval failed: ${message}`,
      },
      retrievalRequest
    );
  }
}

// Internet (Serper) authority lane. Runs when Google Drive/internal retrieval is unavailable or
// returns nothing, so the OEM report still ties findings to retrieved OEM/jurisdictional/industry
// references (labeled ONLINE FALLBACK, unverified) instead of "Authority Trace Incomplete".
async function attemptOemWebFallback(
  trace: OemCitationDensityAuthorityTrace,
  retrievalRequest: DriveRetrievalRequest | null
): Promise<OemCitationDensityAuthorityTrace> {
  if (!retrievalRequest) {
    return {
      ...trace,
      onlineSearchAttempted: false,
      authorityTraceBlockedReason:
        trace.authorityTraceBlockedReason ??
        "Could not build an authority retrieval request from the estimate (no actionable repair topics inferred).",
    };
  }

  const web = await retrieveWebSupport(retrievalRequest, { maxResults: 6, maxQueries: 3 }).catch(() => null);

  // The web lane only ENHANCES — it must never flip an already-complete trace (e.g. a healthy
  // Drive search that found zero matches) back to incomplete. Only attach a blocked reason when
  // the incoming trace was not already completed.
  const blockedReasonOnWebMiss = (reason: string) =>
    trace.authorityTraceCompleted ? trace.authorityTraceBlockedReason ?? null : trace.authorityTraceBlockedReason ?? reason;

  if (!web || web.status === "not_configured") {
    return {
      ...trace,
      onlineSearchAttempted: false,
      authorityTraceBlockedReason: blockedReasonOnWebMiss(
        web?.status === "not_configured"
          ? "Internet (Serper) authority retrieval is not configured (missing SERPER_API_KEY)."
          : "Internet (Serper) authority retrieval did not return a response."
      ),
    };
  }

  if (web.status !== "success" || web.results.length === 0) {
    return {
      ...trace,
      onlineSearchAttempted: true,
      onlineSourcesReviewed: [],
      authorityTraceBlockedReason: blockedReasonOnWebMiss("Internet (Serper) authority retrieval returned no results."),
    };
  }

  const webSources = web.results.map(mapWebResultToOemAuthoritySource);
  const contextText = web.results
    .map((result) => [`Online source: ${result.title}`, `URL: ${result.url}`, result.snippet].filter(Boolean).join("\n"))
    .join("\n\n");

  return {
    ...trace,
    authorityTraceCompleted: true,
    authorityTraceBlockedReason: null,
    skippedReason: undefined,
    authorityCoverageStatus: "partial",
    onlineSearchAttempted: true,
    onlineSourcesReviewed: uniqueStrings(web.results.map((result) => result.title || result.url)),
    oemSourcesReviewed: uniqueStrings([
      ...trace.oemSourcesReviewed,
      ...web.results.filter((result) => result.sourceType === "oem").map((result) => result.title),
    ]),
    motorPPageSourcesReviewed: uniqueStrings([
      ...trace.motorPPageSourcesReviewed,
      ...web.results.filter((result) => isGteUrl(result.url)).map((result) => `${GTE_SOURCE_LABEL}: ${result.title}`),
    ]),
    jurisdictionSourcesReviewed: uniqueStrings([
      ...trace.jurisdictionSourcesReviewed,
      ...web.results.filter((result) => result.sourceType === "law").map((result) => result.title),
    ]),
    policyLegalSourcesReviewed: uniqueStrings([
      ...trace.policyLegalSourcesReviewed,
      ...web.results.filter((result) => result.sourceType === "law").map((result) => result.title),
    ]),
    authoritySources: [...trace.authoritySources, ...webSources],
    authorityContextText: [trace.authorityContextText, contextText].filter(Boolean).join("\n\n"),
  };
}

function mapWebResultToOemAuthoritySource(result: WebRetrievalResult): OemCitationDensityAuthoritySource {
  // CCC/MOTOR GTE hits are general estimating-guide guidance — labeled as such,
  // never as vehicle-specific MOTOR DaaS sandbox evidence.
  if (isGteUrl(result.url)) {
    return {
      title: `${GTE_SOURCE_LABEL}: ${result.title}`,
      sourceType: "internet_fallback",
      evidenceTier: 6,
      verified: false,
      url: result.url,
      researchSourceType: "industry",
      note: [
        `${GTE_GENERAL_GUIDANCE_LABEL} — general CCC/MOTOR P-page/estimating-guide support, not vehicle-specific evidence.`,
        result.url,
        result.snippet,
      ].filter(Boolean).join(" "),
    };
  }

  const label = result.sourceType === "law" ? "jurisdictional/legal" : result.sourceType === "oem" ? "OEM" : "industry";
  return {
    title: result.title,
    sourceType: "internet_fallback",
    evidenceTier: 7,
    verified: false,
    url: result.url,
    researchSourceType: result.sourceType === "law" ? "law" : result.sourceType === "oem" ? "oem" : "industry",
    note: [
      `Online ${label} reference (unverified internet fallback — confirm against primary OEM/jurisdictional source before relying on it).`,
      result.url,
      result.snippet,
    ].filter(Boolean).join(" "),
  };
}

/**
 * THE BRIDGE THAT WAS MISSING.
 *
 * Retrieval produced authority sources; attachResolvedAuthoritiesToFindings()
 * consumes a different shape; nothing converted between them, so every source
 * this engine retrieved was reported in the trace and then dropped on the floor
 * instead of reaching a finding. Titles shorter than three characters and
 * untitled sources are excluded — an authority with no citable name cannot be
 * shown to a reader as support.
 */
export function mapAuthorityTraceToResolvedAuthorities(
  trace: OemCitationDensityAuthorityTrace | null | undefined
): Array<{
  sourceType: string;
  sourceTitle: string;
  url?: string;
  locator?: string;
  confidenceScore?: number | null;
  appliesToMake?: string;
}> {
  return (trace?.authoritySources ?? [])
    .filter((source) => (source.title?.trim().length ?? 0) >= 3)
    .map((source) => ({
      sourceType: source.researchSourceType ?? "web",
      sourceTitle: source.title.trim(),
      url: source.url,
      locator: source.locator,
      // Evidence tier is an authority ranking (1 = OEM procedure), not a
      // probability. Expressed on the 0-1 scale the consumer expects without
      // inventing precision: tier 1 -> 1.0, tier 7 -> ~0.14.
      confidenceScore: source.evidenceTier > 0 ? 1 / source.evidenceTier : null,
      appliesToMake: source.appliesToMake,
    }));
}

export function buildBaseOemAuthorityTrace(params: {
  driveSearchAvailable: boolean;
  vehicle: string | null;
  blockedReason: string | null;
}): OemCitationDensityAuthorityTrace {
  return {
    authorityTraceStarted: true,
    authorityTraceCompleted: false,
    authorityTraceBlockedReason: params.blockedReason,
    authorityCoverageStatus: "incomplete",
    googleDriveOrInternalSearchRan: false,
    skippedReason: params.blockedReason ?? undefined,
    sandPolishSupportFound: false,
    driveSearchAttempted: params.driveSearchAvailable,
    driveSearchAvailable: params.driveSearchAvailable,
    driveSearchCompleted: false,
    driveMatchedFoldersCount: 0,
    driveDocumentsReviewedCount: 0,
    driveSearchTerms: [],
    driveMakeModelFolderMatched: false,
    driveMatchedFolders: [],
    driveDocumentsReviewed: [],
    onlineSearchAttempted: false,
    onlineSourcesReviewed: [],
    jurisdictionResolved: inferJurisdiction(params.vehicle),
    jurisdictionSourcesReviewed: [],
    oemSourcesReviewed: [],
    adasSourcesReviewed: [],
    motorPPageSourcesReviewed: [],
    scrsSourcesReviewed: [],
    policyLegalSourcesReviewed: [],
    authoritySources: [],
  };
}

function mapDriveResultToAuthoritySource(result: DriveRetrievalResult): OemCitationDensityAuthoritySource {
  const sourceType = (() => {
    if (result.documentClass === "oem_procedure" || result.sourceBucket === "oem_procedures") return "oem_procedure";
    if (result.documentClass === "oem_position_statement" || result.sourceBucket === "oem_position_statements") return "oem_position_statement";
    if (result.sourceBucket === "pa_law") return "jurisdictional_law";
    if (result.sourceBucket === "insurer_guidelines") return "policy";
    if (result.documentClass === "adas_document") return "oem_procedure";
    if (/motor|p-?page|database|estimating/i.test(`${result.filename} ${result.excerpt.excerpt}`)) return "motor_database";
    return "uploaded_support";
  })();
  const isOemAuthority = sourceType === "oem_procedure" || sourceType === "oem_position_statement";
  return {
    title: result.filename,
    sourceType,
    evidenceTier: sourceType === "oem_procedure" ? 1 : sourceType === "oem_position_statement" ? 2 : sourceType === "motor_database" ? 3 : 4,
    verified: false,
    // Drive files carry their own applicability metadata; keeping make and page
    // as fields (not prose) is what lets the D-4 gate decide without guessing.
    url: result.metadata.fileId ? `https://drive.google.com/file/d/${result.metadata.fileId}/view` : undefined,
    locator: result.metadata.pageHint ?? result.excerpt.pageLabel,
    appliesToMake: result.metadata.make,
    researchSourceType:
      sourceType === "oem_procedure" || sourceType === "oem_position_statement"
        ? "oem"
        : sourceType === "jurisdictional_law"
          ? "law"
          : sourceType === "policy"
            ? "policy"
            : sourceType === "motor_database"
              ? "industry"
              : "drive",
    note: [
      isOemAuthority ? "Retrieved authority source reviewed; exact row-level applicability still needs human or matcher verification." : "",
      result.matchReason,
      result.metadata.pageHint ? `Page: ${result.metadata.pageHint}.` : "",
      result.metadata.vehicleApplicabilityReason ?? "",
    ].filter(Boolean).join(" "),
  };
}

function buildAuthorityContextText(results: DriveRetrievalResult[]) {
  return results
    .map((result) => [
      `Authority document: ${result.filename}`,
      `Class: ${result.documentClass}`,
      `Bucket: ${result.sourceBucket}`,
      result.metadata.pageHint ? `Page: ${result.metadata.pageHint}` : "",
      result.excerpt.excerpt,
    ].filter(Boolean).join("\n"))
    .join("\n\n");
}

export function extractVehicleSummary(text: string) {
  const identity = extractVehicleIdentityFromText(text, "attachment");
  const label = buildVehicleLabel(identity, { includeTrim: true });
  if (label) return label;
  return text.match(/\b((?:19|20)\d{2}\s+(?:Acura|Audi|BMW|Buick|Cadillac|Chevrolet|Chevy|Chrysler|Dodge|Ford|Genesis|GMC|Honda|Hyundai|Infiniti|Jeep|Kia|Lexus|Lincoln|Lucid|Mazda|Mercedes|Mini|Nissan|Polestar|Ram|Rivian|RIVI|Subaru|Tesla|TESL|Toyota|Volkswagen|Volvo)\s+[A-Z0-9][A-Za-z0-9-]*(?:\s+[A-Z0-9][A-Za-z0-9-]*){0,3})\b/i)?.[1]?.replace(/\bTESL\b/i, "Tesla").replace(/\bRIVI\b/i, "Rivian").trim() ?? null;
}

function inferJurisdiction(vehicle: string | null) {
  return vehicle ? null : null;
}

export function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function extractDriveSearchTerms(request: DriveRetrievalRequest | undefined) {
  if (!request) return [];
  return uniqueStrings([
    request.vehicle?.year ? String(request.vehicle.year) : undefined,
    request.vehicle?.make,
    request.vehicle?.model,
    request.vehicle?.trim,
    ...(request.topics ?? []).map((topic) => topic.topic.replace(/_/g, " ")),
  ]).slice(0, 12);
}

