import type {
  AnalysisFinding,
  AnalysisResult,
  RepairIntelligenceReport,
} from "../types/analysis";
import {
  CANONICAL_PROCEDURES,
  findProcedureMatches,
  type CanonicalProcedureKey,
} from "../procedureEquivalence";
import {
  deriveStructuralApplicabilityFromResult,
  filterStructuralTitles,
} from "../structuralApplicability";
import { buildRepairStory } from "./buildRepairStory";

export type SupplementLine = {
  title: string;
  category:
    | "labor"
    | "material"
    | "scan"
    | "calibration"
    | "refinish"
    | "structural";
  rationale: string;
  support?: string;
  amount?: string;
};

type RepairFunction = {
  name: string;
  signals: string[];
};

type SupplementCandidate = {
  title: string;
  reason: string;
  sourceType?: "missing" | "support_gap" | "proactive_oem";
  supportState?: "missing" | "partial" | "proactive";
};

export type SupplementValidationContext = {
  requiredProcedures?: string[];
  presentProcedures?: string[];
  missingProcedures?: string[];
};

const FUNCTIONS: RepairFunction[] = [
  {
    name: "pre-scan",
    signals: ["pre-repair scan", "pre repair scan", "pre-scan"],
  },
  {
    name: "post-scan",
    signals: ["post-repair scan", "post repair scan", "post-scan", "final scan"],
  },
  {
    name: "calibration",
    signals: [
      "calibration",
      "adas report",
      "blind spot",
      "parking sensor",
      "parking assist",
    ],
  },
];

export function detectFunctionPresence(text: string, signals: string[]): boolean {
  const lower = text.toLowerCase();
  return signals.some((signal) => lower.includes(signal));
}

export function buildFunctionMap(text: string) {
  const map: Record<string, boolean> = {};

  for (const repairFunction of FUNCTIONS) {
    map[repairFunction.name] = detectFunctionPresence(text, repairFunction.signals);
  }

  return map;
}

export function buildSupplementLines(
  result: AnalysisResult | RepairIntelligenceReport | AnalysisFinding[]
): SupplementLine[] {
  const text = extractTextForFunctions(result);
  const context = extractValidationContext(result);
  const candidates = Array.isArray(result)
    ? extractSupplementCandidates(result)
    : filterStructuralTitles(
        extractSupplementCandidates(result),
        deriveStructuralApplicabilityFromResult(result)
      );

  if (candidates.length === 0) {
    return [];
  }

  const validatedCandidates = validateSupplements(text, candidates, context);
  return buildSupplementLinesHybrid(validatedCandidates, text);
}

function extractTextForFunctions(
  result: AnalysisResult | RepairIntelligenceReport | AnalysisFinding[]
): string {
  if (Array.isArray(result)) {
    return result.map((finding) => `${finding.title} ${finding.detail}`).join("\n");
  }

  if ("findings" in result) {
    return result.rawEstimateText ?? "";
  }

  return result.evidence.map((entry) => entry.snippet).join("\n");
}

export function validateSupplements(
  text: string,
  candidates: SupplementCandidate[],
  context?: SupplementValidationContext
): SupplementCandidate[] {
  const representedText = [
    text,
    ...(context?.presentProcedures ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const representedMatches = findProcedureMatches(representedText);
  const requiredProcedureMatches = findProcedureMatches(
    [...(context?.requiredProcedures ?? []), ...(context?.missingProcedures ?? [])]
      .filter(Boolean)
      .join("\n")
  );
  const requiredProcedureText = [
    ...(context?.requiredProcedures ?? []),
    ...(context?.missingProcedures ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const hasCavityWaxCoverage =
    representedText.includes("cavity wax") || representedText.includes("corrosion protection");
  const hasPreScanCoverage =
    representedText.includes("pre-repair scan") ||
    representedText.includes("pre repair scan") ||
    representedText.includes("pre-scan");
  const hasInProcessScanCoverage =
    representedText.includes("in-process repair scan") ||
    representedText.includes("in process repair scan") ||
    representedText.includes("in-process scan") ||
    representedText.includes("in process scan");
  const hasPostScanCoverage =
    representedText.includes("post-repair scan") ||
    representedText.includes("post repair scan") ||
    representedText.includes("post-scan") ||
    representedText.includes("final scan");
  const functionMap: Record<string, string[]> = {
    "pre-repair scan": [
      "pre-repair scan",
      "pre repair scan",
      "pre-scan",
      "diagnostic scan",
    ],
    "post-repair scan": [
      "post-repair scan",
      "post repair scan",
      "post scan",
      "final scan",
      "vehicle diagnostics",
    ],
    calibration: [
      "calibration",
      "adas report",
      "blind spot",
      "parking sensor",
      "parking assist",
      "radar",
    ],
  };

  return candidates.filter((item) => {
    const title = normalizeSupplementTitle(item.title).toLowerCase();
    const canonicalKey = inferCanonicalProcedureKey(title);
    const adasProcedure = canonicalKey
      ? isAdasProcedure(canonicalKey)
      : looksLikeAdasSupplementTitle(title);
    const scanProcedure = looksLikeScanSupplementTitle(title);
    const corrosionProtectionOnly =
      title.includes("corrosion") && !title.includes("seam") && !title.includes("weld");
    const proactiveOem = item.sourceType === "proactive_oem";
    const clearlyRepresented = isClearlyRepresentedEstimateImprovement(
      title,
      representedText
    );

    if (
      canonicalKey &&
      representedMatches.some((match) => match.key === canonicalKey) &&
      (!proactiveOem || clearlyRepresented)
    ) {
      return false;
    }

    if (
      ((title.includes("pre-repair scan") && hasPreScanCoverage) ||
        (title.includes("in-process") && hasInProcessScanCoverage) ||
        (title.includes("post-repair scan") && hasPostScanCoverage)) &&
      (!proactiveOem || clearlyRepresented)
    ) {
      return false;
    }

    if (corrosionProtectionOnly && hasCavityWaxCoverage && (!proactiveOem || clearlyRepresented)) {
      return false;
    }

    for (const [functionName, keywords] of Object.entries(functionMap)) {
      if (
        title.includes(functionName) &&
        hasFunction(representedText, keywords) &&
        (!proactiveOem || clearlyRepresented)
      ) {
        return false;
      }
    }

    if (
      scanProcedure &&
      !proactiveOem &&
      !isProcedureRequired(canonicalKey, title, requiredProcedureText, requiredProcedureMatches)
    ) {
      return false;
    }

    if (
      adasProcedure &&
      !proactiveOem &&
      !isProcedureRequired(canonicalKey, title, requiredProcedureText, requiredProcedureMatches)
    ) {
      return false;
    }

    if (proactiveOem && clearlyRepresented) {
      return false;
    }

    return true;
  });
}

export function inferCategory(title: string): SupplementLine["category"] {
  const lower = normalizeSupplementTitle(title).toLowerCase();

  if (lower.includes("scan")) return "scan";
  if (lower.includes("calibration")) return "calibration";
  if (lower.includes("refinish")) return "refinish";
  if (
    lower.includes("seam") ||
    lower.includes("corrosion") ||
    lower.includes("hardware") ||
    lower.includes("clip") ||
    lower.includes("fastener")
  ) {
    return "material";
  }
  if (
    lower.includes("measure") ||
    lower.includes("realignment") ||
    lower.includes("setup") ||
    lower.includes("tie bar") ||
    lower.includes("lock support") ||
    lower.includes("core support") ||
    lower.includes("upper rail") ||
    lower.includes("deck opening") ||
    lower.includes("rear body")
  ) {
    return "structural";
  }

  return "labor";
}

export function buildSupplementLinesHybrid(
  validatedItems: SupplementCandidate[],
  evidenceText = ""
): SupplementLine[] {
  const seen = new Set<string>();

  return curateSupplementCandidates(validatedItems, evidenceText)
    .map((item) => ({
      title: normalizeSupplementTitle(item.title),
      category: inferCategory(item.title),
      rationale: item.reason,
    }))
    .filter((item) => {
      const key = item.title.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeSupplementTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  if (lower.includes("kafas")) {
    return "Forward Camera Calibration";
  }

  if (
    lower.includes("one-time-use") ||
    lower.includes("one time use") ||
    lower.includes("fastener") ||
    /\bclip(s)?\b/i.test(lower) ||
    /\bseal(s)?\b/i.test(lower) ||
    /\bretainer(s)?\b/i.test(lower)
  ) {
    return "One-Time-Use Hardware / Seals / Clips";
  }

  if (
    lower.includes("test-fit") ||
    lower.includes("test fit") ||
    lower.includes("mock-up") ||
    lower.includes("mock up") ||
    lower.includes("fit-sensitive")
  ) {
    return "Pre-Paint Test Fit";
  }

  if (lower.includes("cavity wax") || lower.includes("seam sealer") || lower.includes("corrosion-protection")) {
    return "Corrosion Protection / Weld Restoration";
  }

  if (lower.includes("weld-prep") || lower.includes("weld prep") || lower.includes("weld-protection") || lower.includes("weld protection")) {
    return "Corrosion Protection / Weld Restoration";
  }

  if (hasDirectAlignmentSignal(lower)) {
    return "Four-Wheel Alignment";
  }

  if (
    lower.includes("adas") ||
    lower.includes("calibration") ||
    lower.includes("camera") ||
    lower.includes("radar") ||
    lower.includes("sensor")
  ) {
    return "ADAS / Calibration Procedure Support";
  }

  return normalized;
}

function curateSupplementCandidates(
  candidates: SupplementCandidate[],
  text: string
): SupplementCandidate[] {
  if (candidates.length <= 1) return candidates;

  let storyText = "";
  if (text.trim()) {
    try {
      const story = buildRepairStory(text);
      storyText = [story.impact, ...story.zones, ...story.panels].join(" ");
    } catch {
      storyText = "";
    }
  }

  const evidenceText = `${text}\n${storyText}`.toLowerCase();
  const normalized = candidates.map((item) => ({
    ...item,
    title: normalizeSupplementTitle(item.title),
  }));
  const frontSpecificExists = normalized.some(
    (item) =>
      inferSupplementConceptFamily(item.title) === "front_structure_scope" &&
      !isGenericSupplementTitle(item.title)
  );
  const rearSpecificExists = normalized.some(
    (item) =>
      inferSupplementConceptFamily(item.title) === "rear_structure_scope" &&
      !isGenericSupplementTitle(item.title)
  );
  const filtered = normalized
    .filter((item) => {
      const title = item.title;

      if (title === "Four-Wheel Alignment" && !hasAlignmentEvidence(evidenceText)) {
        return false;
      }

      if (title === "One-Time-Use Hardware / Seals / Clips" && !hasHardwareEvidence(evidenceText)) {
        return false;
      }

      if (
        title === "Structural Measurement Verification" &&
        !hasMeasurementEvidence(evidenceText) &&
        (frontSpecificExists || rearSpecificExists)
      ) {
        return false;
      }

      if (
        title === "Hidden Mounting Geometry / Teardown Growth" &&
        frontSpecificExists &&
        hasSupportScopeEvidence(evidenceText)
      ) {
        return false;
      }

      return true;
    })
    .sort((left, right) => scoreCuratedSupplementCandidate(right) - scoreCuratedSupplementCandidate(left));

  const kept: SupplementCandidate[] = [];
  const seenFamilies = new Set<string>();
  let genericFallbacks = 0;

  for (const item of filtered) {
    const family = inferSupplementConceptFamily(item.title);
    const generic = isGenericSupplementTitle(item.title);

    if (generic && genericFallbacks >= 1) {
      continue;
    }

    if (generic && seenFamilies.has(family)) {
      continue;
    }

    kept.push(item);
    if (family !== "other") {
      seenFamilies.add(family);
    }
    if (generic) {
      genericFallbacks += 1;
    }
  }

  return kept;
}

function inferSupplementConceptFamily(title: string): string {
  const lower = normalizeSupplementTitle(title).toLowerCase();

  if (
    lower.includes("front structure") ||
    lower.includes("tie bar") ||
    lower.includes("lock support") ||
    lower.includes("core support") ||
    lower.includes("upper rail") ||
    lower.includes("support area") ||
    lower.includes("hidden mounting")
  ) {
    return "front_structure_scope";
  }
  if (
    lower.includes("rear body") ||
    lower.includes("deck opening") ||
    lower.includes("bumper reinforcement") ||
    lower.includes("bumper absorber") ||
    lower.includes("rear sensor") ||
    lower.includes("blind spot") ||
    lower.includes("deck lid") ||
    lower.includes("latch") ||
    lower.includes("striker")
  ) {
    return "rear_structure_scope";
  }
  if (lower.includes("test fit") || lower.includes("fit-sensitive")) return "fit_verification";
  if (lower.includes("alignment")) return "alignment";
  if (lower.includes("hardware") || lower.includes("clip") || lower.includes("fastener")) return "hardware";
  if (lower.includes("measure") || lower.includes("setup") || lower.includes("realignment")) {
    return "structural_measurement";
  }
  if (
    lower.includes("scan") ||
    lower.includes("calibration") ||
    lower.includes("sensor") ||
    lower.includes("aim")
  ) {
    return "verification";
  }
  if (lower.includes("corrosion") || lower.includes("seam") || lower.includes("weld")) {
    return "corrosion";
  }
  return "other";
}

function isGenericSupplementTitle(title: string): boolean {
  return [
    "Four-Wheel Alignment",
    "One-Time-Use Hardware / Seals / Clips",
    "Structural Measurement Verification",
    "Hidden Mounting Geometry / Teardown Growth",
  ].includes(normalizeSupplementTitle(title));
}

function scoreCuratedSupplementCandidate(item: SupplementCandidate): number {
  const lower = `${item.title} ${item.reason}`.toLowerCase();
  let score = item.reason.length;

  if (item.supportState === "missing") score += 70;
  if (item.supportState === "partial") score += 40;
  if (lower.includes("front structure") || lower.includes("tie bar") || lower.includes("lock support")) score += 80;
  if (lower.includes("rear body") || lower.includes("deck opening") || lower.includes("bumper reinforcement")) score += 80;
  if (lower.includes("test fit") || lower.includes("fit-sensitive")) score += 60;
  if (lower.includes("sensor") || lower.includes("radar") || lower.includes("calibration")) score += 45;
  if (isGenericSupplementTitle(item.title)) score -= 40;

  return score;
}

function hasDirectAlignmentSignal(value: string): boolean {
  return (
    value.includes("four-wheel alignment") ||
    value.includes("4-wheel alignment") ||
    value.includes("4 wheel alignment") ||
    value.includes("wheel alignment") ||
    value.includes("toe") ||
    value.includes("camber") ||
    value.includes("caster")
  );
}

function hasAlignmentEvidence(value: string): boolean {
  return (
    hasDirectAlignmentSignal(value) ||
    value.includes("suspension") ||
    value.includes("steering") ||
    value.includes("subframe")
  );
}

function hasHardwareEvidence(value: string): boolean {
  return (
    value.includes("one-time-use") ||
    value.includes("one time use") ||
    value.includes("hardware") ||
    value.includes("fastener") ||
    value.includes("retainer") ||
    /\bclip(s)?\b/i.test(value) ||
    /\bseal(s)?\b/i.test(value)
  );
}

function hasMeasurementEvidence(value: string): boolean {
  return (
    /(measure|measurement|measuring)/.test(value) ||
    /\bframe\b/.test(value) ||
    /\bbench\b/.test(value) ||
    /\bsetup\b/.test(value) ||
    /\bpull\b/.test(value) ||
    /realign(?:ment)?/.test(value) ||
    /dimension(?:s|al)?/.test(value) ||
    /\bdatum\b/.test(value) ||
    /\bgeometry\b/.test(value) ||
    /structural verification/.test(value) ||
    hasVerifiedStructuralZoneEvidence(value)
  );
}

function hasSupportScopeEvidence(value: string): boolean {
  return (
    value.includes("tie bar") ||
    value.includes("lock support") ||
    value.includes("core support") ||
    value.includes("radiator support") ||
    value.includes("support area") ||
    value.includes("upper rail") ||
    value.includes("guide") ||
    value.includes("bracket") ||
    value.includes("mount")
  );
}

function hasVerifiedStructuralZoneEvidence(value: string): boolean {
  return (
    /\b(?:rail|apron)\b.{0,40}\b(?:measure|measurement|measuring|verify|verification|setup|pull|realign|datum|geometry|dimension)\b/.test(
      value
    ) ||
    /\b(?:measure|measurement|measuring|verify|verification|setup|pull|realign|datum|geometry|dimension)\b.{0,40}\b(?:rail|apron)\b/.test(
      value
    )
  );
}

function hasFunction(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();

  return keywords.some((keyword) => lower.includes(keyword));
}

function inferCanonicalProcedureKey(
  title: string
): CanonicalProcedureKey | null {
  const normalizedTitle = title.toLowerCase();

  for (const procedure of CANONICAL_PROCEDURES) {
    if (
      procedure.label.toLowerCase() === normalizedTitle ||
      procedure.aliases.some((alias) => alias.toLowerCase() === normalizedTitle) ||
      procedure.aliases.some((alias) => normalizedTitle.includes(alias.toLowerCase())) ||
      normalizedTitle.includes(procedure.label.toLowerCase())
    ) {
      return procedure.key;
    }
  }

  return null;
}

function isAdasProcedure(key: CanonicalProcedureKey): boolean {
  return (
    key.includes("camera") ||
    key.includes("radar") ||
    key === "lane_change_calibration" ||
    key === "lane_departure_calibration" ||
    key === "steering_angle_calibration" ||
    key === "adas_report"
  );
}

function looksLikeAdasSupplementTitle(title: string): boolean {
  return (
    title.includes("camera") ||
    title.includes("radar") ||
    title.includes("adas") ||
    title.includes("blind spot") ||
    title.includes("lane") ||
    title.includes("steering angle") ||
    title.includes("calibration")
  );
}

function looksLikeScanSupplementTitle(title: string): boolean {
  return title.includes("scan");
}

function isProcedureRequired(
  canonicalKey: CanonicalProcedureKey | null,
  title: string,
  requiredProcedureText: string,
  requiredProcedureMatches: ReturnType<typeof findProcedureMatches>
): boolean {
  if (canonicalKey) {
    return requiredProcedureMatches.some((match) => match.key === canonicalKey);
  }

  return CANONICAL_PROCEDURES.some((procedure) => {
    if (!isAdasProcedure(procedure.key)) return false;

    return (
      requiredProcedureText.includes(procedure.label.toLowerCase()) &&
      (title.includes(procedure.label.toLowerCase()) ||
        procedure.aliases.some(
          (alias) =>
            title.includes(alias.toLowerCase()) ||
            alias.toLowerCase().includes(title)
        ))
    );
  });
}

function extractValidationContext(
  result: AnalysisResult | RepairIntelligenceReport | AnalysisFinding[]
): SupplementValidationContext | undefined {
  if (Array.isArray(result)) {
    return undefined;
  }

  if ("findings" in result) {
    return {
      requiredProcedures: result.findings
        .filter((finding) => finding.status !== "present")
        .map((finding) => finding.title),
      presentProcedures: result.findings
        .filter((finding) => finding.status === "present")
        .map((finding) => finding.title),
      missingProcedures: result.supplements.map((finding) => finding.title),
    };
  }

  return {
    requiredProcedures: result.requiredProcedures.map((procedure) => procedure.procedure),
    presentProcedures: result.presentProcedures,
    missingProcedures: result.missingProcedures,
  };
}

function extractSupplementCandidates(
  result: AnalysisResult | RepairIntelligenceReport | AnalysisFinding[]
): SupplementCandidate[] {
  if (Array.isArray(result)) {
    return result
      .filter((finding) => finding.status !== "present")
      .map<SupplementCandidate>((finding) => ({
        title: normalizeSupplementTitle(finding.title),
        reason: finding.detail,
        sourceType: "support_gap",
        supportState: "partial",
      }));
  }

  if ("findings" in result) {
    return [
      ...result.supplements.map<SupplementCandidate>((finding) => ({
        title: normalizeSupplementTitle(finding.title),
        reason: finding.detail,
        sourceType: "support_gap",
        supportState: "partial",
      })),
      ...result.findings
        .filter((finding) => finding.status !== "present")
        .map<SupplementCandidate>((finding) => ({
          title: normalizeSupplementTitle(finding.title),
          reason: finding.detail,
          sourceType: "support_gap",
          supportState: "partial",
        })),
    ];
  }

  return [
    ...result.missingProcedures.map<SupplementCandidate>((procedure) => ({
      title: normalizeSupplementTitle(procedure),
      reason: "This procedure is not clearly represented in the current estimate.",
      sourceType: "missing" as const,
      supportState: "missing" as const,
    })),
    ...result.supplementOpportunities.map((item) => classifySupplementOpportunity(item)),
    ...result.requiredProcedures
      .filter((procedure) =>
        !result.presentProcedures.some(
          (present) => normalizeSupplementTitle(present).toLowerCase() === normalizeSupplementTitle(procedure.procedure).toLowerCase()
        )
      )
      .map<SupplementCandidate>((procedure) => ({
        title: normalizeSupplementTitle(procedure.procedure),
        reason: procedure.reason,
        sourceType: "missing" as const,
        supportState: "missing" as const,
      })),
    ...result.issues
      .filter((issue) => issue.missingOperation || issue.category === "calibration" || issue.category === "scan")
      .map<SupplementCandidate>((issue) => ({
        title: normalizeSupplementTitle(issue.missingOperation ?? issue.title),
        reason: issue.impact || issue.finding,
        sourceType: issue.missingOperation ? ("missing" as const) : ("support_gap" as const),
        supportState: issue.missingOperation ? ("missing" as const) : ("partial" as const),
      })),
  ];
}

function classifySupplementOpportunity(item: string): SupplementCandidate {
  const normalizedTitle = normalizeSupplementTitle(item);
  const proactiveOem = /\boem support in\b/i.test(item) || /\bposition statement\b/i.test(item);
  const partialSupport =
    /\bbetter documented\b/i.test(item) ||
    /\bcarried or documented\b/i.test(item) ||
    /\breflected if\b/i.test(item) ||
    /\bmay still need\b/i.test(item) ||
    /\bremains open\b/i.test(item);

  return {
    title: normalizedTitle,
    reason: item,
    sourceType: proactiveOem ? "proactive_oem" : "support_gap",
    supportState: proactiveOem ? (partialSupport ? "partial" : "proactive") : "partial",
  };
}

function isClearlyRepresentedEstimateImprovement(title: string, representedText: string): boolean {
  if (!representedText.trim()) return false;

  if (
    title.includes("one-time-use hardware") ||
    title.includes("seal") ||
    title.includes("clip")
  ) {
    return hasFunction(representedText, [
      "replace hardware",
      "replaced hardware",
      "one-time-use",
      "one time use",
      "non-reusable",
      "new clips",
      "new seals",
      "new fasteners",
    ]);
  }

  if (title.includes("corrosion protection") || title.includes("weld restoration")) {
    return hasFunction(representedText, [
      "corrosion protection",
      "cavity wax",
      "seam sealer",
      "anti-corrosion",
      "weld protection",
      "weld-through primer",
      "weld thru primer",
      "refinish protection",
    ]);
  }

  if (title.includes("pre-paint test fit")) {
    return hasFunction(representedText, [
      "pre-paint test fit",
      "pre paint test fit",
      "mock-up",
      "mock up",
      "fit verification",
      "pre-finish fit confirmation",
    ]);
  }

  if (title.includes("alignment")) {
    return hasFunction(representedText, [
      "four-wheel alignment",
      "4-wheel alignment",
      "4 wheel alignment",
      "alignment check",
      "wheel alignment",
    ]);
  }

  if (title.includes("adas") || title.includes("calibration")) {
    return (
      hasFunction(representedText, ["calibration", "adas"]) &&
      hasFunction(representedText, ["scan", "verification", "aim", "alignment", "documentation"])
    );
  }

  if (/refinish|blend|mask|tint|let-?down|polish|sand/.test(title)) {
    return hasFunction(representedText, [
      "refinish",
      "blend",
      "masking",
      "tint",
      "let-down",
      "let down",
      "polish",
      "color sand",
    ]);
  }

  return false;
}
