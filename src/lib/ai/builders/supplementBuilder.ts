import type {
  AnalysisFinding,
  AnalysisResult,
  RepairIntelligenceReport,
} from "../types/analysis";

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
  candidates: SupplementCandidate[]
): SupplementCandidate[] {
  const lower = text.toLowerCase();

  return candidates.filter((item) => {
    const title = item.title.toLowerCase();

    if (
      (title.includes("calibration") && lower.includes("calibration")) ||
      (title.includes("scan") && lower.includes("post-repair scan"))
    ) {
      return false;
    }

    return true;
  });
}

export function inferCategory(title: string): SupplementLine["category"] {
  const lower = title.toLowerCase();

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
    title: item.title,
    category: inferCategory(item.title),
    rationale: item.reason,
  }));
}
