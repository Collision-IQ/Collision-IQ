"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { jsPDF } from "jspdf";
import ChatWidget from "@/components/ChatWidget";
import type { ChatFinding } from "@/lib/ai/types/chatFindings";
import { useIsMobile } from "@/hooks/useIsMobile";

type InspectorPanelData = {
  riskScore: "low" | "medium" | "high" | "unknown";
  confidence: "low" | "medium" | "high";
  criticalIssues: number;
  evidenceQuality: "present" | "limited" | "none";
  keyRisks: string[];
  processFindings: string[];
  gapFindings: string[];
  optimizationFindings: string[];
  evidenceReferences: string[];
};

const EMPTY_PANEL: InspectorPanelData = {
  riskScore: "low",
  confidence: "low",
  criticalIssues: 0,
  evidenceQuality: "none",
  keyRisks: [],
  processFindings: [],
  gapFindings: [],
  optimizationFindings: [],
  evidenceReferences: [],
};

export default function ChatbotPage() {
  const isMobile = useIsMobile();
  const [desktopRailOpen, setDesktopRailOpen] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [analysisText, setAnalysisText] = useState("");
  const [findings, setFindings] = useState<ChatFinding[]>([]);

  const inspector = useMemo(() => buildInspectorPanelData(findings), [findings]);
  const railOpen = isMobile ? false : desktopRailOpen;

  function handleRailOpenChange(next: boolean) {
    if (isMobile) return;
    setDesktopRailOpen(next);
  }

  if (isMobile === null) return null;

  return (
    <div className="h-screen bg-black text-white flex flex-col">
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

      <div className="flex flex-1 min-h-0 w-full max-w-[1400px] mx-auto">
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 min-h-0 flex justify-center">
            <div className="flex flex-col w-full max-w-[900px] min-h-0">
              <ChatWidget
                onAttachmentChange={setAttachment}
                onAnalysisChange={setAnalysisText}
                onFindingsChange={setFindings}
              />
            </div>
          </div>
        </div>

        {!isMobile && (
          <aside className="w-[360px] border-l border-white/10 bg-black/70 backdrop-blur-xl flex flex-col">
            <RailContent
              attachment={attachment}
              analysisText={analysisText}
              findings={findings}
              panelData={inspector}
            />
          </aside>
        )}
      </div>

      {isMobile && !railOpen && (
        <button
          onClick={() => handleRailOpenChange(true)}
          className="fixed bottom-6 right-6 rounded-full bg-orange-500 hover:bg-orange-600 px-5 py-3 text-white shadow-lg z-50"
        >
          Insights
        </button>
      )}

      {isMobile && railOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50">
          <button
            onClick={() => handleRailOpenChange(false)}
            className="absolute top-4 right-4 text-white text-xl"
          >
            X
          </button>

          <RailContent
            attachment={attachment}
            analysisText={analysisText}
            findings={findings}
            panelData={inspector}
          />
        </div>
      )}
    </div>
  );
}

function RailContent({
  attachment,
  analysisText,
  findings,
  panelData,
}: {
  attachment: string | null;
  analysisText: string;
  findings: ChatFinding[];
  panelData: InspectorPanelData;
}) {
  const summary = extractSummary(analysisText);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 space-y-8">
      <div>
        <div className="text-xs tracking-[0.3em] uppercase text-white/60">
          Repair Intelligence
        </div>

        <div className="text-xl font-semibold mt-1">Analysis</div>

        {attachment && (
          <div className="mt-2 text-xs text-white/40 truncate">
            Latest attachment: {attachment}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SnapshotCard label="Risk Score" value={formatLabel(panelData.riskScore)} />
        <SnapshotCard label="Confidence" value={formatLabel(panelData.confidence)} />
        <SnapshotCard label="Critical Issues" value={String(panelData.criticalIssues)} />
        <SnapshotCard
          label="Evidence Quality"
          value={formatLabel(panelData.evidenceQuality)}
        />
      </div>

      <section className="space-y-4">
        <PanelSection
          title="Key Risks"
          items={panelData.keyRisks}
          emptyLabel="No high-risk items detected yet."
          color="red"
        />

        <PanelSection
          title="Process Findings"
          items={panelData.processFindings}
          emptyLabel="No process findings detected yet."
          color="yellow"
        />

        <PanelSection
          title="Gaps"
          items={panelData.gapFindings}
          emptyLabel="No gaps detected yet."
          color="yellow"
        />

        <PanelSection
          title="Optimization Opportunities"
          items={panelData.optimizationFindings}
          emptyLabel="No optimization opportunities detected yet."
          color="green"
        />

        <PanelSection
          title="Finding Details"
          items={panelData.evidenceReferences}
          emptyLabel={
            findings.length > 0
              ? "Findings extracted without extra detail."
              : "No findings extracted yet."
          }
          color="neutral"
        />
      </section>

      {analysisText && (
        <button
          onClick={() => exportReport(analysisText, panelData)}
          className="mt-4 w-full rounded-md border border-white/10 bg-white/5 hover:bg-white/10 p-3 text-xs"
        >
          Export PDF Report
        </button>
      )}
    </div>
  );
}

function PanelSection({
  title,
  items,
  emptyLabel,
  color,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
  color: "red" | "yellow" | "green" | "neutral";
}) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase text-white/40">{title}</div>

      {items.length > 0 ? (
        items.slice(0, 4).map((item, index) => (
          <InsightCard key={`${title}-${index}`} text={item} color={color} />
        ))
      ) : (
        <div className="text-xs text-white/35">{emptyLabel}</div>
      )}
    </div>
  );
}

function exportReport(analysisText: string, panelData: InspectorPanelData) {
  const doc = new jsPDF();
  let y = 20;

  doc.setFont("Helvetica", "Bold");
  doc.setFontSize(16);
  doc.text("Collision-IQ Analysis Report", 15, y);
  y += 10;

  doc.setFont("Helvetica", "Normal");
  doc.setFontSize(11);
  doc.text(`Risk Score: ${formatLabel(panelData.riskScore)}`, 15, y);
  y += 6;
  doc.text(`Confidence: ${formatLabel(panelData.confidence)}`, 15, y);
  y += 6;
  doc.text(`Critical Issues: ${panelData.criticalIssues}`, 15, y);
  y += 10;

  const lines = doc.splitTextToSize(analysisText, 180);
  doc.text(lines, 15, y);
  doc.save("collision-iq-analysis.pdf");
}

function formatLabel(value: string) {
  if (!value) return "--";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildInspectorPanelData(findings: ChatFinding[]): InspectorPanelData {
  if (findings.length === 0) {
    return EMPTY_PANEL;
  }

  const highCount = findings.filter((finding) => finding.severity === "high").length;
  const mediumCount = findings.filter((finding) => finding.severity === "medium").length;

  return {
    riskScore: highCount > 0 ? "high" : mediumCount > 0 ? "medium" : "low",
    confidence: findings.length >= 4 ? "high" : findings.length >= 2 ? "medium" : "low",
    criticalIssues: highCount,
    evidenceQuality: findings.length > 0 ? "limited" : "none",
    keyRisks: findings
      .filter((finding) => finding.category === "risk" || finding.severity === "high")
      .slice(0, 4)
      .map((finding) => finding.title),
    processFindings: findings
      .filter((finding) => finding.category === "process")
      .slice(0, 4)
      .map((finding) => finding.title),
    gapFindings: findings
      .filter((finding) => finding.category === "gap")
      .slice(0, 4)
      .map((finding) => finding.title),
    optimizationFindings: findings
      .filter((finding) => finding.category === "optimization")
      .slice(0, 4)
      .map((finding) => finding.title),
    evidenceReferences: findings
      .slice(0, 4)
      .map((finding) => `${finding.title}: ${finding.explanation}`),
  };
}

function SnapshotCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-3 backdrop-blur-md">
      <div className="text-[10px] uppercase text-white/40">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function InsightCard({
  text,
  color,
}: {
  text: string;
  color: "red" | "yellow" | "green" | "neutral";
}) {
  const colors = {
    red: "border-red-500/30 text-red-300",
    yellow: "border-yellow-500/30 text-yellow-300",
    green: "border-green-500/30 text-green-300",
    neutral: "border-white/10 text-white/75",
  };

  return (
    <div className={`border rounded-md p-3 text-sm ${colors[color]}`}>
      {text}
    </div>
  );
}
