import type { EstimateOperation } from "../extractors/estimateExtractor";

export interface ProcedureRule {
  id: string;
  component: string;
  triggerKeywords: string[];
  procedures: Array<{
    name: string;
    aliases?: string[];
    severity: "medium" | "high";
    category:
      | "adas"
      | "scanning"
      | "compliance"
      | "safety"
      | "supplement";
    rationale: string;
    evidenceBasis: string;
  }>;
  requiresAnyOperation?: boolean;
}

export interface RequiredProcedure {
  id: string;
  procedure: string;
  aliases: string[];
  severity: "medium" | "high";
  category: ProcedureRule["procedures"][number]["category"];
  rationale: string;
  evidenceBasis: string;
  trigger: string;
  matchedOperation: string;
}

const SCAN_EVIDENCE_PATTERNS = [
  /pre-?repair scan/i,
  /pre-?scan/i,
  /post-?repair scan/i,
  /post-?scan/i,
  /diagnostic scan/i,
  /final scan/i,
];

export const procedureRules: ProcedureRule[] = [
  {
    id: "front-bumper-adas",
    component: "bumper",
    triggerKeywords: ["front bumper", "bumper cover", "bumper assy", "grille", "radar bracket"],
    procedures: [
      {
        name: "ACC radar calibration",
        aliases: ["acc calibration", "radar calibration", "adaptive cruise calibration"],
        severity: "high",
        category: "adas",
        rationale: "Front bumper service can disturb radar mounting and aiming.",
        evidenceBasis: "OEM Procedure / ADAS Report / Professional Standard of Care",
      },
      {
        name: "KAFAS camera calibration",
        aliases: ["camera calibration", "forward camera calibration", "adas camera calibration"],
        severity: "high",
        category: "adas",
        rationale: "Front-end disassembly can affect camera alignment and targeting.",
        evidenceBasis: "OEM Procedure / ADAS Report / Professional Standard of Care",
      },
    ],
  },
  {
    id: "headlamp-front-end",
    component: "headlamp",
    triggerKeywords: ["headlamp", "headlight", "lamp assy", "radiator support", "core support"],
    procedures: [
      {
        name: "Headlamp aiming check",
        aliases: ["headlamp aim", "headlight aim"],
        severity: "medium",
        category: "safety",
        rationale: "Headlamp removal or front support movement requires aim verification.",
        evidenceBasis: "OEM Procedure / Professional Standard of Care",
      },
      {
        name: "KAFAS camera calibration",
        aliases: ["camera calibration", "forward camera calibration", "adas camera calibration"],
        severity: "high",
        category: "adas",
        rationale: "Front lamp and surrounding structure changes affect camera alignment.",
        evidenceBasis: "OEM Procedure / ADAS Report / Professional Standard of Care",
      },
    ],
  },
  {
    id: "collision-scan",
    component: "collision",
    triggerKeywords: [],
    requiresAnyOperation: true,
    procedures: [
      {
        name: "Pre-repair scan",
        aliases: ["pre scan", "pre-scan", "diagnostic scan"],
        severity: "high",
        category: "scanning",
        rationale: "Collision repairs require fault discovery before repairs begin.",
        evidenceBasis: "OEM Position Statement / Industry Research / Professional Standard of Care",
      },
      {
        name: "Post-repair scan",
        aliases: ["post scan", "post-scan", "final scan"],
        severity: "high",
        category: "scanning",
        rationale: "Post-repair verification confirms systems are restored after repair.",
        evidenceBasis: "OEM Position Statement / Industry Research / Professional Standard of Care",
      },
    ],
  },
  {
    id: "replacement-materials",
    component: "panel replacement",
    triggerKeywords: ["door shell", "quarter panel", "rocker", "pillar", "apron", "wheelhouse"],
    procedures: [
      {
        name: "Corrosion protection materials",
        aliases: ["corrosion protection", "cavity wax", "rust proofing", "anti-corrosion"],
        severity: "medium",
        category: "supplement",
        rationale: "Replacement panel operations typically require corrosion protection restoration.",
        evidenceBasis: "OEM Procedure / Estimating Platform Procedure / Professional Standard of Care",
      },
      {
        name: "Seam sealer application",
        aliases: ["seam sealer", "seam sealing"],
        severity: "medium",
        category: "supplement",
        rationale: "Panel replacement commonly requires seam sealer restoration and materials.",
        evidenceBasis: "OEM Procedure / Estimating Platform Procedure / Professional Standard of Care",
      },
    ],
  },
];

export function detectProcedures(
  operations: EstimateOperation[]
): RequiredProcedure[] {
  const requiredProcedures: RequiredProcedure[] = [];
  const alreadyHasScanEvidence = operations.some((operation) =>
    SCAN_EVIDENCE_PATTERNS.some((pattern) =>
      pattern.test(operation.rawLine) ||
      pattern.test(operation.component) ||
      pattern.test(operation.operation)
    )
  );

  for (const rule of procedureRules) {
    if (rule.requiresAnyOperation) {
      if (operations.length === 0 || alreadyHasScanEvidence) continue;

      for (const procedure of rule.procedures) {
        requiredProcedures.push({
          id: `${rule.id}:${procedure.name}`,
          procedure: procedure.name,
          aliases: procedure.aliases ?? [],
          severity: procedure.severity,
          category: procedure.category,
          rationale: procedure.rationale,
          evidenceBasis: procedure.evidenceBasis,
          trigger: rule.component,
          matchedOperation: "Collision repair operations detected in estimate",
        });
      }
      continue;
    }

    for (const operation of operations) {
      const component = operation.component.toLowerCase();

      if (!rule.triggerKeywords.some((keyword) => component.includes(keyword))) {
        continue;
      }

      for (const procedure of rule.procedures) {
        requiredProcedures.push({
          id: `${rule.id}:${procedure.name}`,
          procedure: procedure.name,
          aliases: procedure.aliases ?? [],
          severity: procedure.severity,
          category: procedure.category,
          rationale: procedure.rationale,
          evidenceBasis: procedure.evidenceBasis,
          trigger: rule.component,
          matchedOperation: `${operation.operation} ${operation.component}`.trim(),
        });
      }
    }
  }

  return dedupeProcedures(requiredProcedures);
}

function dedupeProcedures(
  procedures: RequiredProcedure[]
): RequiredProcedure[] {
  const seen = new Map<string, RequiredProcedure>();

  for (const procedure of procedures) {
    const key = procedure.procedure.toLowerCase();
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, procedure);
      continue;
    }

    seen.set(key, {
      ...existing,
      matchedOperation: `${existing.matchedOperation}; ${procedure.matchedOperation}`,
      trigger: `${existing.trigger}; ${procedure.trigger}`,
      severity:
        existing.severity === "high" || procedure.severity === "high"
          ? "high"
          : "medium",
    });
  }

  return [...seen.values()];
}
