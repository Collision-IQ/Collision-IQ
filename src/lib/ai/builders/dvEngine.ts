export interface DVInsight {
  applicable: boolean;
  severity: "low" | "moderate" | "high";
  rationale: string;
}

export function evaluateDiminishedValue(params: {
  repairCost?: number;
  structural?: boolean;
  airbag?: boolean;
  vehicleAge?: number;
}): DVInsight {
  const { repairCost = 0, structural, airbag } = params;

  if (!repairCost && !structural && !airbag) {
    return {
      applicable: false,
      severity: "low",
      rationale: "Repair cost not available to assess diminished value.",
    };
  }

  let severity: DVInsight["severity"] = "low";

  if (structural || airbag || repairCost > 15000) {
    severity = "high";
  } else if (repairCost > 5000) {
    severity = "moderate";
  } else if (structural || airbag) {
    severity = "high";
  }

  return {
    applicable: repairCost > 3000 || Boolean(structural) || Boolean(airbag),
    severity,
    rationale:
      severity === "high"
        ? "Structural involvement or high repair cost typically results in measurable diminished value."
        : severity === "moderate"
          ? "Moderate repair cost can create resale impact depending on vehicle and disclosure."
          : "Lower repair cost typically results in minimal diminished value impact.",
  };
}
