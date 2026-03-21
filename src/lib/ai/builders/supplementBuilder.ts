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

export function buildSupplementLines(
  result: AnalysisResult | RepairIntelligenceReport | AnalysisFinding[]
): SupplementLine[] {
  const findings = Array.isArray(result)
    ? result
    : "findings" in result
      ? result.findings
      : legacyReportToFindings(result);

  const lines: SupplementLine[] = [];

  for (const finding of findings) {
    if (finding.status === "present") continue;

    const title = normalizeTitle(finding.title);
    const lower = title.toLowerCase();

    if (includesAny(lower, ["scan"])) {
      lines.push({
        title,
        category: "scan",
        rationale:
          "Required for fault discovery, verification, and documented post-repair system status.",
        support: finding.detail,
      });
      continue;
    }

    if (includesAny(lower, ["calibration", "radar", "camera", "steering angle"])) {
      lines.push({
        title,
        category: "calibration",
        rationale:
          "Required to verify proper system function after repair and support a defensible repair process.",
        support: finding.detail,
      });
      continue;
    }

    if (includesAny(lower, ["cavity wax", "corrosion", "seam sealer"])) {
      lines.push({
        title,
        category: "material",
        rationale:
          "Required to restore corrosion protection and material integrity after repair or replacement.",
        support: finding.detail,
      });
      continue;
    }

    if (includesAny(lower, ["refinish", "blend", "polish", "tint"])) {
      lines.push({
        title,
        category: "refinish",
        rationale:
          "Required to complete finish operations to proper repair and appearance standards.",
        support: finding.detail,
      });
      continue;
    }

    if (includesAny(lower, ["rail", "frame", "pillar", "apron", "structural"])) {
      lines.push({
        title,
        category: "structural",
        rationale:
          "Required to support structural repair completeness, measurement, or verification.",
        support: finding.detail,
      });
      continue;
    }

    lines.push({
      title,
      category: "labor",
      rationale:
        "Not clearly represented in the estimate and should be clarified or supplemented to support repair completeness.",
      support: finding.detail,
    });
  }

  return dedupeLines(lines);
}

function dedupeLines(lines: SupplementLine[]): SupplementLine[] {
  const seen = new Map<string, SupplementLine>();

  for (const line of lines) {
    const key = `${line.category}:${line.title}`.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, line);
      continue;
    }

    const existing = seen.get(key)!;
    seen.set(key, {
      ...existing,
      support:
        existing.support === line.support
          ? existing.support
          : [existing.support, line.support].filter(Boolean).join(" "),
    });
  }

  return [...seen.values()];
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function legacyReportToFindings(report: RepairIntelligenceReport): AnalysisFinding[] {
  return [
    ...report.issues.map((issue, index) => ({
      id: `legacy-issue-${index + 1}`,
      bucket: "compliance" as const,
      category: issue.missingOperation ? "not_detected" as const : "unclear" as const,
      title: issue.title,
      detail: issue.impact || issue.finding,
      severity: issue.severity,
      status: issue.missingOperation ? "not_detected" as const : "unclear" as const,
      evidence: [],
    })),
    ...report.missingProcedures.map((procedure, index) => ({
      id: `legacy-missing-${index + 1}`,
      bucket: "supplement" as const,
      category: "not_detected" as const,
      title: procedure,
      detail: "This operation is not clearly represented in the current estimate.",
      severity: "medium" as const,
      status: "not_detected" as const,
      evidence: [],
    })),
  ];
}
