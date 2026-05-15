import type { ExportModel } from "@/lib/ai/builders/buildExportModel";

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
    <section className="rounded-md border border-[#b86a2d]/28 bg-[#C65A2A]/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-[#b86a2d]">
            Determination
          </div>
          <div className="mt-1.5 text-base font-semibold text-card-foreground">
            {determination.answer}
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
              <li key={factor}>{factor}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
