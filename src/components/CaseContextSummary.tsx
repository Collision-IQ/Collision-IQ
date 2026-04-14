type CaseContextSummaryProps = {
  intent: string;
  vehicleLabel?: string | null;
  fileCount: number;
  determinationAnswer?: string | null;
};

export default function CaseContextSummary({
  intent,
  vehicleLabel,
  fileCount,
  determinationAnswer,
}: CaseContextSummaryProps) {
  return (
    <div className="rounded-2xl border border-orange-500/20 bg-[#141414] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-400/80">
        Continue with this case
      </div>

      <div className="mt-3 space-y-2 text-sm text-zinc-300">
        <div>
          <span className="text-zinc-500">Original ask:</span>{" "}
          <span className="text-zinc-100">{intent}</span>
        </div>

        {vehicleLabel ? (
          <div>
            <span className="text-zinc-500">Vehicle:</span>{" "}
            <span className="text-zinc-100">{vehicleLabel}</span>
          </div>
        ) : null}

        <div>
          <span className="text-zinc-500">Files in context:</span>{" "}
          <span className="text-zinc-100">{fileCount}</span>
        </div>

        {determinationAnswer ? (
          <div>
            <span className="text-zinc-500">Current determination:</span>{" "}
            <span className="text-zinc-100">{determinationAnswer}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
