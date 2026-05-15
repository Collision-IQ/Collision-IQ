export interface RepairGraphNode {
  component: string;
  sensor?: string;
  system: string;
  procedure: string;
  keywords: string[];
}

export interface RepairGraphInference {
  component: string;
  sensor?: string;
  system: string;
  procedure: string;
  evidenceQuery: string;
}

const REPAIR_KNOWLEDGE_GRAPH: RepairGraphNode[] = [
  {
    component: "front bumper",
    sensor: "radar",
    system: "ADAS",
    procedure: "ACC dynamic calibration",
    keywords: ["front bumper", "bumper cover", "bumper assy", "grille", "radar bracket"],
  },
  {
    component: "front bumper",
    sensor: "forward camera",
    system: "ADAS",
    procedure: "KAFAS camera dynamic calibration",
    keywords: ["front bumper", "headlamp", "radiator support", "core support"],
  },
  {
    component: "windshield",
    sensor: "forward camera",
    system: "ADAS",
    procedure: "Forward camera calibration",
    keywords: ["windshield", "glass", "rear view mirror", "camera bracket"],
  },
  {
    component: "suspension geometry",
    sensor: "steering angle sensor",
    system: "ADAS",
    procedure: "Steering angle sensor reset",
    keywords: ["control arm", "subframe", "alignment", "steering", "suspension"],
  },
  {
    component: "collision damage",
    system: "diagnostics",
    procedure: "Pre-repair scan",
    keywords: ["collision", "estimate", "repair"],
  },
  {
    component: "collision damage",
    system: "diagnostics",
    procedure: "Post-repair scan",
    keywords: ["collision", "estimate", "repair"],
  },
];

export function getRepairKnowledgeGraph(): RepairGraphNode[] {
  return REPAIR_KNOWLEDGE_GRAPH;
}

export function inferGraphRelations(components: string[]): RepairGraphInference[] {
  const lowerComponents = components.map((component) => component.toLowerCase());
  const inferences: RepairGraphInference[] = [];

  for (const node of REPAIR_KNOWLEDGE_GRAPH) {
    if (
      node.component === "collision damage" &&
      lowerComponents.length > 0
    ) {
      inferences.push(toInference(node));
      continue;
    }

    if (
      lowerComponents.some((component) =>
        node.keywords.some((keyword) => component.includes(keyword))
      )
    ) {
      inferences.push(toInference(node));
    }
  }

  return dedupeInferences(inferences);
}

export function findGraphNodesByComponent(component: string): RepairGraphNode[] {
  const lower = component.toLowerCase();
  return REPAIR_KNOWLEDGE_GRAPH.filter((node) =>
    node.keywords.some((keyword) => lower.includes(keyword))
  );
}

function toInference(node: RepairGraphNode): RepairGraphInference {
  return {
    component: node.component,
    sensor: node.sensor,
    system: node.system,
    procedure: node.procedure,
    evidenceQuery: [node.component, node.sensor, node.system, node.procedure]
      .filter(Boolean)
      .join(" "),
  };
}

function dedupeInferences(
  inferences: RepairGraphInference[]
): RepairGraphInference[] {
  const seen = new Map<string, RepairGraphInference>();

  for (const inference of inferences) {
    seen.set(inference.procedure.toLowerCase(), inference);
  }

  return [...seen.values()];
}
