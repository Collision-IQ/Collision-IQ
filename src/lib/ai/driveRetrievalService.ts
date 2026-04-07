import { google, type drive_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getDriveAuth } from "@/lib/drive/auth";
import { getConfiguredDriveRootFolders, listDriveFiles } from "@/lib/drive/list";
import { embedText } from "@/lib/rag/embed";
import { getChunkSourceColumn } from "@/lib/rag/chunkSourceColumn";
import {
  buildDriveRetrievalRequest,
  type DriveDocumentType,
  type DriveInferenceConfidence,
  type DriveJurisdictionContext,
  type DriveRetrievalRequest,
  type DriveRetrievalResponse,
  type DriveRetrievalResult,
  type DriveRelevanceReason,
  type DriveSourceBucket,
  type DriveTopicInference,
} from "@/lib/ai/contracts/driveRetrievalContract";
import type { ChatAnalysisOutput, ChatbotTaskType } from "@/lib/ai/contracts/chatAnalysisSchema";

type DriveIndexFile = {
  id: string;
  name: string;
  path: string;
  mimeType?: string | null;
};

type DriveChunkRow = {
  id: string;
  content: string;
  file_id: string;
  distance?: number | string | null;
};

let driveIndexCache:
  | {
      loadedAt: number;
      files: DriveIndexFile[];
    }
  | null = null;

const DRIVE_INDEX_TTL_MS = 10 * 60 * 1000;

const BUCKET_PATH_HINTS: Record<DriveSourceBucket, string[]> = {
  oem_procedures: ["oem procedures", "oem procedure", "procedures", "repair procedures"],
  oem_position_statements: ["position statements", "position statement", "oem position"],
  pa_law: ["pa law", "pennsylvania law", "law", "statute", "consumer rights"],
  insurer_guidelines: ["insurer guidelines", "claim handling", "guidelines", "carrier guidelines"],
  general_reference: ["reference", "general reference", "industry reference"],
};

export async function retrieveDriveSupport(params: {
  taskType: ChatbotTaskType;
  userQuery: string;
  estimateText?: string;
  firstPassAnswer: string;
  jurisdiction?: DriveJurisdictionContext;
  analysis?: Pick<
    ChatAnalysisOutput,
    "summary" | "repairStrategy" | "keyDrivers" | "missingOperations" | "vehicleIdentification"
  > | null;
  maxResults?: number;
  maxExcerptChars?: number;
}): Promise<DriveRetrievalResponse | null> {
  const request = buildDriveRetrievalRequest({
    taskType: params.taskType,
    userQuery: params.userQuery,
    estimateText: [params.estimateText, params.firstPassAnswer].filter(Boolean).join("\n\n"),
    jurisdiction: params.jurisdiction,
    analysis: params.analysis ?? null,
    maxResults: params.maxResults ?? 5,
    maxExcerptChars: params.maxExcerptChars ?? 500,
  });

  if (!request) {
    return null;
  }

  const files = await getDriveIndex();
  const laneResults = new Map<string, Map<string, DriveRetrievalResult>>();

  for (const lanePlan of request.lanePlans) {
    if (lanePlan.lane === "pa_law_lane" && !isStateLawJurisdictionCurrentlyBacked(request)) {
      continue;
    }

    if (lanePlan.lane === "pa_law_lane" && !shouldSearchStateLawLane(request)) {
      continue;
    }

    const candidateFiles = selectFilesForLane(files, lanePlan.sourceBuckets);
    if (candidateFiles.length === 0) continue;

    const deterministicQueries = buildDeterministicLaneQueries(
      request,
      lanePlan.topics,
      lanePlan.lane
    );
    const semanticFallbackQuery = buildLaneQuery(request, lanePlan.topics);

    const laneRowGroups = await Promise.all(
      [...deterministicQueries, semanticFallbackQuery].map((query, index) =>
        searchDriveChunks({
          query,
          fileIds: candidateFiles.map((file) => file.id),
          limit:
            index < deterministicQueries.length
              ? Math.max(3, request.maxResults)
              : Math.max(4, request.maxResults),
        })
      )
    );

    const laneRows = Array.from(
      new Map(
        laneRowGroups
          .flat()
          .map((row) => [`${row.file_id}:${row.content.slice(0, 180)}`, row])
      ).values()
    );

    const laneMap = laneResults.get(lanePlan.lane) ?? new Map<string, DriveRetrievalResult>();

    for (const row of laneRows) {
      const file = candidateFiles.find((candidate) => candidate.id === row.file_id);
      if (!file) continue;

      const inferredBucket = inferSourceBucketFromPath(file.path, lanePlan.sourceBuckets);
      const inferredClass = inferDocumentClass(file, inferredBucket, lanePlan.requestedDocumentClasses);
      const result = buildRetrievalResult({
        row,
        file,
        request,
        lane: lanePlan.lane,
        laneTopics: lanePlan.topics,
        sourceBucket: inferredBucket,
        documentClass: inferredClass,
      });

      const existing = laneMap.get(result.id);
      if (!existing || result.relevanceScore > existing.relevanceScore) {
        laneMap.set(result.id, result);
      }
    }

    laneResults.set(lanePlan.lane, laneMap);
  }

  const perLaneLimit = Math.max(1, Math.ceil(request.maxResults / Math.max(request.lanePlans.length, 1)));
  const results = request.lanePlans
    .flatMap((lanePlan) =>
      [...(laneResults.get(lanePlan.lane)?.values() ?? [])]
        .sort((left, right) => right.relevanceScore - left.relevanceScore)
        .slice(0, perLaneLimit)
    )
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, request.maxResults);

  return {
    request,
    results,
    usage: {
      topMatchesOnly: true,
      excerptsOnly: true,
      fullDocumentDumpAllowed: false,
    },
  };
}

async function getDriveIndex(): Promise<DriveIndexFile[]> {
  if (driveIndexCache && Date.now() - driveIndexCache.loadedAt < DRIVE_INDEX_TTL_MS) {
    return driveIndexCache.files;
  }

  const driveId = process.env.GOOGLE_SHARED_DRIVE_ID?.trim();
  if (!driveId) {
    throw new Error("Missing GOOGLE_SHARED_DRIVE_ID");
  }

  const labeledRootFolders = getConfiguredDriveRootFolders();

  if (labeledRootFolders.length === 0) {
    throw new Error(
      "Missing root folder env vars: GOOGLE_OEM_PROCEDURES_FOLDER_ID, GOOGLE_OEM_POSITION_STATEMENTS_FOLDER_ID, GOOGLE_PA_LAW_FOLDER_ID"
    );
  }

  const auth = await getDriveAuth();
  const drive = google.drive({ version: "v3", auth });
  const listed = await listDriveFiles(drive, {
    driveId,
    rootFolderIds: labeledRootFolders,
  });
  const files = listed
    .filter((file): file is drive_v3.Schema$File & { path?: string } => Boolean(file.id && file.name))
    .filter((file) => file.mimeType !== "application/vnd.google-apps.folder")
    .map((file) => ({
      id: file.id!,
      name: file.name!,
      path: file.path || file.name || "",
      mimeType: file.mimeType,
    }));

  driveIndexCache = {
    loadedAt: Date.now(),
    files,
  };

  return files;
}

function selectFilesForLane(
  files: DriveIndexFile[],
  sourceBuckets: DriveSourceBucket[]
): DriveIndexFile[] {
  return files.filter((file) =>
    sourceBuckets.some((bucket) => matchesBucketPath(file.path, bucket))
  );
}

function matchesBucketPath(path: string, bucket: DriveSourceBucket): boolean {
  const lower = path.toLowerCase();
  return BUCKET_PATH_HINTS[bucket].some((hint) => lower.includes(hint));
}

function inferSourceBucketFromPath(
  path: string,
  allowedBuckets: DriveSourceBucket[]
): DriveSourceBucket {
  for (const bucket of allowedBuckets) {
    if (matchesBucketPath(path, bucket)) {
      return bucket;
    }
  }

  return allowedBuckets[0] ?? "general_reference";
}

function inferDocumentClass(
  file: DriveIndexFile,
  bucket: DriveSourceBucket,
  requestedDocumentClasses: DriveDocumentType[]
): DriveDocumentType {
  const lower = `${file.name} ${file.path}`.toLowerCase();

  if (bucket === "pa_law") return "state_law_pa";
  if (bucket === "insurer_guidelines") return "insurer_guideline";
  if (bucket === "oem_position_statements") return "oem_position_statement";
  if (lower.includes("adas") || lower.includes("calibration")) return "adas_document";
  if (requestedDocumentClasses.includes("oem_position_statement") && lower.includes("position")) {
    return "oem_position_statement";
  }

  return requestedDocumentClasses[0] ?? "oem_procedure";
}

function buildLaneQuery(
  request: DriveRetrievalRequest,
  laneTopics: DriveTopicInference[]
): string {
  return [
    request.userQuery,
    request.estimateFirstSummary,
    request.vehicle.year ? String(request.vehicle.year) : "",
    request.vehicle.make ?? "",
    request.vehicle.model ?? "",
    ...laneTopics.map((topic) => topic.topic.replace(/_/g, " ")),
    ...laneTopics.flatMap((topic) => topic.triggers),
  ]
    .filter(Boolean)
    .join(" ");
}

export function shouldSearchStateLawLane(request: DriveRetrievalRequest): boolean {
  // State-law-compatible gate, currently PA-backed by existing lane/bucket contracts.
  const lower = `${request.userQuery} ${request.estimateFirstSummary}`.toLowerCase();

  const hasLegalIntent = [
    "negotiate",
    "negotiation",
    "rebuttal",
    "appraisal",
    "appraiser",
    "settlement",
    "consumer rights",
    "aftermarket",
    "diminished value",
    "total loss",
    "statute",
    "law",
    "legal",
  ].some((term) => lower.includes(term));

  const inferredState =
    normalizeStateCode(request.jurisdiction?.stateCode) ??
    inferRequestedStateCode(lower) ??
    inferStateCodeFromVehicleOrEstimateContext(request);

  return hasLegalIntent && Boolean(inferredState);
}

function inferRequestedStateCode(lowerText: string): string | null {
  if (lowerText.includes("pennsylvania") || /\bpa\b/.test(lowerText)) {
    return "PA";
  }

  return null;
}

function inferStateCodeFromVehicleOrEstimateContext(
  request: DriveRetrievalRequest
): string | null {
  const explicitStateCode = normalizeStateCode(request.jurisdiction?.stateCode);
  if (explicitStateCode) {
    return explicitStateCode;
  }

  const stateSignals = [
    request.estimateFirstSummary,
    ...(request.queryHints ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (stateSignals.includes("pennsylvania") || /\bpa\b/.test(stateSignals)) {
    return "PA";
  }

  return null;
}

function normalizeStateCode(stateCode?: string): string | null {
  const normalized = stateCode?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function isStateLawJurisdictionCurrentlyBacked(
  request: DriveRetrievalRequest
): boolean {
  const explicitStateCode = normalizeStateCode(request.jurisdiction?.stateCode);

  // Storage is currently PA-backed, so skip explicit non-PA legal retrieval for now.
  return !explicitStateCode || explicitStateCode === "PA";
}

function buildDeterministicLaneQueries(
  request: DriveRetrievalRequest,
  laneTopics: DriveTopicInference[],
  lane: "oem_lane" | "pa_law_lane"
): string[] {
  if (lane === "pa_law_lane") {
    const lower = `${request.userQuery} ${request.estimateFirstSummary}`.toLowerCase();
    const inferredState =
      normalizeStateCode(request.jurisdiction?.stateCode) ??
      inferRequestedStateCode(lower) ??
      inferStateCodeFromVehicleOrEstimateContext(request) ??
      "PA";
    const primaryTopic = laneTopics[0]?.topic?.replace(/_/g, " ") ?? "";
    const legalTriggers = laneTopics.flatMap((topic) => topic.triggers).slice(0, 3);

    const queries = [
      [inferredState, primaryTopic, request.userQuery].filter(Boolean).join(" ").trim(),
      ...legalTriggers.map((trigger) => [inferredState, trigger].filter(Boolean).join(" ").trim()),
      [inferredState, request.estimateFirstSummary].filter(Boolean).join(" ").trim(),
    ].filter(Boolean);

    return Array.from(new Set(queries)).slice(0, 5);
  }

  const year = request.vehicle.year ? String(request.vehicle.year) : "";
  const make = request.vehicle.make ?? "";
  const model = request.vehicle.model ?? "";
  const trim = request.vehicle.trim ?? "";
  const vehicleCore = [year, make, model].filter(Boolean).join(" ").trim();
  const vehicleWithTrim = [year, make, model, trim].filter(Boolean).join(" ").trim();

  const primaryTopic = laneTopics[0]?.topic?.replace(/_/g, " ") ?? "";
  const primaryTriggers = laneTopics[0]?.triggers?.slice(0, 3) ?? [];

  const queries = [
    vehicleWithTrim,
    [vehicleCore, primaryTopic].filter(Boolean).join(" ").trim(),
    ...primaryTriggers.map((trigger) => [vehicleCore, trigger].filter(Boolean).join(" ").trim()),
  ].filter(Boolean);

  return Array.from(new Set(queries)).slice(0, 5);
}

async function searchDriveChunks(params: {
  query: string;
  fileIds: string[];
  limit: number;
}): Promise<DriveChunkRow[]> {
  if (params.fileIds.length === 0) return [];

  const sourceColumn = await getChunkSourceColumn();
  const sourceFilter = sourceColumn ? `AND ${sourceColumn} = 'google'` : "";
  const vectorLimit = Math.max(4, Math.min(params.limit * 3, 18));
  const keywordLimit = Math.max(3, Math.min(params.limit * 2, 12));
  const queryVector = JSON.stringify(await embedText(params.query));

  const vectorRows = await prisma.$queryRawUnsafe<DriveChunkRow[]>(
    `
      SELECT id, content, file_id, (embedding <-> $1::vector) AS distance
      FROM document_chunks
      WHERE embedding IS NOT NULL
        AND file_id = ANY($2::text[])
        ${sourceFilter}
      ORDER BY distance ASC
      LIMIT $3
    `,
    queryVector,
    params.fileIds,
    vectorLimit
  );

  const keywordRows = await prisma.$queryRawUnsafe<DriveChunkRow[]>(
    `
      SELECT id, content, file_id, NULL AS distance
      FROM document_chunks
      WHERE to_tsvector('english', content) @@ plainto_tsquery($1)
        AND file_id = ANY($2::text[])
        ${sourceFilter}
      LIMIT $3
    `,
    params.query,
    params.fileIds,
    keywordLimit
  );

  const merged = new Map<string, DriveChunkRow>();

  for (const row of [...(vectorRows ?? []), ...(keywordRows ?? [])]) {
    const key = `${row.file_id}:${row.content.slice(0, 180)}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
      continue;
    }

    const existingDistance =
      typeof existing.distance === "number"
        ? existing.distance
        : Number(existing.distance ?? Number.POSITIVE_INFINITY);
    const nextDistance =
      typeof row.distance === "number"
        ? row.distance
        : Number(row.distance ?? Number.POSITIVE_INFINITY);

    if (nextDistance < existingDistance) {
      merged.set(key, row);
    }
  }

  return [...merged.values()].slice(0, params.limit * 2);
}

function buildRetrievalResult(params: {
  row: DriveChunkRow;
  file: DriveIndexFile;
  request: DriveRetrievalRequest;
  lane: "oem_lane" | "pa_law_lane";
  laneTopics: DriveTopicInference[];
  sourceBucket: DriveSourceBucket;
  documentClass: DriveDocumentType;
}): DriveRetrievalResult {
  const pathLower = params.file.path.toLowerCase();
  const contentLower = params.row.content.toLowerCase();
  const relevanceReasons = buildRelevanceReasons(params.laneTopics, pathLower, contentLower);
  const vehicleRelevance = buildVehicleRelevance(params.request, `${params.file.name} ${params.file.path} ${params.row.content}`);
  const jurisdictionRelevance =
    params.sourceBucket === "pa_law"
      ? buildJurisdictionRelevance(`${params.file.name} ${params.file.path} ${params.row.content}`)
      : undefined;
  const score = computeRelevanceScore({
    row: params.row,
    relevanceReasons,
    vehicleRelevance,
    sourceBucket: params.sourceBucket,
    documentClass: params.documentClass,
  });

  const confidence: DriveInferenceConfidence =
    score >= 0.82 ? "high" : score >= 0.62 ? "medium" : "low";

  return {
    id: `${params.lane}:${params.row.file_id}:${params.sourceBucket}:${params.documentClass}`,
    filename: params.file.name,
    documentClass: params.documentClass,
    sourceBucket: params.sourceBucket,
    relevanceScore: score,
    confidence,
    matchReason:
      relevanceReasons[0]?.reason ??
      vehicleRelevance ??
      jurisdictionRelevance ??
      "Matched the requested lane, source bucket, and query context.",
    excerpt: {
      excerpt: params.row.content.slice(0, params.request.maxExcerptChars),
      charCount: Math.min(params.row.content.length, params.request.maxExcerptChars),
    },
    metadata: {
      fileId: params.file.id,
      documentClass: params.documentClass,
      sourceBucket: params.sourceBucket,
      sourceLane: params.sourceBucket === "pa_law" || params.sourceBucket === "insurer_guidelines"
        ? "pa_law_lane"
        : "oem_lane",
      trim: params.request.vehicle.trim,
      make: params.request.vehicle.make,
      model: params.request.vehicle.model,
      yearStart: params.request.vehicle.year,
      topicTags: params.laneTopics.map((topic) => topic.topic),
      procedure: params.laneTopics[0]?.topic.replace(/_/g, " "),
      source: params.file.path,
      system: params.file.path,
      vehicleRelevance,
      jurisdictionRelevance,
    },
    relevanceReasons,
  };
}

function buildRelevanceReasons(
  topics: DriveTopicInference[],
  pathLower: string,
  contentLower: string
): DriveRelevanceReason[] {
  const reasons: DriveRelevanceReason[] = [];

  for (const topic of topics) {
    const supportingTriggers = topic.triggers.filter(
      (trigger) => pathLower.includes(trigger.toLowerCase()) || contentLower.includes(trigger.toLowerCase())
    );

    if (supportingTriggers.length === 0 && !contentLower.includes(topic.topic.replace(/_/g, " "))) {
      continue;
    }

    reasons.push({
      topic: topic.topic,
      reason: topic.rationale,
      supportingTriggers: supportingTriggers.length > 0 ? supportingTriggers : topic.triggers.slice(0, 2),
    });
  }

  return reasons.slice(0, 4);
}

function buildVehicleRelevance(
  request: DriveRetrievalRequest,
  haystack: string
): string | undefined {
  const lower = haystack.toLowerCase();
  const matched: string[] = [];

  if (request.vehicle.make && lower.includes(request.vehicle.make.toLowerCase())) {
    matched.push(request.vehicle.make);
  }
  if (request.vehicle.model && lower.includes(request.vehicle.model.toLowerCase())) {
    matched.push(request.vehicle.model);
  }
  if (request.vehicle.trim && lower.includes(request.vehicle.trim.toLowerCase())) {
    matched.push(request.vehicle.trim);
  }
  if (request.vehicle.year && lower.includes(String(request.vehicle.year))) {
    matched.push(String(request.vehicle.year));
  }

  if (matched.length === 0) return undefined;
  return `Matched vehicle context: ${matched.join(" ")}`;
}

function buildJurisdictionRelevance(haystack: string): string {
  const lower = haystack.toLowerCase();
  if (lower.includes("pennsylvania") || /\bpa\b/.test(lower)) {
    return "Matched Pennsylvania jurisdiction context.";
  }
  return "Retrieved from state-law support.";
}

function computeRelevanceScore(params: {
  row: DriveChunkRow;
  relevanceReasons: DriveRelevanceReason[];
  vehicleRelevance?: string;
  sourceBucket: DriveSourceBucket;
  documentClass: DriveDocumentType;
}): number {
  const distance =
    typeof params.row.distance === "number"
      ? params.row.distance
      : Number(params.row.distance ?? 1.4);
  const vectorScore = Number.isFinite(distance) ? Math.max(0, 1 - Math.min(distance, 1.2) / 1.2) : 0.45;
  const topicBoost = Math.min(params.relevanceReasons.length * 0.12, 0.36);
  const vehicleBoost = params.vehicleRelevance ? 0.08 : 0;
  const bucketBoost =
    params.sourceBucket === "oem_procedures" ? 0.08 :
    params.sourceBucket === "oem_position_statements" ? 0.06 :
    params.sourceBucket === "pa_law" ? 0.07 :
    0.03;
  const classBoost =
    params.documentClass === "oem_procedure" ? 0.05 :
    params.documentClass === "state_law_pa" ? 0.05 :
    params.documentClass === "oem_position_statement" ? 0.04 :
    0.02;

  return Number(Math.min(0.99, vectorScore + topicBoost + vehicleBoost + bucketBoost + classBoost).toFixed(3));
}

export function detectChatTaskType(params: {
  userQuery: string;
  hasDocuments: boolean;
}): ChatbotTaskType {
  const lower = params.userQuery.toLowerCase();

  if (
    lower.includes("part") ||
    lower.includes("aftermarket") ||
    lower.includes("oem part")
  ) {
    return "part_lookup";
  }

  if (
    lower.includes("procedure") ||
    lower.includes("oem") ||
    lower.includes("calibration") ||
    lower.includes("scan")
  ) {
    return "oem_procedure_insight";
  }

  if (
    lower.includes("photo") ||
    lower.includes("picture") ||
    lower.includes("image")
  ) {
    return "photo_review";
  }

  if (
    params.hasDocuments &&
    (lower.includes("compare") || lower.includes("carrier") || lower.includes("shop"))
  ) {
    return "document_comparison";
  }

  if (params.hasDocuments) {
    return "estimate_review";
  }

  return "general_chat";
}

export function buildDriveRefinementContext(response: DriveRetrievalResponse): string {
  if (response.results.length === 0) {
    return "";
  }

  const sections = response.request.lanePlans.map((lanePlan) => {
    const laneResults = response.results.filter(
      (result) => result.metadata.sourceLane === lanePlan.lane
    );

    if (laneResults.length === 0) return "";

  const laneLabel = lanePlan.lane === "oem_lane" ? "OEM Support" : "State Law Support";
    return [
      `${laneLabel}:`,
      ...laneResults.map((result) => {
        const reasons = result.relevanceReasons.map((reason) => reason.reason).join(" | ");
        const vehicle = result.metadata.vehicleRelevance ? ` | ${result.metadata.vehicleRelevance}` : "";
        const jurisdiction = result.metadata.jurisdictionRelevance ? ` | ${result.metadata.jurisdictionRelevance}` : "";
        return `- [${result.documentClass}] ${result.filename} | bucket=${result.sourceBucket} | score=${result.relevanceScore}${vehicle}${jurisdiction}
  reason: ${result.matchReason}${reasons ? ` | ${reasons}` : ""}
  excerpt: ${result.excerpt.excerpt}`;
      }),
    ].join("\n");
  });

  return sections.filter(Boolean).join("\n\n");
}
