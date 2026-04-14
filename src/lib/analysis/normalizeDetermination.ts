import type {
  AdasResult,
  DeterminationResult,
  DeterminationSection,
  ValuationResult,
} from "@/lib/analysis/determinationEngine";

type LegacySection<T> = T & {
  title: string;
  body: string;
};

export type NormalizedDeterminationResult = Omit<DeterminationResult, "sections"> & {
  summary: string;
  sections: {
    scans: LegacySection<DeterminationSection>;
    adas: LegacySection<AdasResult>;
    structural: LegacySection<DeterminationSection>;
    corrosion: LegacySection<DeterminationSection>;
    valuation: LegacySection<ValuationResult>;
    linkedEvidence: LegacySection<DeterminationSection>;
  };
};

function withBody<T extends { summary: string }>(
  title: string,
  section: T
): LegacySection<T> {
  return {
    title,
    ...section,
    body: section.summary,
  };
}

export function normalizeDetermination(
  result: DeterminationResult
): NormalizedDeterminationResult {
  return {
    ...result,
    summary: result.headline,
    sections: {
      scans: withBody("Pre/Post Scan Support", result.sections.scans),
      adas: withBody("ADAS / Calibration Support", result.sections.adas),
      structural: withBody("Structural / Measuring Support", result.sections.structural),
      corrosion: withBody("Corrosion Protection Support", result.sections.corrosion),
      valuation: withBody("Valuation Support", result.sections.valuation),
      linkedEvidence: withBody("Linked OEM / ADAS Evidence", result.sections.linkedEvidence),
    },
  };
}
