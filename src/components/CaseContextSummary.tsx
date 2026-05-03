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
  const displayedSupportGaps = [
    ...supportGaps,
    ...(determinationView?.referencedProcedureWeightApplied
      ? [
          "Referenced OEM/procedure documents add directional repair-path support, but they were not retrieved, so exact procedure steps remain unverified.",
        ]
      : []),
  ].filter((item, index, list) => list.indexOf(item) === index);
  const cautionFlags = determinationView?.cautionFlags || [];
  const sections = determinationView
    ? [
        {
          ...determinationView.sections.adas,
          title: "ADAS / Calibration Support",
        },
        {
          ...determinationView.sections.scans,
          title: "Pre/Post Scan Support",
        },
        {
          ...determinationView.sections.structural,
          title: "Structural / Measuring Support",
        },
        {
          ...determinationView.sections.corrosion,
          title: "Corrosion Protection Support",
        },
        {
          ...determinationView.sections.valuation,
          title: "Valuation Support",
        },
        {
          ...determinationView.sections.linkedEvidence,
          title: "Linked OEM / ADAS Evidence",
        },
      ]
    : [];

  return (
    <div className="rounded-2xl border border-orange-500/20 bg-card p-4 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-400/80">
        Continue with this case
      </div>

      <div className="mt-3 space-y-2 text-sm text-muted-foreground">
        <div>
          <span className="text-muted-foreground">Original ask:</span>{" "}
          <span className="font-medium text-foreground">{intent}</span>
        </div>

        {vehicleLabel ? (
          <div>
            <span className="text-muted-foreground">Vehicle:</span>{" "}
            <span className="font-medium text-foreground">{vehicleLabel}</span>
          </div>
        ) : null}

        <div>
          <span className="text-muted-foreground">Files in context:</span>{" "}
          <span className="font-medium text-foreground">{fileCount}</span>
        </div>

        {headline ? (
          <div>
            <span className="text-muted-foreground">Current determination:</span>{" "}
            <span className="font-medium text-foreground">{headline}</span>
          </div>
        ) : null}

        {confidence !== null ? (
          <div>
            <span className="text-muted-foreground">Confidence:</span>{" "}
            <span className="font-medium text-foreground">{confidence}</span>
          </div>
        ) : null}
      </div>

      {sections.length > 0 ? (
        <div className="mt-4 space-y-3">
          {sections.map((section) => (
            <div
              key={section.title}
              className="rounded-xl border border-border bg-muted px-3.5 py-3"
            >
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {section.title}
              </div>
              <div className="mt-2 text-sm leading-6 text-foreground">{section.summary}</div>
            </div>
          ))}
        </div>
      ) : null}

      {displayedSupportGaps.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border bg-muted px-3.5 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Support Gaps
          </div>
          <ul className="mt-2 ml-5 list-disc space-y-1.5 text-sm leading-6 text-foreground">
            {displayedSupportGaps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {cautionFlags.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border bg-muted px-3.5 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Caution Flags
          </div>
          <ul className="mt-2 ml-5 list-disc space-y-1.5 text-sm leading-6 text-foreground">
            {cautionFlags.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
