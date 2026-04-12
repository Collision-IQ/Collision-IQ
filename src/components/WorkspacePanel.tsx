import { useEffect, useRef } from "react";
import type { EvidenceLinkModel } from "@/components/chatbot/evidenceLinks";
import type { WorkspaceData } from "@/types/workspaceTypes";
import { normalizeWorkspaceEstimateComparisons } from "@/lib/workspace/estimateComparisons";
import {
  formatEstimateComparisonDelta,
  formatEstimateComparisonValue,
  getEstimateComparisonRows,
  getEstimateComparisonLabel,
  getTopEstimateComparisonHighlights,
} from "@/components/workspace/estimateComparisonPresentation";

interface Props {
  workspaceData?: Partial<WorkspaceData> | null;
  evidenceModel?: EvidenceLinkModel | null;
  activeEvidenceTargetId?: string | null;
}

const EMPTY_WORKSPACE_DATA: WorkspaceData = {
  riskLevel: "low",
  confidence: "low",
  keyIssues: [],
  estimateComparisons: normalizeWorkspaceEstimateComparisons(null),
  supplementLetter: "",
  fullAnalysis: "",
};
/* ---------------- Sub-components ---------------- */

function IssueCard({
  text,
  active = false,
}: {
  text: string;
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 text-[13px] leading-5 transition-[border-color,background-color,box-shadow] duration-300 ${
        active
          ? "border-orange-300/28 bg-[#C65A2A]/12 text-white/82 shadow-[0_0_0_1px_rgba(210,122,81,0.12)]"
          : "border-white/6 bg-black/18 text-white/65"
      }`}
    >
      {text}
    </div>
  );
}

function TopDifferencesSummary({ items }: { items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mb-4">
      <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-white/40">
        Top Differences
      </div>

      <div className="space-y-2 rounded-xl border border-white/6 bg-white/[0.04] p-3">
        {items.map((item) => (
          <div key={item} className="flex gap-2 text-[12px] leading-5 text-white/85">
            <span className="pt-[2px] text-[#C65A2A]">&bull;</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Component ---------------- */

export default function WorkspacePanel({
  workspaceData,
  evidenceModel,
  activeEvidenceTargetId,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const evidenceRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const resolvedWorkspaceTargetId =
    (activeEvidenceTargetId
      ? evidenceModel?.targets.find((target) => target.id === activeEvidenceTargetId)?.workspaceScrollTargetId
      : null) ?? activeEvidenceTargetId;
  const data = workspaceData
    ? {
        ...EMPTY_WORKSPACE_DATA,
        ...workspaceData,
        keyIssues: workspaceData.keyIssues ?? EMPTY_WORKSPACE_DATA.keyIssues,
        estimateComparisons:
          workspaceData.estimateComparisons ?? EMPTY_WORKSPACE_DATA.estimateComparisons,
      }
    : null;
  // WorkspacePanel only renders structured comparison rows. Any prose fallback
  // conversion should happen upstream in workspaceAdapter when backend data is absent.
  const comparisonRows = data ? getEstimateComparisonRows(data.estimateComparisons) : [];
  const topDifferences = getTopEstimateComparisonHighlights(comparisonRows);
  const topIssues = (data?.keyIssues ?? []).slice(0, 4);

  useEffect(() => {
    if (!resolvedWorkspaceTargetId) return;

    const node = evidenceRefs.current[resolvedWorkspaceTargetId];
    if (!node) return;

    containerRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    node.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [resolvedWorkspaceTargetId]);

  // Shorthand for readability below
  return (
    <div className="flex h-full flex-col text-sm text-white">
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-white/7 bg-white/[0.025] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)] backdrop-blur-md"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[10px] uppercase tracking-[0.22em] text-white/40">
              Comparison Signals
            </h3>
            <p className="mt-1 text-[13px] leading-5 text-white/55">
              Structured estimate differences and issue flags. Full narrative stays in the center canvas.
            </p>
          </div>

          {data ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/6 bg-black/16 px-3 py-2.5 text-xs text-white/65">
                Risk: <span className="font-semibold capitalize">{data.riskLevel}</span>
              </div>
              <div className="rounded-xl border border-white/6 bg-black/16 px-3 py-2.5 text-xs text-white/65">
                Confidence: <span className="font-semibold capitalize">{data.confidence}</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Empty state */}

        {!data && (
          <div className="space-y-2.5">
            <div className="text-sm leading-6 text-white/85">
              Upload an estimate or photos to generate structured comparison signals.
            </div>
            <div className="text-sm leading-6 text-white/65">
              This area will focus on estimate differences, key issues, and supportable comparison flags.
            </div>
          </div>
        )}

        {data && (
          <>
            <TopDifferencesSummary items={topDifferences} />

            {topIssues.length > 0 && (
              <div className="mt-5 flex flex-col gap-2">
                <div className="mb-1 text-[10px] uppercase tracking-[0.22em] text-white/40">
                  Key Issues
                </div>

                {topIssues.map((issue, i) => {
                  const targetId = evidenceModel?.workspaceIssues.find((entry) => entry.text === issue)?.targetId;
                  const active = targetId === resolvedWorkspaceTargetId;

                  return (
                    <div
                      key={i}
                      ref={(node) => {
                        if (targetId) {
                          evidenceRefs.current[targetId] = node;
                        }
                      }}
                    >
                      <IssueCard text={issue} active={active} />
                    </div>
                  );
                })}
              </div>
            )}

            {comparisonRows.length > 0 && (
              <div className="mt-5 space-y-2.5">
                <div className="mb-1 text-[10px] uppercase tracking-[0.22em] text-white/40">
                  Comparison Basis
                </div>
                {comparisonRows.slice(0, 8).map((row) => {
                  const targetId =
                    evidenceModel?.comparisonRows.find((entry) => entry.id === row.id)?.targetId ?? null;
                  const active = targetId === resolvedWorkspaceTargetId;

                  return (
                    <div
                      key={row.id}
                      ref={(node) => {
                        if (targetId) {
                          evidenceRefs.current[targetId] = node;
                        }
                      }}
                      className={`rounded-xl border px-3 py-3 transition-[border-color,background-color,box-shadow] duration-300 ${
                        active
                          ? "border-orange-300/28 bg-[#C65A2A]/12 shadow-[0_0_0_1px_rgba(210,122,81,0.12)]"
                          : "border-white/6 bg-black/18"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[13px] font-medium leading-5 text-white/84">
                            {getEstimateComparisonLabel(row)}
                          </div>
                          <div className="mt-1 text-[12px] leading-5 text-white/46">
                            {row.category ?? "Estimate comparison"}
                          </div>
                        </div>
                        <div className="rounded-full border border-white/8 bg-black/18 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/45">
                          {formatEstimateComparisonDelta(row)}
                        </div>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-lg bg-black/18 px-2.5 py-2 text-[12px] leading-5 text-white/62">
                          <span className="text-white/42">{row.lhsSource ?? "Shop"}:</span>{" "}
                          {formatEstimateComparisonValue(row.lhsValue)}
                        </div>
                        <div className="rounded-lg bg-black/18 px-2.5 py-2 text-[12px] leading-5 text-white/62">
                          <span className="text-white/42">{row.rhsSource ?? "Carrier"}:</span>{" "}
                          {formatEstimateComparisonValue(row.rhsValue)}
                        </div>
                      </div>
                      {row.notes?.length ? (
                        <div className="mt-2 text-[12px] leading-5 text-white/54">
                          {row.notes[0]}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {data.supplementLetter && (
              <>
                <button
                  onClick={() => {
                    const blob = new Blob([data.supplementLetter], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);

                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "collision-iq-supplement.txt";
                    a.click();

                    URL.revokeObjectURL(url);
                  }}
                  className="mt-5 w-full rounded-xl bg-[#C65A2A]/18 p-3 text-xs text-white/85 transition hover:bg-[#C65A2A]/26"
                >
                  Generate Supplement Letter
                </button>

                <div className="mt-4 rounded-xl border border-white/6 bg-black/36 p-3 text-xs whitespace-pre-wrap text-white/65">
                  {data.supplementLetter}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
