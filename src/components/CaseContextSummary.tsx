import type { NormalizedDeterminationResult } from "@/lib/analysis/normalizeDetermination";

type CaseContextSummaryProps = {
  intent: string;
  vehicleLabel?: string | null;
  fileCount: number;
  determinationAnswer?: string | null;
  determinationPayload?: NormalizedDeterminationResult | null;
  supportGaps?: string[] | null;
};

export default function CaseContextSummary({
  intent,
  vehicleLabel,
  fileCount,
  determinationAnswer,
  determinationPayload,
  supportGaps: legacySupportGaps,
}: CaseContextSummaryProps) {
  const determinationView = determinationPayload;
  const headline =
    determinationView?.headline || determinationAnswer || "No determination available";
  const confidence = determinationView?.confidence ?? null;
  const supportGaps =
    determinationView?.supportGaps?.length
      ? determinationView.supportGaps
      : legacySupportGaps || [];
  const cautionFlags = determinationView?.cautionFlags || [];
  const sections = determinationView
    ? [
        {
          title: "ADAS / Calibration Support",
          ...determinationView.sections.adas,
        },
        {
          title: "Pre/Post Scan Support",
          ...determinationView.sections.scans,
        },
        {
          title: "Structural / Measuring Support",
          ...determinationView.sections.structural,
        },
        {
          title: "Corrosion Protection Support",
          ...determinationView.sections.corrosion,
        },
        {
          title: "Valuation Support",
          ...determinationView.sections.valuation,
        },
        {
          title: "Linked OEM / ADAS Evidence",
          ...determinationView.sections.linkedEvidence,
        },
      ]
    : [];

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

        {headline ? (
          <div>
            <span className="text-zinc-500">Current determination:</span>{" "}
            <span className="text-zinc-100">{headline}</span>
          </div>
        ) : null}

        {confidence !== null ? (
          <div>
            <span className="text-zinc-500">Confidence:</span>{" "}
            <span className="text-zinc-100">{confidence}</span>
          </div>
        ) : null}
      </div>

      {sections.length > 0 ? (
        <div className="mt-4 space-y-3">
          {sections.map((section) => (
            <div
              key={section.title}
              className="rounded-xl border border-white/6 bg-black/18 px-3.5 py-3"
            >
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">
                {section.title}
              </div>
              <div className="mt-2 text-sm leading-6 text-zinc-200">{section.summary}</div>
            </div>
          ))}
        </div>
      ) : null}

      {supportGaps.length > 0 ? (
        <div className="mt-4 rounded-xl border border-white/6 bg-black/18 px-3.5 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">
            Support Gaps
          </div>
          <ul className="mt-2 ml-5 list-disc space-y-1.5 text-sm leading-6 text-zinc-200">
            {supportGaps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {cautionFlags.length > 0 ? (
        <div className="mt-4 rounded-xl border border-white/6 bg-black/18 px-3.5 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">
            Caution Flags
          </div>
          <ul className="mt-2 ml-5 list-disc space-y-1.5 text-sm leading-6 text-zinc-200">
            {cautionFlags.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
