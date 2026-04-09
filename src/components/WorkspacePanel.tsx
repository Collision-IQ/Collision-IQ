import { jsPDF } from "jspdf";
import type { WorkspaceData } from "@/types/workspaceTypes";

interface Props {
  workspaceData?: Partial<WorkspaceData> | null;
}

const EMPTY_WORKSPACE_DATA: WorkspaceData = {
  riskLevel: "low",
  confidence: "low",
  keyIssues: [],
  estimateComparisons: [],
  supplementLetter: "",
  fullAnalysis: "",
};
/* ---------------- Sub-components ---------------- */

function IssueCard({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
      {text}
    </div>
  );
}

/* ---------------- Component ---------------- */

export default function WorkspacePanel({ workspaceData }: Props) {
  const data = workspaceData
    ? {
        ...EMPTY_WORKSPACE_DATA,
        ...workspaceData,
        keyIssues: workspaceData.keyIssues ?? EMPTY_WORKSPACE_DATA.keyIssues,
        estimateComparisons:
          workspaceData.estimateComparisons ?? EMPTY_WORKSPACE_DATA.estimateComparisons,
      }
    : null;

  function exportPDF() {
    if (!data) return;

    const { riskLevel, confidence, keyIssues, estimateComparisons, fullAnalysis } = data;

    const doc = new jsPDF();
    const bodyFontSize = 12;
    const headingFontSize = 14;
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 15;
    const topMargin = 20;
    const bottomMargin = 18;
    const maxWidth = 180;
    const lineHeight = 6.2;
    const sectionSpacing = 5;
    const headingSpacing = 7;
    const contentBottomY = pageHeight - bottomMargin;

    let y = topMargin;

    const drawPageNumber = () => {
      doc.setFont("Helvetica", "Normal");
      doc.setFontSize(9);
      doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, pageWidth - marginX, pageHeight - 8, {
        align: "right",
      });
    };

    const addPage = () => {
      doc.addPage();
      y = topMargin;
      drawPageNumber();
    };

    const ensureSpace = (requiredHeight: number) => {
      if (y + requiredHeight <= contentBottomY) return;
      addPage();
    };

    // Write wrapped text line-by-line so long paragraphs can continue safely
    // onto the next page without clipping at the bottom.
    const writeWrappedText = (text: string, options?: { prefix?: string }) => {
      const value = options?.prefix ? `${options.prefix}${text}` : text;
      const lines = doc.splitTextToSize(value, maxWidth);

      for (const line of lines) {
        ensureSpace(lineHeight);
        doc.text(line, marginX, y);
        y += lineHeight;
      }
    };

    const writeSectionHeading = (title: string) => {
      ensureSpace(headingSpacing);
      doc.setFont("Helvetica", "Bold");
      doc.setFontSize(headingFontSize);
      doc.text(title, marginX, y);
      y += headingSpacing;
      doc.setFont("Helvetica", "Normal");
      doc.setFontSize(bodyFontSize);
    };

    doc.setFont("Helvetica", "Bold");
    doc.setFontSize(18);
    doc.text("Collision-IQ Analysis Report", marginX, y);
    y += 12;
    drawPageNumber();

    doc.setFontSize(bodyFontSize);
    doc.setFont("Helvetica", "Normal");

    ensureSpace(lineHeight);
    doc.text(`Risk Score: ${riskLevel}`, marginX, y);
    y += lineHeight;

    ensureSpace(lineHeight);
    doc.text(`Confidence: ${confidence}`, marginX, y);
    y += headingSpacing;

    /* ---------------- Comparison Table ---------------- */

    if (estimateComparisons.length > 0) {
      writeSectionHeading("Estimate Comparison");

      estimateComparisons.forEach((row) => {
        writeWrappedText(`${row.category} | Shop: ${row.shop} | Insurance: ${row.insurance}`);
      });

      y += sectionSpacing;
    }

    /* ---------------- Key Issues ---------------- */

    if (keyIssues.length > 0) {
      writeSectionHeading("Key Issues");

      keyIssues.forEach((issue) => {
        writeWrappedText(issue, { prefix: "! " });
      });

      y += sectionSpacing;
    }

    /* ---------------- Full Analysis ---------------- */

    if (fullAnalysis) {
      writeSectionHeading("Full Analysis");
      writeWrappedText(fullAnalysis);
    }

    doc.save("collision-iq-analysis.pdf");
  }

  // Shorthand for readability below
  return (
    <div className="flex flex-col h-full text-sm text-white">
      {/* Panel intro */}

      <div className="mb-4 rounded-xl bg-glass border-glass p-4 backdrop-blur-md">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-white/50">
          Repair Intelligence
        </h3>

        <p className="text-xs text-white/60">
          Uploaded files and structured repair analysis will appear here.
        </p>
      </div>

      {/* Analysis output */}

      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl bg-glass border-glass p-4 backdrop-blur-md">

        {/* Empty state */}

        {!data && (
          <div className="text-xs text-white/40">
            Assistant output will appear here.
          </div>
        )}

        {data && (
          <>
            {/* Risk and confidence summary */}

            <div className="mb-4 flex gap-3">
              <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
                Risk: <span className="font-semibold capitalize">{data.riskLevel}</span>
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
                Confidence: <span className="font-semibold capitalize">{data.confidence}</span>
              </div>
            </div>

            {/* Estimate comparison table */}

            {data.estimateComparisons.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 text-[11px] uppercase tracking-wider text-white/40">
                  Estimate Comparison
                </div>

                <table className="w-full overflow-hidden rounded-lg border border-white/10 text-xs">
                  <thead className="bg-white/5 text-white/60">
                    <tr>
                      <th className="px-2 py-2 text-left">Category</th>
                      <th className="px-2 py-2 text-left">Shop</th>
                      <th className="px-2 py-2 text-left">Insurance</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.estimateComparisons.map((row, i) => (
                      <tr key={i} className="border-t border-white/10">
                        <td className="px-2 py-2 text-white/80">{row.category}</td>

                        <td className="px-2 py-2 text-green-300">{row.shop}</td>

                        <td className="px-2 py-2 text-red-300">{row.insurance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Key issue cards */}

            {data.keyIssues.length > 0 && (
              <div className="mb-4 flex flex-col gap-2">
                <div className="mb-1 text-[11px] uppercase tracking-wider text-white/40">
                  Key Issues
                </div>

                {data.keyIssues.map((issue, i) => (
                  <IssueCard key={i} text={issue} />
                ))}
              </div>
            )}

            {/* Export buttons */}

            <button
              onClick={exportPDF}
              className="mt-4 w-full rounded-md border border-white/10 bg-white/5 hover:bg-white/10 p-3 text-xs"
            >
              Export PDF Report
            </button>

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
                  className="mt-2 w-full rounded-md border border-white/10 bg-accent/20 hover:bg-accent/30 p-3 text-xs"
                >
                  Generate Supplement Letter
                </button>

                <div className="mt-4 rounded-md border border-white/10 bg-black/60 p-3 text-xs whitespace-pre-wrap">
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
