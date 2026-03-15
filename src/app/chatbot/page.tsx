"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import ChatWidget from "@/components/ChatWidget";
import { useIsMobile } from "@/hooks/useIsMobile";
import { jsPDF } from "jspdf";

export default function ChatbotPage() {
  const isMobile = useIsMobile();

  const [railOpen, setRailOpen] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [analysisText, setAnalysisText] = useState("");

  /* -------------------------------------------------------------------------- */
  /* Derived metrics                                                            */
  /* -------------------------------------------------------------------------- */

  const riskScore = analysisText.includes("Risk") ? "High" : "--";
  const confidenceScore = analysisText ? "Moderate" : "--";

  const criticalIssues =
    (analysisText.match(/Exposure|Risk|Gap|Missing/gi) || []).length;

  const evidenceQuality = analysisText.includes("Evidence")
    ? "Present"
    : "--";

  useEffect(() => {
    if (isMobile === null) return;
    // Keep the mobile rail collapsed when the viewport mode changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRailOpen(false);
  }, [isMobile]);

  if (isMobile === null) return null;

  return (
    <div className="h-screen bg-black text-white flex flex-col">

      {/* --------------------------------------------------------------------- */}
      {/* HEADER                                                               */}
      {/* --------------------------------------------------------------------- */}

      <header className="px-6 py-4 border-b border-white/10 bg-black/60 backdrop-blur-md">

        <div className="flex items-center justify-center gap-4 max-w-[1400px] mx-auto">

          <Image
            src="/brand/logos/Logo-grey.png"
            alt="Collision Academy"
            width={150}
            height={40}
            className="opacity-90"
            priority
          />

          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-white/70 bg-clip-text text-transparent">
              Collision-IQ
            </h1>

            <p className="text-xs text-white/50">
              Repair intelligence for estimates, OEM procedures, and damage photos
            </p>
          </div>

        </div>

      </header>

      {/* --------------------------------------------------------------------- */}
      {/* MAIN WORKSPACE                                                       */}
      {/* --------------------------------------------------------------------- */}

      <div className="flex flex-1 min-h-0 w-full max-w-[1400px] mx-auto">

        {/* Chat column */}

        <div className="flex flex-col flex-1 min-w-0">

          <div className="flex-1 min-h-0 flex justify-center">

            <div className="flex flex-col w-full max-w-[900px] min-h-0">

              <ChatWidget
                onAttachmentChange={setAttachment}
                onAnalysisChange={setAnalysisText}
              />

            </div>

          </div>

        </div>

        {/* Desktop analysis rail */}

        {!isMobile && (
          <aside className="w-[360px] border-l border-white/10 bg-black/70 backdrop-blur-xl flex flex-col">

            <RailContent
              attachment={attachment}
              analysisText={analysisText}
              riskScore={riskScore}
              confidenceScore={confidenceScore}
              criticalIssues={criticalIssues}
              evidenceQuality={evidenceQuality}
            />

          </aside>
        )}

      </div>

      {/* ------------------------------------------------------------------ */}
      {/* MOBILE RAIL                                                        */}
      {/* ------------------------------------------------------------------ */}

      {isMobile && !railOpen && (
        <button
          onClick={() => setRailOpen(true)}
          className="fixed bottom-6 right-6 rounded-full bg-orange-500 hover:bg-orange-600 px-5 py-3 text-white shadow-lg z-50"
        >
          Insights
        </button>
      )}

      {isMobile && railOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50">

          <button
            onClick={() => setRailOpen(false)}
            className="absolute top-4 right-4 text-white text-xl"
          >
            ✕
          </button>

          <RailContent
            attachment={attachment}
            analysisText={analysisText}
            riskScore={riskScore}
            confidenceScore={confidenceScore}
            criticalIssues={criticalIssues}
            evidenceQuality={evidenceQuality}
          />

        </div>
      )}

    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ANALYSIS RAIL                                                              */
/* -------------------------------------------------------------------------- */

function extractSummary(text: string) {
  const sections = {
    risks: [] as string[],
    gaps: [] as string[],
    actions: [] as string[],
  };

  text.split("\n").forEach((line) => {
    const lower = line.toLowerCase();

    if (lower.includes("risk") || lower.includes("exposure")) {
      sections.risks.push(line.replace(/[-*]/g, "").trim());
    }

    if (lower.includes("gap") || lower.includes("missing")) {
      sections.gaps.push(line.replace(/[-*]/g, "").trim());
    }

    if (lower.includes("recommend") || lower.includes("should")) {
      sections.actions.push(line.replace(/[-*]/g, "").trim());
    }
  });

  return sections;
}

function RailContent({
  // Reserved for attachment-specific rail content.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  attachment: _attachment,
  analysisText,
  riskScore,
  confidenceScore,
  criticalIssues,
  evidenceQuality,
}: {
  attachment: string | null;
  analysisText: string;
  riskScore: string;
  confidenceScore: string;
  criticalIssues: number;
  evidenceQuality: string;
}) {
  const summary = extractSummary(analysisText);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 space-y-8">
      <div>
        <div className="text-xs tracking-[0.3em] uppercase text-white/60">
          Repair Intelligence
        </div>

        <div className="text-xl font-semibold mt-1">
          Analysis
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SnapshotCard label="Risk Score" value={riskScore} />
        <SnapshotCard label="Confidence" value={confidenceScore} />
        <SnapshotCard label="Critical Issues" value={String(criticalIssues)} />
        <SnapshotCard label="Evidence Quality" value={evidenceQuality} />
      </div>

      <section className="space-y-4">
        <div className="text-[11px] uppercase text-white/40">
          Key Risks
        </div>

        {summary.risks.slice(0, 3).map((r, i) => (
          <InsightCard key={i} text={r} color="red" />
        ))}

        <div className="text-[11px] uppercase text-white/40 mt-4">
          Evidence Gaps
        </div>

        {summary.gaps.slice(0, 3).map((g, i) => (
          <InsightCard key={i} text={g} color="yellow" />
        ))}

        <div className="text-[11px] uppercase text-white/40 mt-4">
          Recommended Actions
        </div>

        {summary.actions.slice(0, 3).map((a, i) => (
          <InsightCard key={i} text={a} color="green" />
        ))}
      </section>

      {analysisText && (
        <button
          onClick={() => {
            if (!analysisText) return;

            const doc = new jsPDF();

            let y = 20;

            doc.setFont("Helvetica", "Bold");
            doc.setFontSize(16);
            doc.text("Collision-IQ Analysis Report", 15, y);

            y += 10;

            doc.setFont("Helvetica", "Normal");
            doc.setFontSize(11);

            const lines = doc.splitTextToSize(analysisText, 180);

            doc.text(lines, 15, y);

            doc.save("collision-iq-analysis.pdf");
          }}
          className="mt-4 w-full rounded-md border border-white/10 bg-white/5 hover:bg-white/10 p-3 text-xs"
        >
          Export PDF Report
        </button>
      )}
          </div>
        );
      }

/* -------------------------------------------------------------------------- */
/* SNAPSHOT CARD                                                              */
/* -------------------------------------------------------------------------- */

function SnapshotCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-3 backdrop-blur-md">

      <div className="text-[10px] uppercase text-white/40">
        {label}
      </div>

      <div className="text-lg font-semibold">
        {value}
      </div>

    </div>
  );
}
function InsightCard({
  text,
  color,
}: {
  text: string;
  color: "red" | "yellow" | "green";
}) {

  const colors = {
    red: "border-red-500/30 text-red-300",
    yellow: "border-yellow-500/30 text-yellow-300",
    green: "border-green-500/30 text-green-300",
  };

  return (
    <div className={`border rounded-md p-3 text-sm ${colors[color]}`}>
      {text}
    </div>
  );
}
