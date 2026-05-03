import type { WorkspaceData } from "@/types/workspaceTypes";
import { normalizeWorkspaceEstimateComparisons } from "@/lib/workspace/estimateComparisons";
import {
  getEstimateComparisonRows,
  getTopEstimateComparisonHighlights,
} from "@/components/workspace/estimateComparisonPresentation";
import type { EvidenceLinkModel } from "@/components/chatbot/evidenceLinks";

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

function IssueCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted px-3 py-2.5 text-[13px] leading-5 text-muted-foreground">
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
      <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Top Differences
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-muted p-3">
        {items.map((item) => (
          <div key={item} className="flex gap-2 text-[12px] leading-5 text-foreground">
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
  evidenceModel: _evidenceModel,
  activeEvidenceTargetId: _activeEvidenceTargetId,
}: Props) {
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

  // Shorthand for readability below
  return (
    <div className="flex h-full flex-col text-sm text-foreground">
      {/* Panel intro */}

      <div className="rounded-2xl border border-border bg-card p-4 shadow-[0_14px_38px_rgba(15,23,42,0.10)] backdrop-blur-md dark:shadow-[0_14px_38px_rgba(0,0,0,0.18)]">
        <h3 className="mb-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Repair Intelligence
        </h3>

        <p className="text-sm leading-6 text-muted-foreground">
          Upload an estimate or photos to generate a repair decision.
        </p>
      </div>

      {/* Analysis output */}

      <div className="mt-4 flex-1 min-h-0 overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-[0_18px_40px_rgba(15,23,42,0.10)] backdrop-blur-md dark:shadow-[0_18px_40px_rgba(0,0,0,0.18)]">

        {/* Empty state */}

        {!data && (
          <div className="space-y-2.5">
            <div className="text-sm leading-6 text-foreground">
              Upload an estimate or photos to generate a repair decision.
            </div>
            <div className="text-sm leading-6 text-muted-foreground">
              This panel will show the key repair risks and next steps.
            </div>
          </div>
        )}

        {data && (
          <>
            {/* Risk and confidence summary */}

            <div className="mb-5 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
                Risk: <span className="font-semibold capitalize">{data.riskLevel}</span>
              </div>
              <div className="rounded-xl border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
                Confidence: <span className="font-semibold capitalize">{data.confidence}</span>
              </div>
            </div>

            {/* Sidebar stays decision-focused. Full comparison rows remain available for exports. */}

            <TopDifferencesSummary items={topDifferences} />

            {/* Key issue cards */}

            {data.keyIssues.length > 0 && (
              <div className="mt-5 flex flex-col gap-2">
                <div className="mb-1 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Key Issues
                </div>

                {data.keyIssues.map((issue, i) => (
                  <IssueCard key={i} text={issue} />
                ))}
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
                  className="mt-5 w-full rounded-xl bg-[#C65A2A]/18 p-3 text-xs text-foreground transition hover:bg-[#C65A2A]/26"
                >
                  Generate Supplement Letter
                </button>

                <div className="mt-4 rounded-xl border border-border bg-muted p-3 text-xs whitespace-pre-wrap text-muted-foreground">
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
