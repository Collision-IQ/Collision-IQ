import { ParsedEstimate } from "./estimateParser"

export interface ProcedureRule {
  id: string
  trigger: string
  triggerKeywords: string[]
  procedures: Array<{
    name: string
    aliases?: string[]
    severity: "medium" | "high"
    category:
      | "adas"
      | "scanning"
      | "safety"
      | "supplement"
      | "structural"
    evidenceBasis: string
    rationale: string
  }>
  requiresAnyEstimateOperation?: boolean
}

export interface ProcedureRequirement {
  id: string
  procedure: string
  aliases: string[]
  reason: string
  category: ProcedureRule["procedures"][number]["category"]
  severity: "medium" | "high"
  evidenceBasis: string
  sourceTrigger: string
  matchedOperation: string
}

const SCAN_EVIDENCE_PATTERNS = [
  /pre-?repair scan/i,
  /pre-?scan/i,
  /post-?repair scan/i,
  /post-?scan/i,
  /diagnostic scan/i,
  /final scan/i,
]

export const procedureRules: ProcedureRule[] = [
  {
    id: "front-bumper-adas",
    trigger: "front bumper service",
    triggerKeywords: ["front bumper", "bumper cover", "bumper assy", "grille", "radar bracket"],
    procedures: [
      {
        name: "ACC radar calibration",
        aliases: ["radar calibration", "adaptive cruise calibration", "acc calibration"],
        severity: "high",
        category: "adas",
        evidenceBasis: "OEM Procedure / Professional Standard of Care",
        rationale: "Front bumper work can disturb forward radar mounting and aiming.",
      },
      {
        name: "KAFAS camera calibration",
        aliases: ["camera calibration", "adas camera calibration", "forward camera calibration"],
        severity: "high",
        category: "adas",
        evidenceBasis: "OEM Procedure / Professional Standard of Care",
        rationale: "Front-end repairs can affect camera aiming and ADAS alignment.",
      },
    ],
  },
  {
    id: "headlamp-front-end",
    trigger: "headlamp or front-end component service",
    triggerKeywords: ["headlamp", "headlight", "lamp assy", "radiator support", "core support"],
    procedures: [
      {
        name: "Headlamp aiming check",
        aliases: ["headlamp aim", "headlight aim"],
        severity: "medium",
        category: "safety",
        evidenceBasis: "OEM Procedure / Professional Standard of Care",
        rationale: "Lamp removal or front-end movement requires beam aim verification.",
      },
      {
        name: "KAFAS camera calibration",
        aliases: ["camera calibration", "adas camera calibration", "forward camera calibration"],
        severity: "high",
        category: "adas",
        evidenceBasis: "OEM Procedure / Professional Standard of Care",
        rationale: "Front lamp and adjacent support repairs can affect camera alignment.",
      },
    ],
  },
  {
    id: "windshield-camera",
    trigger: "windshield or mirror mounting service",
    triggerKeywords: ["windshield", "glass", "rear view mirror", "camera bracket"],
    procedures: [
      {
        name: "Forward camera calibration",
        aliases: ["camera calibration", "adas camera calibration"],
        severity: "high",
        category: "adas",
        evidenceBasis: "OEM Procedure / Professional Standard of Care",
        rationale: "Glass and camera bracket service directly impacts camera calibration.",
      },
    ],
  },
  {
    id: "structural-or-suspension",
    trigger: "structural or suspension repair",
    triggerKeywords: [
      "rail",
      "sidemember",
      "apron",
      "strut tower",
      "suspension",
      "control arm",
      "subframe",
      "frame",
      "quarter panel",
    ],
    procedures: [
      {
        name: "Wheel alignment",
        aliases: ["alignment", "four wheel alignment", "4 wheel alignment"],
        severity: "high",
        category: "safety",
        evidenceBasis: "OEM Procedure / Professional Standard of Care",
        rationale: "Structural and suspension repairs require geometry verification.",
      },
      {
        name: "Steering angle sensor reset",
        aliases: ["sas reset", "steering angle calibration", "steering angle sensor calibration"],
        severity: "medium",
        category: "adas",
        evidenceBasis: "OEM Procedure / Professional Standard of Care",
        rationale: "Post-alignment and suspension work often requires sensor reset.",
      },
    ],
  },
  {
    id: "replacement-protection-materials",
    trigger: "panel replacement materials",
    triggerKeywords: ["door shell", "quarter panel", "rocker", "pillar", "apron", "wheelhouse"],
    procedures: [
      {
        name: "Corrosion protection materials",
        aliases: ["corrosion protection", "cavity wax", "anti-corrosion", "rust proofing"],
        severity: "medium",
        category: "supplement",
        evidenceBasis: "OEM Procedure / Estimating Platform Procedure / Professional Standard of Care",
        rationale: "Panel replacement typically requires corrosion protection restoration.",
      },
      {
        name: "Seam sealer application",
        aliases: ["seam sealer", "seam sealing"],
        severity: "medium",
        category: "supplement",
        evidenceBasis: "OEM Procedure / Estimating Platform Procedure / Professional Standard of Care",
        rationale: "Replacement panels commonly require seam sealer restoration and related materials.",
      },
    ],
  },
  {
    id: "collision-scan",
    trigger: "collision damage event",
    triggerKeywords: [],
    requiresAnyEstimateOperation: true,
    procedures: [
      {
        name: "Pre-repair scan",
        aliases: ["pre scan", "pre-scan", "diagnostic scan"],
        severity: "high",
        category: "scanning",
        evidenceBasis: "OEM Position Statement / Industry Research / Professional Standard of Care",
        rationale: "Collision repairs require fault discovery before repairs begin.",
      },
      {
        name: "Post-repair scan",
        aliases: ["post scan", "post-scan", "final scan"],
        severity: "high",
        category: "scanning",
        evidenceBasis: "OEM Position Statement / Industry Research / Professional Standard of Care",
        rationale: "Post-repair verification confirms systems are restored after repair.",
      },
    ],
  },
]

export function detectProcedures(estimate: ParsedEstimate): ProcedureRequirement[] {
  const requirements: ProcedureRequirement[] = []
  const alreadyHasScanEvidence = hasScanEvidence(estimate)

  for (const rule of procedureRules) {
    if (rule.requiresAnyEstimateOperation) {
      if (estimate.operations.length === 0 || alreadyHasScanEvidence) continue

      for (const procedure of rule.procedures) {
        requirements.push({
          id: `${rule.id}:${procedure.name}`,
          procedure: procedure.name,
          aliases: procedure.aliases ?? [],
          reason: procedure.rationale,
          category: procedure.category,
          severity: procedure.severity,
          evidenceBasis: procedure.evidenceBasis,
          sourceTrigger: rule.trigger,
          matchedOperation: "Collision repair operations detected in estimate",
        })
      }
      continue
    }

    for (const op of estimate.operations) {
      const normalizedComponent = op.component.toLowerCase()

      if (!rule.triggerKeywords.some((keyword) => normalizedComponent.includes(keyword))) {
        continue
      }

      for (const procedure of rule.procedures) {
        requirements.push({
          id: `${rule.id}:${procedure.name}`,
          procedure: procedure.name,
          aliases: procedure.aliases ?? [],
          reason: procedure.rationale,
          category: procedure.category,
          severity: procedure.severity,
          evidenceBasis: procedure.evidenceBasis,
          sourceTrigger: rule.trigger,
          matchedOperation: `${op.operation} ${op.component}`.trim(),
        })
      }
    }
  }

  return dedupeRequirements(requirements)
}

function hasScanEvidence(estimate: ParsedEstimate): boolean {
  if (SCAN_EVIDENCE_PATTERNS.some((pattern) => pattern.test(estimate.rawText))) {
    return true
  }

  return estimate.operations.some((operation) =>
    SCAN_EVIDENCE_PATTERNS.some((pattern) =>
      pattern.test(operation.rawLine) ||
      pattern.test(operation.component) ||
      pattern.test(operation.operation)
    )
  )
}

function dedupeRequirements(
  requirements: ProcedureRequirement[]
): ProcedureRequirement[] {
  const seen = new Map<string, ProcedureRequirement>()

  for (const requirement of requirements) {
    const existing = seen.get(requirement.procedure.toLowerCase())

    if (!existing) {
      seen.set(requirement.procedure.toLowerCase(), requirement)
      continue
    }

    seen.set(requirement.procedure.toLowerCase(), {
      ...existing,
      reason: existing.reason === requirement.reason
        ? existing.reason
        : `${existing.reason} ${requirement.reason}`.trim(),
      sourceTrigger: `${existing.sourceTrigger}; ${requirement.sourceTrigger}`,
      matchedOperation: `${existing.matchedOperation}; ${requirement.matchedOperation}`,
      severity: existing.severity === "high" || requirement.severity === "high"
        ? "high"
        : "medium",
    })
  }

  return [...seen.values()]
}
