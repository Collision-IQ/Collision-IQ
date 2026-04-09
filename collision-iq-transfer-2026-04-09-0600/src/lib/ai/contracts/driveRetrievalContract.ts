import type { ChatAnalysisOutput, ChatbotTaskType } from "./chatAnalysisSchema";
import {
  extractVehicleIdentityFromText,
  mergeVehicleIdentity,
  normalizeVehicleIdentity,
} from "../vehicleContext";
import type { VehicleApplicabilityRating } from "../vehicleApplicability";

export const DRIVE_RETRIEVAL_TOPICS = [
  "adas_calibration",
  "pre_scan",
  "post_scan",
  "headlamp_aim",
  "structural_measurement",
  "frame_setup_realignment",
  "upper_tie_bar_lock_support_radiator_support",
  "corrosion_protection_cavity_wax_seam_sealer",
  "weld_prep_weld_protection",
  "replace_vs_repair",
  "fit_sensitive_oem_parts",
  "one_time_use_hardware",
  "restraint_srs_verification",
  "aftermarket_non_oem_parts_dispute",
  "appraisal_rights",
  "consumer_repair_rights",
  "total_loss_valuation",
  "diminished_value",
  "claim_handling_policy_dispute",
  "labor_rate_reimbursement",
] as const;

export type DriveRetrievalTopic = (typeof DRIVE_RETRIEVAL_TOPICS)[number];

export type DriveDocumentType =
  | "oem_procedure"
  | "oem_position_statement"
  | "adas_document"
  | "state_law_pa"
  | "insurer_guideline"
  | "general_reference";

export type DriveSourceBucket =
  | "oem_procedures"
  | "oem_position_statements"
  | "pa_law"
  | "insurer_guidelines"
  | "general_reference";

export type DriveSourceTarget =
  | "oem_only"
  | "oem_and_position_statements"
  | "pa_law_only"
  | "oem_and_pa_law"
  | "all_relevant_sources";

export type DriveSourceHint =
  | "oem_procedures_folder"
  | "oem_position_statements_folder"
  | "pa_law_folder"
  | "insurer_guidelines_folder"
  | "general_reference_folder";

export type DriveRetrievalMode =
  | "repair_mode"
  | "claim_mode"
  | "mixed_mode";

export type DriveRetrievalLane = "oem_lane" | "pa_law_lane";

export type DriveInferenceConfidence = "low" | "medium" | "high";

export type DriveVehicleInferenceSource =
  | "analysis_output"
  | "estimate_text"
  | "user_query"
  | "vin_decode_hint"
  | "unknown";

export type DriveVehicleContext = {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  trim?: string;
  manufacturer?: string;
  confidence: DriveInferenceConfidence;
  sources: DriveVehicleInferenceSource[];
  fieldSources?: Partial<Record<"year" | "make" | "model" | "vin" | "trim" | "manufacturer", string>>;
  mismatches?: string[];
};

export type DriveJurisdictionSource =
  | "shop_profile"
  | "user_setting"
  | "client_input"
  | "query_inferred"
  | "unknown";

export type DriveJurisdictionContext = {
  stateCode?: string;
  confidence: DriveInferenceConfidence;
  source: DriveJurisdictionSource;
};

export type DriveTopicInference = {
  topic: DriveRetrievalTopic;
  confidence: DriveInferenceConfidence;
  triggers: string[];
  rationale: string;
};

export type DriveRetrievalLifecycle = {
  stage:
    | "estimate_reviewed"
    | "vehicle_inferred"
    | "topics_inferred"
    | "mode_inferred"
    | "retrieval_request_ready";
  estimateReviewed: boolean;
  vehicleInferenceReady: boolean;
  topicInferenceReady: boolean;
  modeInferenceReady: boolean;
};

export type DriveRetrievalLanePlan = {
  lane: DriveRetrievalLane;
  sourceTarget: DriveSourceTarget;
  sourceBuckets: DriveSourceBucket[];
  sourceHints: DriveSourceHint[];
  requestedDocumentClasses: DriveDocumentType[];
  topics: DriveTopicInference[];
};

export type DriveRetrievalRequest = {
  strategy: "post_understanding_drive_retrieval";
  lifecycle: DriveRetrievalLifecycle;
  taskType: ChatbotTaskType;
  userQuery: string;
  estimateFirstSummary: string;
  jurisdiction?: DriveJurisdictionContext;
  vehicle: DriveVehicleContext;
  topics: DriveTopicInference[];
  retrievalMode: DriveRetrievalMode;
  targetLanes: DriveRetrievalLane[];
  lanePlans: DriveRetrievalLanePlan[];
  queryHints: string[];
  sourceTarget: DriveSourceTarget;
  sourceBuckets: DriveSourceBucket[];
  sourceHints: DriveSourceHint[];
  requestedDocumentClasses: DriveDocumentType[];
  maxResults: number;
  maxExcerptChars: number;
};

export type DriveResultMetadata = {
  fileId?: string;
  documentClass: DriveDocumentType;
  sourceBucket: DriveSourceBucket;
  sourceLane: DriveRetrievalLane;
  make?: string;
  model?: string;
  trim?: string;
  yearStart?: number;
  yearEnd?: number;
  topicTags?: DriveRetrievalTopic[];
  system?: string;
  procedure?: string;
  source?: string;
  pageHint?: string;
  vehicleRelevance?: string;
  vehicleMatchLevel?: VehicleApplicabilityRating;
  vehicleApplicabilityReason?: string;
  vehicleSignals?: string[];
  jurisdictionRelevance?: string;
};

export type DriveResultExcerpt = {
  excerpt: string;
  charCount: number;
  pageLabel?: string;
};

export type DriveRelevanceReason = {
  topic: DriveRetrievalTopic;
  reason: string;
  supportingTriggers: string[];
};

export type DriveRetrievalResult = {
  id: string;
  filename: string;
  documentClass: DriveDocumentType;
  sourceBucket: DriveSourceBucket;
  relevanceScore: number;
  confidence: DriveInferenceConfidence;
  matchReason: string;
  excerpt: DriveResultExcerpt;
  metadata: DriveResultMetadata;
  relevanceReasons: DriveRelevanceReason[];
};

export type DriveRetrievalResponse = {
  request: DriveRetrievalRequest;
  results: DriveRetrievalResult[];
  usage: {
    topMatchesOnly: true;
    excerptsOnly: true;
    fullDocumentDumpAllowed: false;
  };
};

type BuildDriveRetrievalRequestParams = {
  taskType: ChatbotTaskType;
  userQuery: string;
  estimateText?: string;
  jurisdiction?: DriveJurisdictionContext;
  analysis?: Pick<
    ChatAnalysisOutput,
    "summary" | "repairStrategy" | "keyDrivers" | "missingOperations" | "vehicleIdentification"
  > | null;
  maxResults?: number;
  maxExcerptChars?: number;
};

type ResolveDriveJurisdictionParams = {
  explicit?: DriveJurisdictionContext;
  userQuery?: string;
};

const DRIVE_TOPIC_RULES: Array<{
  topic: DriveRetrievalTopic;
  keywords: string[];
  rationale: string;
}> = [
  {
    topic: "adas_calibration",
    keywords: ["adas", "calibration", "camera", "radar", "sensor", "blind spot", "lane keep"],
    rationale: "The estimate or analysis suggests sensor, camera, radar, or ADAS-related verification needs.",
  },
  {
    topic: "pre_scan",
    keywords: ["pre-scan", "pre scan", "pre-repair scan", "diagnostic before repair"],
    rationale: "The estimate or analysis points to pre-repair scanning requirements.",
  },
  {
    topic: "post_scan",
    keywords: ["post-scan", "post scan", "post-repair scan", "final scan"],
    rationale: "The estimate or analysis points to post-repair scan or final verification requirements.",
  },
  {
    topic: "headlamp_aim",
    keywords: ["headlamp aim", "headlamp aiming", "lamp aim", "aiming procedure"],
    rationale: "The repair path suggests headlamp or aiming procedures may be required.",
  },
  {
    topic: "structural_measurement",
    keywords: ["structural measurement", "measure", "measuring", "datum", "benchmark", "dimension"],
    rationale: "The repair path suggests structural measurement or documented verification needs.",
  },
  {
    topic: "frame_setup_realignment",
    keywords: ["frame setup", "setup", "pull", "realignment", "straightening", "rack time"],
    rationale: "The repair path suggests setup, pull, or realignment burden.",
  },
  {
    topic: "upper_tie_bar_lock_support_radiator_support",
    keywords: ["upper tie bar", "tie bar", "lock support", "radiator support", "core support", "upper rail", "support area"],
    rationale: "The repair path suggests front support-structure scope or reconciliation needs.",
  },
  {
    topic: "corrosion_protection_cavity_wax_seam_sealer",
    keywords: ["corrosion protection", "cavity wax", "seam sealer", "anti-corrosion", "weld-through", "refinish protection"],
    rationale: "The repair path suggests corrosion restoration or cavity-wax-related procedures.",
  },
  {
    topic: "weld_prep_weld_protection",
    keywords: ["weld prep", "weld protection", "weld-through", "weld primer", "spot weld", "mig braze"],
    rationale: "The repair path suggests weld preparation or weld-protection procedures.",
  },
  {
    topic: "replace_vs_repair",
    keywords: ["replace vs repair", "repair vs replace", "replace only", "do not repair", "repair allowable"],
    rationale: "The estimate or analysis raises a replace-versus-repair decision point.",
  },
  {
    topic: "fit_sensitive_oem_parts",
    keywords: ["fit-sensitive", "fit sensitive", "oem", "aftermarket", "gap", "flushness", "stack-up"],
    rationale: "The repair path suggests fit-sensitive parts posture or OEM-versus-aftermarket implications.",
  },
  {
    topic: "one_time_use_hardware",
    keywords: ["one-time-use", "one time use", "replace hardware", "replace fastener", "non-reusable bolt"],
    rationale: "The repair path suggests one-time-use hardware requirements.",
  },
  {
    topic: "restraint_srs_verification",
    keywords: ["srs", "airbag", "seat belt", "pretensioner", "restraint", "occupant protection"],
    rationale: "The repair path suggests restraint-system or SRS-related procedures.",
  },
  {
    topic: "aftermarket_non_oem_parts_dispute",
    keywords: ["aftermarket", "non-oem", "oem parts", "fit-sensitive", "parts dispute"],
    rationale: "The question or repair path raises aftermarket, non-OEM, or OEM parts posture issues.",
  },
  {
    topic: "appraisal_rights",
    keywords: ["appraisal", "right to appraisal", "invoke appraisal"],
    rationale: "The question raises appraisal rights or right-to-appraisal issues.",
  },
  {
    topic: "consumer_repair_rights",
    keywords: ["consumer rights", "repair rights", "choice of repair shop", "repair rights act"],
    rationale: "The question raises consumer or repair-rights issues.",
  },
  {
    topic: "total_loss_valuation",
    keywords: ["total loss", "actual cash value", "acv", "valuation dispute", "market valuation"],
    rationale: "The question raises total-loss or valuation issues.",
  },
  {
    topic: "diminished_value",
    keywords: ["diminished value", "dv", "loss in value"],
    rationale: "The question raises diminished-value issues.",
  },
  {
    topic: "claim_handling_policy_dispute",
    keywords: ["claim handling", "bad faith", "policy dispute", "claim dispute", "coverage dispute"],
    rationale: "The question raises claim-handling or policy-dispute issues.",
  },
  {
    topic: "labor_rate_reimbursement",
    keywords: ["labor rate", "reimbursement", "prevailing rate", "reimburse", "rate dispute"],
    rationale: "The question raises labor-rate or reimbursement issues.",
  },
];

const REPAIR_TOPICS = new Set<DriveRetrievalTopic>([
  "adas_calibration",
  "pre_scan",
  "post_scan",
  "headlamp_aim",
  "structural_measurement",
  "frame_setup_realignment",
  "upper_tie_bar_lock_support_radiator_support",
  "corrosion_protection_cavity_wax_seam_sealer",
  "weld_prep_weld_protection",
  "replace_vs_repair",
  "fit_sensitive_oem_parts",
  "one_time_use_hardware",
  "restraint_srs_verification",
]);

const CLAIM_TOPICS = new Set<DriveRetrievalTopic>([
  "aftermarket_non_oem_parts_dispute",
  "appraisal_rights",
  "consumer_repair_rights",
  "total_loss_valuation",
  "diminished_value",
  "claim_handling_policy_dispute",
  "labor_rate_reimbursement",
]);

const REPAIR_MODE_KEYWORDS = [
  "estimate",
  "repair",
  "procedure",
  "oem",
  "compliance",
  "adas",
  "calibration",
  "scan",
  "structural",
  "fit",
  "alignment",
] as const;

const CLAIM_MODE_KEYWORDS = [
  "rebuttal",
  "negotiation",
  "appraisal",
  "right to appraisal",
  "aftermarket",
  "consumer rights",
  "insurer",
  "obligation",
  "diminished value",
  "total loss",
  "acv",
  "settlement",
  "policy",
  "claim handling",
  "coverage",
] as const;

export function inferDriveVehicleContext(params: {
  estimateText?: string;
  userQuery?: string;
  analysisVehicle?: (ChatAnalysisOutput["vehicleIdentification"] & { trim?: string; manufacturer?: string }) | null;
}): DriveVehicleContext {
  const analysisVehicle = normalizeVehicleIdentity(params.analysisVehicle ?? undefined);
  const attachmentVehicle = extractVehicleIdentityFromText(params.estimateText ?? "", "attachment");
  const userVehicle = extractVehicleIdentityFromText(params.userQuery ?? "", "user");
  const resolved = mergeVehicleIdentity(analysisVehicle, attachmentVehicle, userVehicle);

  const sources = new Set<DriveVehicleInferenceSource>();
  if (analysisVehicle?.year || analysisVehicle?.make || analysisVehicle?.model || analysisVehicle?.vin) {
    sources.add("analysis_output");
  }
  if (params.estimateText && (attachmentVehicle?.year || attachmentVehicle?.make || attachmentVehicle?.model || attachmentVehicle?.vin || attachmentVehicle?.trim)) {
    sources.add("estimate_text");
  }
  if (params.userQuery && (userVehicle?.year || userVehicle?.make || userVehicle?.model || userVehicle?.vin || userVehicle?.trim)) {
    sources.add("user_query");
  }
  if (resolved?.fieldSources && Object.values(resolved.fieldSources).includes("vin_decoded")) {
    sources.add("vin_decode_hint");
  }

  const populatedFields = [
    resolved?.year,
    resolved?.make,
    resolved?.model,
    resolved?.vin,
    resolved?.trim,
    resolved?.manufacturer,
  ].filter(Boolean).length;
  const confidence: DriveInferenceConfidence =
    populatedFields >= 4 || Boolean(resolved?.vin)
      ? "high"
      : populatedFields >= 2
        ? "medium"
        : populatedFields >= 1
          ? "low"
          : "low";

  return {
    year: resolved?.year,
    make: resolved?.make,
    model: resolved?.model,
    vin: resolved?.vin,
    trim: resolved?.trim,
    manufacturer: resolved?.manufacturer,
    confidence,
    sources: [...sources].length > 0 ? [...sources] : ["unknown"],
    fieldSources: resolved?.fieldSources,
    mismatches: resolved?.mismatches,
  };
}

export function inferDriveRetrievalTopics(params: {
  estimateText?: string;
  userQuery?: string;
  analysis?: Pick<
    ChatAnalysisOutput,
    "summary" | "repairStrategy" | "keyDrivers" | "missingOperations"
  > | null;
}): DriveTopicInference[] {
  const haystack = [
    params.estimateText,
    params.userQuery,
    params.analysis?.summary?.overview,
    params.analysis?.repairStrategy?.overallAssessment,
    ...(params.analysis?.repairStrategy?.repairVsReplace ?? []),
    ...(params.analysis?.repairStrategy?.structuralImplications ?? []),
    ...(params.analysis?.repairStrategy?.calibrationImplications ?? []),
    ...(params.analysis?.keyDrivers ?? []),
    ...(params.analysis?.missingOperations?.map((item) => `${item.operation} ${item.reason}`) ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return DRIVE_TOPIC_RULES.flatMap((rule) => {
    const triggers = rule.keywords.filter((keyword) => haystack.includes(keyword));
    if (triggers.length === 0) return [];

    const confidence: DriveInferenceConfidence =
      triggers.length >= 3 ? "high" : triggers.length === 2 ? "medium" : "low";

    return [
      {
        topic: rule.topic,
        confidence,
        triggers,
        rationale: rule.rationale,
      },
    ];
  });
}

export function inferDriveRetrievalMode(params: {
  userQuery?: string;
  taskType?: ChatbotTaskType;
  topics: DriveTopicInference[];
}): DriveRetrievalMode {
  const lowerQuery = (params.userQuery ?? "").toLowerCase();
  const hasRepairTopics = params.topics.some((topic) => REPAIR_TOPICS.has(topic.topic));
  const hasClaimTopics = params.topics.some((topic) => CLAIM_TOPICS.has(topic.topic));
  const hasRepairKeywords = REPAIR_MODE_KEYWORDS.some((keyword) => lowerQuery.includes(keyword));
  const hasClaimKeywords = CLAIM_MODE_KEYWORDS.some((keyword) => lowerQuery.includes(keyword));
  const taskType = params.taskType ?? "estimate_review";

  if (
    hasClaimTopics &&
    (hasRepairTopics ||
      hasRepairKeywords ||
      taskType === "estimate_review" ||
      taskType === "oem_procedure_insight")
  ) {
    return "mixed_mode";
  }

  if (
    hasClaimKeywords &&
    (hasRepairTopics || hasRepairKeywords || taskType === "estimate_review")
  ) {
    return "mixed_mode";
  }

  if (hasClaimTopics || hasClaimKeywords) {
    return "claim_mode";
  }

  return "repair_mode";
}

export function inferDriveRetrievalLanes(
  mode: DriveRetrievalMode
): DriveRetrievalLane[] {
  switch (mode) {
    case "claim_mode":
      return ["pa_law_lane"];
    case "mixed_mode":
      return ["oem_lane", "pa_law_lane"];
    case "repair_mode":
    default:
      return ["oem_lane"];
  }
}

export function buildDriveRetrievalLanePlans(params: {
  topics: DriveTopicInference[];
  retrievalMode: DriveRetrievalMode;
}): DriveRetrievalLanePlan[] {
  return inferDriveRetrievalLanes(params.retrievalMode).map((lane) => {
    const laneTopics = inferTopicsForLane(params.topics, lane);
    const sourceBuckets = inferSourceBucketsForLane(laneTopics, lane);

    return {
      lane,
      topics: laneTopics,
      sourceTarget: inferSourceTargetForLane(sourceBuckets),
      sourceBuckets,
      sourceHints: inferSourceHintsForBuckets(sourceBuckets),
      requestedDocumentClasses: inferRequestedDocumentClassesForLane(laneTopics, lane),
    };
  });
}

export function buildDriveRetrievalRequest(
  params: BuildDriveRetrievalRequestParams
): DriveRetrievalRequest | null {
  const vehicle = inferDriveVehicleContext({
    estimateText: params.estimateText,
    userQuery: params.userQuery,
    analysisVehicle: params.analysis?.vehicleIdentification ?? null,
  });

  const topics = inferDriveRetrievalTopics({
    estimateText: params.estimateText,
    userQuery: params.userQuery,
    analysis: params.analysis
      ? {
          summary: params.analysis.summary,
          repairStrategy: params.analysis.repairStrategy,
          keyDrivers: params.analysis.keyDrivers,
          missingOperations: params.analysis.missingOperations,
        }
      : null,
  });

  const fallbackTopics = topics.length === 0
    ? inferFallbackTopics({
        userQuery: params.userQuery,
        taskType: params.taskType,
      })
    : [];
  const resolvedTopics = topics.length > 0 ? topics : fallbackTopics;

  if (resolvedTopics.length === 0) {
    return null;
  }

  const retrievalMode = inferDriveRetrievalMode({
    userQuery: params.userQuery,
    taskType: params.taskType,
    topics: resolvedTopics,
  });
  const lanePlans = buildDriveRetrievalLanePlans({
    topics: resolvedTopics,
    retrievalMode,
  });

  const estimateFirstSummary =
    params.analysis?.summary?.overview ||
    params.analysis?.repairStrategy?.overallAssessment ||
    summarizeEstimateForRetrieval(params.estimateText, params.userQuery);

  const jurisdiction = resolveDriveJurisdictionContext({
    explicit: params.jurisdiction,
    userQuery: params.userQuery,
  });

  return {
    strategy: "post_understanding_drive_retrieval",
    lifecycle: {
      stage: "retrieval_request_ready",
      estimateReviewed: true,
      vehicleInferenceReady: Boolean(vehicle.make || vehicle.model || vehicle.vin || vehicle.year),
      topicInferenceReady: resolvedTopics.length > 0,
      modeInferenceReady: true,
    },
    taskType: params.taskType,
    userQuery: params.userQuery,
    estimateFirstSummary,
    jurisdiction,
    vehicle,
    topics: resolvedTopics,
    retrievalMode,
    targetLanes: lanePlans.map((plan) => plan.lane),
    lanePlans,
    queryHints: buildQueryHints({
      vehicle,
      jurisdiction,
      topics: resolvedTopics,
      keyDrivers: params.analysis?.keyDrivers ?? [],
      missingOperations:
        params.analysis?.missingOperations?.map((item) => item.operation) ?? [],
    }),
    sourceTarget: inferSourceTargetForLanePlans(lanePlans),
    sourceBuckets: dedupeLanePlans(lanePlans.flatMap((plan) => plan.sourceBuckets)),
    sourceHints: dedupeLanePlans(lanePlans.flatMap((plan) => plan.sourceHints)),
    requestedDocumentClasses: dedupeLanePlans(
      lanePlans.flatMap((plan) => plan.requestedDocumentClasses)
    ),
    maxResults: params.maxResults ?? 5,
    maxExcerptChars: params.maxExcerptChars ?? 500,
  };
}

function inferFallbackTopics(params: {
  userQuery: string;
  taskType: ChatbotTaskType;
}): DriveTopicInference[] {
  const lower = params.userQuery.toLowerCase();

  if (
    params.taskType === "oem_procedure_insight" ||
    params.taskType === "estimate_review" ||
    /\b(repair|procedure|oem|compliance|calibration|scan|structural)\b/.test(lower)
  ) {
    return [
      {
        topic: "replace_vs_repair",
        confidence: "low",
        triggers: ["general repair/procedure context"],
        rationale: "The request is repair- or OEM-procedure-oriented, so OEM support may refine the answer.",
      },
    ];
  }

  if (
    /\b(rebuttal|negotiation|appraisal|aftermarket|consumer rights|settlement|claim handling|acv|dv|diminished value|total loss)\b/.test(lower)
  ) {
    return [
      {
        topic: "claim_handling_policy_dispute",
        confidence: "low",
        triggers: ["general claim/legal context"],
        rationale: "The request is claim-handling- or rights-oriented, so state-law support may refine the answer.",
      },
    ];
  }

  return [];
}

function summarizeEstimateForRetrieval(
  estimateText: string | undefined,
  userQuery: string
): string {
  const compactEstimate = (estimateText ?? "").replace(/\s+/g, " ").trim().slice(0, 500);

  if (compactEstimate) {
    return compactEstimate;
  }

  return userQuery.trim();
}

function inferJurisdictionFromQuery(userQuery?: string): DriveJurisdictionContext | undefined {
  const lower = (userQuery ?? "").toLowerCase();

  if (lower.includes("pennsylvania") || /\bpa\b/.test(lower)) {
    return {
      stateCode: "PA",
      confidence: "medium",
      source: "query_inferred",
    };
  }

  return undefined;
}

function resolveDriveJurisdictionContext(
  params: ResolveDriveJurisdictionParams
): DriveJurisdictionContext | undefined {
  if (params.explicit?.stateCode) {
    return params.explicit;
  }

  return inferJurisdictionFromQuery(params.userQuery);
}

function buildQueryHints(params: {
  vehicle: DriveVehicleContext;
  jurisdiction?: DriveJurisdictionContext;
  topics: DriveTopicInference[];
  keyDrivers: string[];
  missingOperations: string[];
}): string[] {
  return [
    params.jurisdiction?.stateCode ?? "",
    params.vehicle.year ? String(params.vehicle.year) : "",
    params.vehicle.make ?? "",
    params.vehicle.manufacturer ?? "",
    params.vehicle.model ?? "",
    params.vehicle.trim ?? "",
    params.vehicle.vin ?? "",
    ...params.topics.map((topic) => topic.topic),
    ...params.keyDrivers,
    ...params.missingOperations,
  ].filter(Boolean);
}

export function inferRequestedDocumentClasses(
  topics: DriveTopicInference[],
  retrievalMode?: DriveRetrievalMode
): DriveDocumentType[] {
  const lanePlans = buildDriveRetrievalLanePlans({
    topics,
    retrievalMode: retrievalMode ?? inferDriveRetrievalMode({ topics }),
  });
  return dedupeLanePlans(lanePlans.flatMap((plan) => plan.requestedDocumentClasses));
}

function inferRequestedDocumentClassesForLane(
  topics: DriveTopicInference[],
  lane: DriveRetrievalLane
): DriveDocumentType[] {
  const docTypes = new Set<DriveDocumentType>();

  if (lane === "oem_lane") {
    docTypes.add("oem_procedure");
  }

  for (const topic of topics) {
    if (lane === "oem_lane") {
      if (["adas_calibration", "headlamp_aim"].includes(topic.topic)) {
        docTypes.add("adas_document");
      }

      if (
        [
          "structural_measurement",
          "frame_setup_realignment",
          "upper_tie_bar_lock_support_radiator_support",
          "corrosion_protection_cavity_wax_seam_sealer",
          "weld_prep_weld_protection",
          "replace_vs_repair",
          "fit_sensitive_oem_parts",
          "aftermarket_non_oem_parts_dispute",
          "one_time_use_hardware",
          "restraint_srs_verification",
        ].includes(topic.topic)
      ) {
        docTypes.add("oem_position_statement");
      }
    }

    if (lane === "pa_law_lane") {
      if (
        [
          "aftermarket_non_oem_parts_dispute",
          "appraisal_rights",
          "consumer_repair_rights",
          "total_loss_valuation",
          "diminished_value",
          "claim_handling_policy_dispute",
          "labor_rate_reimbursement",
        ].includes(topic.topic)
      ) {
        docTypes.add("state_law_pa");
      }
    }
  }

  return [...docTypes];
}

export function inferSourceBuckets(
  topics: DriveTopicInference[],
  retrievalMode?: DriveRetrievalMode
): DriveSourceBucket[] {
  const lanePlans = buildDriveRetrievalLanePlans({
    topics,
    retrievalMode: retrievalMode ?? inferDriveRetrievalMode({ topics }),
  });
  return dedupeLanePlans(lanePlans.flatMap((plan) => plan.sourceBuckets));
}

function inferSourceBucketsForLane(
  topics: DriveTopicInference[],
  lane: DriveRetrievalLane
): DriveSourceBucket[] {
  const buckets = new Set<DriveSourceBucket>();

  for (const topic of topics) {
    if (
      lane === "oem_lane" &&
      [
        "adas_calibration",
        "pre_scan",
        "post_scan",
        "headlamp_aim",
        "structural_measurement",
        "frame_setup_realignment",
        "upper_tie_bar_lock_support_radiator_support",
        "corrosion_protection_cavity_wax_seam_sealer",
        "weld_prep_weld_protection",
        "replace_vs_repair",
        "fit_sensitive_oem_parts",
        "one_time_use_hardware",
        "restraint_srs_verification",
        "aftermarket_non_oem_parts_dispute",
      ].includes(topic.topic)
    ) {
      buckets.add("oem_procedures");
    }

    if (
      lane === "oem_lane" &&
      [
        "replace_vs_repair",
        "fit_sensitive_oem_parts",
        "aftermarket_non_oem_parts_dispute",
      ].includes(topic.topic)
    ) {
      buckets.add("oem_position_statements");
    }

    if (
      lane === "pa_law_lane" &&
      [
        "appraisal_rights",
        "consumer_repair_rights",
        "total_loss_valuation",
        "diminished_value",
        "claim_handling_policy_dispute",
        "labor_rate_reimbursement",
        "aftermarket_non_oem_parts_dispute",
      ].includes(topic.topic)
    ) {
      buckets.add("pa_law");
    }
  }

  if (buckets.size === 0) {
    buckets.add(lane === "pa_law_lane" ? "pa_law" : "oem_procedures");
  }

  return [...buckets];
}

export function inferSourceTarget(
  topics: DriveTopicInference[],
  retrievalMode?: DriveRetrievalMode
): DriveSourceTarget {
  const lanePlans = buildDriveRetrievalLanePlans({
    topics,
    retrievalMode: retrievalMode ?? inferDriveRetrievalMode({ topics }),
  });
  return inferSourceTargetForLanePlans(lanePlans);
}

function inferSourceTargetForLane(sourceBuckets: DriveSourceBucket[]): DriveSourceTarget {
  const buckets = sourceBuckets;
  const hasOem =
    buckets.includes("oem_procedures") || buckets.includes("oem_position_statements");
  const hasPaLaw = buckets.includes("pa_law");
  const hasPositionStatements = buckets.includes("oem_position_statements");

  if (hasOem && hasPaLaw && buckets.length > 2) return "all_relevant_sources";
  if (hasOem && hasPaLaw) return "oem_and_pa_law";
  if (hasPaLaw && !hasOem) return "pa_law_only";
  if (hasPositionStatements) return "oem_and_position_statements";
  return "oem_only";
}

function inferSourceTargetForLanePlans(
  lanePlans: DriveRetrievalLanePlan[]
): DriveSourceTarget {
  return inferSourceTargetForLane(dedupeLanePlans(lanePlans.flatMap((plan) => plan.sourceBuckets)));
}

export function inferSourceHints(
  topics: DriveTopicInference[],
  retrievalMode?: DriveRetrievalMode
): DriveSourceHint[] {
  const buckets = inferSourceBuckets(
    topics,
    retrievalMode ?? inferDriveRetrievalMode({ topics })
  );
  return inferSourceHintsForBuckets(buckets);
}

function inferSourceHintsForBuckets(buckets: DriveSourceBucket[]): DriveSourceHint[] {
  return buckets.map((bucket) => {
    switch (bucket) {
      case "oem_procedures":
        return "oem_procedures_folder";
      case "oem_position_statements":
        return "oem_position_statements_folder";
      case "pa_law":
        return "pa_law_folder";
      case "insurer_guidelines":
        return "insurer_guidelines_folder";
      case "general_reference":
      default:
        return "general_reference_folder";
    }
  });
}

function inferTopicsForLane(
  topics: DriveTopicInference[],
  lane: DriveRetrievalLane
): DriveTopicInference[] {
  return topics.filter((topic) =>
    lane === "oem_lane"
      ? REPAIR_TOPICS.has(topic.topic) || topic.topic === "aftermarket_non_oem_parts_dispute"
      : CLAIM_TOPICS.has(topic.topic)
  );
}

function dedupeLanePlans<T>(values: T[]): T[] {
  return [...new Set(values)];
}
