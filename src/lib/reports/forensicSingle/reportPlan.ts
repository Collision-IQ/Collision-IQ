/**
 * Report-mode routing for the Reports page.
 *
 * Product rule (Sep 2026):
 *   1 estimate uploaded  -> FORENSIC report only (no Citation Density).
 *   2 estimates uploaded -> FORENSIC (two-estimate, unchanged) + Citation Density.
 *
 * The Reports card is renamed "Forensic Report w/ Citation Density Report".
 * Its description and buttons adapt to the mode returned here.
 */

export type ReportMode = "FORENSIC_SINGLE" | "FORENSIC_WITH_CITATION_DENSITY";

export interface AnalysisInput {
  estimateIds: string[];
  /** True when the user explicitly requested a comparison. Two uploads imply it. */
  comparisonRequested?: boolean;
}

export interface ReportPlan {
  mode: ReportMode;
  documents: Array<
    | { kind: "FORENSIC_SINGLE"; estimateId: string }
    | { kind: "FORENSIC_DELTA"; targetId: string; sourceId: string }
    | { kind: "CITATION_DENSITY"; targetId: string; sourceId: string }
  >;
  card: { title: string; description: string; downloadLabel: string; disabledReason?: string };
}

export function planReports(input: AnalysisInput, pick?: (ids: string[]) => { targetId: string; sourceId: string }): ReportPlan {
  const ids = input.estimateIds;
  if (ids.length === 0) {
    return {
      mode: "FORENSIC_SINGLE", documents: [],
      card: { title: "Forensic Report w/ Citation Density Report", description: "Upload an estimate to generate a forensic review.", downloadLabel: "Download PDF", disabledReason: "No estimate uploaded" },
    };
  }
  if (ids.length === 1) {
    return {
      mode: "FORENSIC_SINGLE",
      documents: [{ kind: "FORENSIC_SINGLE", estimateId: ids[0] }],
      card: {
        title: "Forensic Report w/ Citation Density Report",
        description:
          "One estimate on file. The Forensic Estimate Review reconciles the document to its own printed totals, then audits it for not-included operations, OEM repair position, restraint handling, tax basis and header completeness. The Citation Density annotation requires a second estimate to compare against and is not generated in this mode.",
        downloadLabel: "Download Forensic Report",
      },
    };
  }
  const pair = pick ? pick(ids) : { targetId: ids[0], sourceId: ids[1] };
  return {
    mode: "FORENSIC_WITH_CITATION_DENSITY",
    documents: [
      { kind: "FORENSIC_DELTA", ...pair },
      { kind: "CITATION_DENSITY", ...pair },
    ],
    card: {
      title: "Forensic Report w/ Citation Density Report",
      description:
        "Two documents. The estimate PDF annotated in place, every mark anchored to the line it came from; and the Forensic Estimate Analysis — a line-level reconciliation that balances to each document's own totals, quantifies the gap category by category, and separates fact from open verification item.",
      downloadLabel: "Download PDF",
    },
  };
}
