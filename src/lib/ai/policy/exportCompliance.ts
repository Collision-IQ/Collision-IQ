export function toExportSafeNarrative(input: {
  title?: string;
  summary?: string;
  findings?: string[];
  reasoning?: string[];
  sources?: Array<{ kind: "document" | "web"; label: string }>;
}) {
  return {
    title: input.title ?? "Review Summary",
    summary: input.summary ?? "",
    findings: input.findings ?? [],
    reasoning: input.reasoning ?? [],
    sources: (input.sources ?? []).map((source) => ({
      label: source.label,
      kind: source.kind,
      shareMode: source.kind === "web" ? "shareable" : "described_only",
    })),
    compliance: {
      documentContentsDiscussed: true,
      rawPrivateDocumentShared: false,
      exportSafe: true,
      openSourceMaterialShareable: true,
    },
  };
}
