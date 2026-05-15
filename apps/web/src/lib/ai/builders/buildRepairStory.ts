import {
  parseEstimate as parseEstimatorView,
  type EstimateOperation as DetailedEstimateOperation,
} from "../estimateParser";
import { parseEstimate as parseStructuredEstimate } from "../extractors/estimateExtractor";
import {
  deriveImpactZone,
  formatImpactZone,
  hasFrontSupportZoneEvidence,
  isSideImpactZone,
  type ImpactZone,
} from "../impactZone";

type LaborMix = {
  replace: number;
  repair: number;
  removeInstall: number;
  refinish: number;
  scanCalibration: number;
  procedures: number;
};

type StoryOperations = {
  repairDominant: boolean;
  repairedParts: string[];
  replacedParts: string[];
};

export type RepairStory = {
  impact: string;
  impactZone: ImpactZone;
  zones: string[];
  panels: string[];
  replacedPanels: string[];
  repairedPanels: string[];
  operations: StoryOperations;
  repairCharacter: string;
  structural: boolean;
  complexity: string;
  laborStructure: {
    bodyHours?: number;
    paintHours?: number;
    mix: LaborMix;
  };
};

export function buildRepairStory(estimateText: string): RepairStory {
  const lower = estimateText.toLowerCase();
  const detailedEstimate = parseEstimatorView(estimateText);
  const structuredEstimate = parseStructuredEstimate(estimateText);
  const panels = collectPanels(detailedEstimate.operations);
  const impactZone = deriveImpactZone({ text: estimateText });
  const zones = collectZones(lower, panels, impactZone);
  const replacedPanels = collectPanelsByOperation(detailedEstimate.operations, ["Repl"]);
  const repairedPanels = collectPanelsByOperation(detailedEstimate.operations, ["Rpr"]);
  const operations = {
    repairDominant: repairedPanels.length >= replacedPanels.length,
    repairedParts: repairedPanels,
    replacedParts: replacedPanels,
  };
  const structural =
    lower.includes("alu") ||
    lower.includes("structural") ||
    lower.includes("door shell") ||
    includesAny(lower, ["rail", "apron", "pillar", "core support", "reinforcement"]);
  const impact = determineImpact(lower, zones, impactZone);

  return {
    impact,
    impactZone,
    zones,
    panels,
    replacedPanels,
    repairedPanels,
    operations,
    repairCharacter: classifyRepairCharacter({
      structural,
      operations,
    }),
    structural,
    complexity: classifyComplexity({ zones, panels, structural }),
    laborStructure: {
      bodyHours: structuredEstimate.bodyHours,
      paintHours: structuredEstimate.paintHours,
      mix: buildLaborMix(detailedEstimate.operations),
    },
  };
}

export function buildRepairNarrative(story: RepairStory): string {
  const parts: string[] = [];

  if (story.operations.repairDominant) {
    parts.push(
      "This estimate is built around a repair-first approach rather than part replacement."
    );
  } else {
    parts.push(
      "This estimate leans more toward part replacement than repair."
    );
  }

  if (story.zones.length > 0) {
    parts.push(`The work is concentrated in the ${story.zones.join(", ")}.`);
  }

  if (story.panels.length >= 3) {
    parts.push(
      "The repair spans multiple panels, suggesting the impact carried beyond a single isolated component."
    );
  }

  parts.push(
    `Overall, this reads as a ${story.repairCharacter} repair.`
  );

  return parts.join(" ");
}

function collectPanels(operations: DetailedEstimateOperation[]): string[] {
  const panels = operations
    .map((operation) => normalizePanelName(operation.component))
    .filter(Boolean);

  return [...new Set(panels)];
}

function collectPanelsByOperation(
  operations: DetailedEstimateOperation[],
  operationTypes: string[]
): string[] {
  const panels = operations
    .filter((operation) => operationTypes.includes(operation.operation))
    .map((operation) => normalizePanelName(operation.component))
    .filter(Boolean);

  return [...new Set(panels)];
}

function normalizePanelName(component: string): string {
  const lower = component.toLowerCase();
  const dictionary: Array<[RegExp, string]> = [
    [/\bfront bumper\b|\bbumper cover\b/, "front bumper"],
    [/\brear bumper\b/, "rear bumper"],
    [/\bgrille\b/, "grille"],
    [/\bhood\b/, "hood"],
    [/\bfender\b/, "fender"],
    [/\bdoor shell\b|\bfront door\b|\brear door\b|\bdoor\b/, "door"],
    [/\bquarter\b|\bquarter panel\b/, "quarter panel"],
    [/\bapron\b/, "apron"],
    [/\brail\b/, "rail"],
    [/\bcore support\b|\bradiator support\b/, "radiator support"],
    [/\bpillar\b/, "pillar"],
    [/\bheadlamp\b|\bheadlight\b/, "headlamp"],
    [/\bmirror\b/, "mirror"],
    [/\bdecklid\b|\btrunk\b/, "decklid"],
  ];

  for (const [pattern, label] of dictionary) {
    if (pattern.test(lower)) {
      return label;
    }
  }

  return component.replace(/\s+/g, " ").trim().toLowerCase();
}

function collectZones(lower: string, panels: string[], impactZone: ImpactZone): string[] {
  const zones = new Set<string>();

  if (
    includesAny(lower, [
      "front bumper",
      "grille",
      "hood",
      "headlamp",
      "radiator support",
      "core support",
      "fender",
    ]) ||
    panels.some((panel) =>
      includesAny(panel, [
        "front bumper",
        "grille",
        "hood",
        "headlamp",
        "radiator support",
        "fender",
      ])
    )
  ) {
    zones.add("front-end");
  }

  if (isSideImpactZone(impactZone) && !hasFrontSupportZoneEvidence(lower)) {
    zones.delete("front-end");
  }

  if (
    includesAny(lower, ["door", "pillar", "rocker", "apron"]) ||
    panels.some((panel) => includesAny(panel, ["door", "pillar", "apron"]))
  ) {
    zones.add("side structure");
  }

  if (
    includesAny(lower, ["quarter", "rear bumper", "decklid", "tail lamp"]) ||
    panels.some((panel) =>
      includesAny(panel, ["quarter panel", "rear bumper", "decklid"])
    )
  ) {
    zones.add("rear body");
  }

  return [...zones];
}

function determineImpact(lower: string, zones: string[], impactZone: ImpactZone): string {
  if (impactZone.primary !== "unspecified" && impactZone.confidence !== "low") {
    return formatImpactZone(impactZone);
  }

  if (/\bpoint\s+of\s+impact\s*:?\s*0?1\s+right\s+front\b/i.test(lower)) {
    return "right front";
  }

  if (/\bpoint\s+of\s+impact\s*:?\s*0?1\s+left\s+front\b/i.test(lower)) {
    return "left front";
  }

  if (/\b(right front|front right|rf|right headlamp|right fender|passenger side front)\b/i.test(lower)) {
    return "right front";
  }

  if (/\b(left front|front left|lf|left headlamp|left fender|driver side front)\b/i.test(lower)) {
    return "left front";
  }

  if (
    zones.includes("front-end")
  ) {
    return "front";
  }

  if (includesAny(lower, ["right rear"])) {
    return "right rear";
  }

  if (includesAny(lower, ["left rear"])) {
    return "left rear";
  }

  if (zones.includes("side structure")) {
    return "side";
  }

  if (zones.includes("rear body")) {
    return "rear";
  }

  return "general";
}

function classifyRepairCharacter(params: {
  structural: boolean;
  operations: StoryOperations;
}): string {
  if (params.structural) {
    return "structural repair";
  }

  if (params.operations.repairDominant) {
    return "repair-dominant cosmetic";
  }

  return "parts replacement oriented";
}

function classifyComplexity(params: {
  zones: string[];
  panels: string[];
  structural: boolean;
}): string {
  if (params.structural || params.zones.length >= 2 || params.panels.length >= 5) {
    return "multi-zone repair";
  }

  if (params.panels.length >= 3) {
    return "moderate scope repair";
  }

  return "localized repair";
}

function buildLaborMix(operations: DetailedEstimateOperation[]): LaborMix {
  return operations.reduce<LaborMix>(
    (mix, operation) => {
      const op = operation.operation.toLowerCase();

      if (op === "repl") mix.replace += 1;
      else if (op === "rpr") mix.repair += 1;
      else if (op === "r&i") mix.removeInstall += 1;
      else if (op === "blnd") mix.refinish += 1;
      else if (op === "cal" || op === "scan") mix.scanCalibration += 1;
      else mix.procedures += 1;

      return mix;
    },
    {
      replace: 0,
      repair: 0,
      removeInstall: 0,
      refinish: 0,
      scanCalibration: 0,
      procedures: 0,
    }
  );
}

function includesAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}
