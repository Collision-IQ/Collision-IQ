import runDeterminationEngine from "@/lib/analysis/determinationEngine";
import {
  normalizeDetermination,
  type NormalizedDeterminationResult,
} from "@/lib/analysis/normalizeDetermination";

type CaseLike = {
  vehicle?: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    trim?: string | null;
    mileage?: number | null;
  };
  estimateText?: string | null;
  files?: Array<{
    name?: string;
    text?: string | null;
    summary?: string | null;
    type?: string | null;
  }> | null;
  linkedEvidence?: Array<{
    url?: string;
    finalUrl?: string;
    title?: string | null;
    mimeType?: string | null;
    sourceType?: "google_doc" | "google_drive" | "pdf" | "html" | "unknown";
    text?: string | null;
    status?: "ok" | "blocked" | "failed";
    notes?: string;
  }> | null;
  extractedFacts?: Record<string, unknown> | null;
};

export function getNormalizedDetermination(
  caseData: CaseLike
): NormalizedDeterminationResult {
  const raw = runDeterminationEngine({
    vehicle: caseData.vehicle
      ? {
          year: caseData.vehicle.year ?? undefined,
          make: caseData.vehicle.make ?? undefined,
          model: caseData.vehicle.model ?? undefined,
          trim: caseData.vehicle.trim ?? undefined,
          mileage: caseData.vehicle.mileage ?? undefined,
        }
      : undefined,
    estimateText: caseData.estimateText || "",
    files: caseData.files || [],
    linkedEvidence: caseData.linkedEvidence || [],
    extractedFacts: caseData.extractedFacts || {},
  });

  return normalizeDetermination(raw);
}

export default getNormalizedDetermination;
