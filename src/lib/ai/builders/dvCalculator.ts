export type DVResult = {
  low: number;
  high: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
};

export function calculateDV(params: {
  repairCost?: number;
  structural?: boolean;
  airbag?: boolean;
  vehicleYear?: number;
  isLuxury?: boolean;
}): DVResult | null {
  const {
    repairCost = 0,
    structural,
    airbag,
    vehicleYear,
    isLuxury,
  } = params;

  if (!repairCost && !structural && !airbag) return null;

  let percent = 0.05;

  if (repairCost > 5000) percent = 0.1;
  if (repairCost > 15000 || structural || airbag) percent = 0.15;

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

  return {
    low,
    high,
    confidence:
      structural || airbag ? "high" : repairCost > 5000 ? "medium" : "low",
    rationale:
      structural || airbag
        ? "Structural or safety system involvement significantly increases resale impact."
        : "Repair cost and severity drive diminished value exposure.",
  };
}
