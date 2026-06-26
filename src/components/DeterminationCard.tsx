import type { ExportModel } from "@/lib/ai/builders/buildExportModel";
import { sanitizeUserFacingEvidenceText } from "@/lib/ui/presentationText";

type Props = {
  determination: ExportModel["determination"];
};

function formatConfidence(value: Props["determination"]["confidence"]): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getStatusLabel(value: Props["determination"]["status"]): string {
  if (value === "total_loss") {
    return "Potential Total Loss";
  }

  if (value === "repairable") {
    return "Provisionally Repairable";
  }

  return "Repairability Unclear";
}

export default function DeterminationCard({ determination }: Props) {
  return (
    <section className="rounded-md border border-[var(--accent)]/28 bg-[var(--accent)]/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--accent)]">
            Determination
          </div>
          <div className="mt-1.5 text-base font-semibold text-card-foreground">
            {sanitizeUserFacingEvidenceText(determination.answer) || determination.answer}
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          {getStatusLabel(determination.status)}
        </div>
      </div>

      <div className="mt-3 text-[13px] leading-5 text-muted-foreground">
        Confidence: {formatConfidence(determination.confidence)}
      </div>

      {determination.missingFactors.length > 0 ? (
        <div className="mt-3 rounded-md border border-border bg-muted px-3 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            What Still Needs Confirmation
          </div>
          <ul className="mt-2 ml-5 list-disc space-y-1.5 text-[13px] leading-5 text-muted-foreground">
            {determination.missingFactors.map((factor) => (
              <li key={factor}>{sanitizeUserFacingEvidenceText(factor) || "Not yet located in reviewed files."}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
