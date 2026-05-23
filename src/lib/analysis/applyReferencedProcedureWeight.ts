type WeightedArea = "adas" | "structural" | "calibration" | "alignment" | "fit_finish";

export type AreaWeightAccumulator = Record<WeightedArea, number>;

export const EMPTY_AREA_WEIGHTS: AreaWeightAccumulator = {
  adas: 0,
  structural: 0,
  calibration: 0,
  alignment: 0,
  fit_finish: 0,
};

export function applyReferencedProcedureWeight(
  base: AreaWeightAccumulator,
  linkedEvidence: Array<{
    status?: string;
    inferredProcedureSignals?: Array<{
      category: "adas" | "structural" | "calibration" | "alignment" | "fit_finish" | "general";
      strength: number;
    }>;
  }>
): AreaWeightAccumulator {
  const next = { ...base };

  for (const item of linkedEvidence) {
    const normalizedStatus = item.status?.toLowerCase();
    if (normalizedStatus !== "referenced_not_retrieved" && normalizedStatus !== "skipped") {
      continue;
    }

    for (const signal of item.inferredProcedureSignals ?? []) {
      switch (signal.category) {
        case "adas":
        case "structural":
        case "calibration":
        case "alignment":
        case "fit_finish":
          next[signal.category] += signal.strength;
          break;
        case "general":
          next.fit_finish += signal.strength * 0.5;
          next.structural += signal.strength * 0.25;
          next.calibration += signal.strength * 0.25;
          break;
      }
    }
  }

  return next;
}
