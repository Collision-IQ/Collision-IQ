export function computeEvidenceQuality(params: {
  oemEvidenceCount: number;
  totalEvidenceCount: number;
}): "weak" | "moderate" | "strong" {
  if (params.oemEvidenceCount >= 2 || params.totalEvidenceCount >= 4) return "strong";
  if (params.totalEvidenceCount >= 2) return "moderate";
  return "weak";
}
