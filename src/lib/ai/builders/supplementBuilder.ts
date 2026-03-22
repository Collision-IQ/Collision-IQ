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
  if (!text) return [];

  const map = buildFunctionMap(text);
  const lines: SupplementLine[] = [];

  if (!map["post-scan"]) {
    lines.push({
      title: "Post-Repair Scan",
      category: "scan",
      rationale: "Not clearly represented in estimate.",
    });
  }

  if (!map["calibration"]) {
    lines.push({
      title: "System Calibration",
      category: "calibration",
      rationale: "Not clearly represented in estimate.",
    });
  }

  return lines;
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

  return candidates.filter((item) => {
    const title = normalizeSupplementTitle(item.title).toLowerCase();
    const canonicalKey = inferCanonicalProcedureKey(title);
    const adasProcedure = canonicalKey
      ? isAdasProcedure(canonicalKey)
      : looksLikeAdasSupplementTitle(title);

    if (canonicalKey && representedMatches.some((match) => match.key === canonicalKey)) {
      return false;
    }

    if (
      (title.includes("calibration") && representedText.includes("calibration")) ||
      (title.includes("scan") && representedText.includes("post-repair scan"))
    ) {
      return false;
    }

    if (adasProcedure && !isProcedureRequired(canonicalKey, title, requiredProcedureText, requiredProcedureMatches)) {
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
  if (lower.includes("seam") || lower.includes("corrosion")) return "material";

  return "labor";
}

export function buildSupplementLinesHybrid(
  validatedItems: SupplementCandidate[]
): SupplementLine[] {
  return validatedItems.map((item) => ({
    title: normalizeSupplementTitle(item.title),
    category: inferCategory(item.title),
    rationale: item.reason,
  }));
}

function normalizeSupplementTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  if (lower.includes("kafas")) {
    return "Forward Camera Calibration";
  }

  return normalized;
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
