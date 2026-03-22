export type DVResult = {
  low: number;
  high: number;
  confidence: "low" | "medium" | "high" | "low_to_moderate";
  rationale: string;
};

export function calculateDV(params: {
  repairCost?: number;
  structural?: boolean;
  airbag?: boolean;
  adas?: boolean;
  hybrid?: boolean;
  multiPanel?: boolean;
  vehicleYear?: number;
  isLuxury?: boolean;
}): DVResult | null {
  const {
    repairCost = 0,
    structural,
    airbag,
    adas,
    hybrid,
    multiPanel,
    vehicleYear,
    isLuxury,
  } = params;

  const hasQualitativeExposure = Boolean(structural || airbag || adas || hybrid || multiPanel);

  if (!repairCost && !hasQualitativeExposure) return null;

  let percent = 0.05;

  if (repairCost > 5000) percent = 0.1;
  if (repairCost > 15000 || structural || airbag) percent = 0.15;
  if (repairCost > 0 && (adas || hybrid || multiPanel)) percent = Math.max(percent, 0.08);

  if (isLuxury) percent += 0.03;

  let ageFactor = 1;

  if (vehicleYear) {
    const age = new Date().getFullYear() - vehicleYear;

    if (age > 5) ageFactor = 0.7;
    if (age > 10) ageFactor = 0.5;
  }

  const base = repairCost * percent * ageFactor;

  const low = Math.round(base * 0.7);
  const high = Math.round(base * 1.25);

  if (repairCost <= 0 && hasQualitativeExposure) {
    return {
      low: 0,
      high: 0,
      confidence:
        adas || hybrid || multiPanel
          ? "low_to_moderate"
          : structural || airbag
            ? "medium"
            : "low",
      rationale:
        "The repair context suggests diminished value exposure may exist, but the current data does not support a quantified range yet.",
    };
  }

  return {
    low,
    high,
    confidence:
      structural || airbag
        ? adas || hybrid || multiPanel
          ? "low_to_moderate"
          : "high"
        : adas || hybrid || multiPanel
          ? "low_to_moderate"
          : repairCost > 5000
            ? "medium"
            : "low",
    rationale:
      structural || airbag
        ? "Structural or safety system involvement significantly increases resale impact."
        : adas || hybrid || multiPanel
          ? "ADAS involvement, hybrid-system exposure, or multi-panel repair can affect resale impact, but the estimate context supports only a cautious confidence level."
          : "Repair cost and severity drive diminished value exposure.",
  };
}
