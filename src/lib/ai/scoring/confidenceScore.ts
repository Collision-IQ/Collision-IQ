export function computeConfidenceScore(params: {
  hasVehicleContext: boolean;
  operationCount: number;
  evidenceCount: number;
}): "low" | "moderate" | "high" {
  const score =
    (params.hasVehicleContext ? 2 : 0) +
    (params.operationCount >= 2 ? 2 : params.operationCount > 0 ? 1 : 0) +
    (params.evidenceCount >= 3 ? 2 : params.evidenceCount > 0 ? 1 : 0);

  if (score >= 5) return "high";
  if (score >= 2) return "moderate";
  return "low";
}
