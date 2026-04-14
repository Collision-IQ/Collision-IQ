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
    <section className="rounded-[24px] border border-orange-300/16 bg-gradient-to-br from-[#C65A2A]/14 via-black/24 to-black/14 p-4 shadow-[0_18px_44px_rgba(0,0,0,0.2)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">
            Answer To Your Question
          </div>
          <div className="mt-2 text-[1.12rem] font-semibold tracking-[-0.02em] text-white/90">
            {determination.answer}
          </div>
        </div>

        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/58">
          {getStatusLabel(determination.status)}
        </div>
      </div>

      <div className="mt-3 text-[13px] leading-5 text-white/64">
        Confidence: {formatConfidence(determination.confidence)}
      </div>

      {determination.missingFactors.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-white/6 bg-black/18 px-3.5 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/48">
            What Still Needs Confirmation
          </div>
          <ul className="mt-2 ml-5 list-disc space-y-1.5 text-[13px] leading-5 text-white/72">
            {determination.missingFactors.map((factor) => (
              <li key={factor}>{factor}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
