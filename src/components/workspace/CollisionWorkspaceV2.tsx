"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  BookOpen,
  FolderCheck,
  Gauge,
  LayoutDashboard,
  Settings as SettingsIcon,
  Workflow,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import type { ReviewProgress } from "@/components/ChatWidget";
import type { WorkspaceAnalysisStatus } from "@/components/workspace/CommandCenterPanel";
import {
  AnalysisInsightsPanel,
  CaseActivityPanel,
  type RiskScore,
} from "@/components/workspace/WorkspaceInsightPanels";
import DamagePreviewPanel, {
  type DamagePreviewImage,
} from "@/components/workspace/DamagePreviewPanel";
import ReportsHistoryPanel from "@/components/workspace/ReportsHistoryPanel";
import {
  WorkspaceCalibrationPanel,
  WorkspaceEvidencePanel,
  type WorkspaceCalibrationItem,
  type WorkspaceEvidenceLink,
} from "@/components/workspace/WorkspaceEvidenceCalibration";

type Props = {
  planLabel?: string | null;
  reviewProgress: ReviewProgress;
  analysisStatus: WorkspaceAnalysisStatus;
  latestFileName?: string | null;
  caseEvents: string[];
  riskScore?: RiskScore;
  confidence?: string | null;
  damageImages?: DamagePreviewImage[];
  /** True once an estimate review / comparison has been generated. */
  analysisReady?: boolean;
  evidenceLinks?: WorkspaceEvidenceLink[];
  calibrationItems?: WorkspaceCalibrationItem[];
  headerAuth?: ReactNode;
  /** Reused ChatbotPage slots — unchanged logic. */
  center: ReactNode;
  right: ReactNode;
  bottom?: ReactNode;
};

type WorkspaceView = "workspace" | "reports" | "evidence" | "calibration";

// In-workspace items switch the main content (`view`); items with `href`
// navigate to an existing route. `requiresAnalysis` items stay disabled until an
// estimate review / comparison has been generated.
const NAV_ITEMS: ReadonlyArray<{
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  view?: WorkspaceView;
  href?: string;
  requiresAnalysis?: boolean;
}> = [
  { id: "command", label: "Command Center", icon: LayoutDashboard, view: "workspace" },
  { id: "workspace", label: "Analysis Workspace", icon: Workflow, view: "workspace" },
  { id: "evidence", label: "Evidence", icon: FolderCheck, view: "evidence", requiresAnalysis: true },
  { id: "reports", label: "Reports", icon: BookOpen, view: "reports" },
  { id: "knowledge", label: "Knowledge Base", icon: BookOpen, href: "/how-it-works" },
  { id: "calibration", label: "Calibration", icon: Gauge, view: "calibration", requiresAnalysis: true },
  { id: "settings", label: "Settings", icon: SettingsIcon, href: "/account" },
];

/**
 * V2 "Analysis Workspace" shell. Purely presentational chrome (top bar, sidebar,
 * command-center rail, bottom insight panels) wrapped around the existing
 * ChatbotPage center/right/bottom slots — no logic, state, or API changes.
 */
export default function CollisionWorkspaceV2({
  planLabel,
  caseEvents,
  riskScore = "unknown",
  confidence,
  damageImages = [],
  analysisReady = false,
  evidenceLinks = [],
  calibrationItems = [],
  headerAuth,
  center,
  right,
  bottom,
}: Props) {
  const [activeNav, setActiveNav] = useState<string>("workspace");
  const activeItem = NAV_ITEMS.find((item) => item.id === activeNav);
  // Guard: never stay on a gated view if analysis is no longer available.
  const activeView: WorkspaceView =
    activeItem?.requiresAnalysis && !analysisReady ? "workspace" : activeItem?.view ?? "workspace";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/iq/iq-app.png" alt="" width={30} height={30} className="h-7 w-7 shrink-0 rounded-md object-contain" aria-hidden />
          <span className="relative block h-6 w-[112px] shrink-0">
            <Image src="/iq/iq_logo.png" alt="Collision IQ" fill sizes="112px" className="object-contain object-left dark:hidden" />
            <Image src="/iq/iq_logo-white.png" alt="Collision IQ" fill sizes="112px" className="hidden object-contain object-left dark:block" />
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground md:inline">
            Forensic Repair Intelligence
          </span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Link
            href="/technical-systems"
            className="hidden min-h-9 items-center rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-black transition sm:inline-flex"
          >
            Technical Systems
          </Link>
          <Link
            href="/the-academy"
            className="hidden min-h-9 items-center rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-background md:inline-flex"
          >
            Professional Services
          </Link>
          <ThemeToggle />
          {planLabel ? (
            <span className="hidden rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/12 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#F3A37F] lg:inline">
              {planLabel}
            </span>
          ) : null}
          {headerAuth}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <nav className="hidden w-52 shrink-0 flex-col gap-1 border-r border-border bg-card/60 p-2 lg:flex">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            const locked = Boolean(item.requiresAnalysis && !analysisReady);
            const classes = `inline-flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition ${
              locked
                ? "cursor-not-allowed text-muted-foreground/40"
                : active
                  ? "bg-[var(--accent)]/12 text-foreground ring-1 ring-[var(--accent)]/30"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`;
            const inner = (
              <>
                <Icon size={16} className={active && !locked ? "text-[var(--accent)]" : ""} />
                {item.label}
              </>
            );
            if (locked) {
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled
                  className={classes}
                  title="Available after an estimate review or comparison is generated"
                >
                  {inner}
                </button>
              );
            }
            return item.href ? (
              <Link key={item.id} href={item.href} className={classes}>
                {inner}
              </Link>
            ) : (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={classes}
                aria-current={active ? "page" : undefined}
              >
                {inner}
              </button>
            );
          })}
        </nav>

        {/* Main + rail + bottom panels */}
        <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 sm:p-3">
          <div className="flex items-center gap-2 px-1">
            <Workflow size={16} className="text-[var(--accent)]" />
            <h1 className="text-[15px] font-semibold text-foreground">
              {activeView === "reports"
                ? "Reports"
                : activeView === "evidence"
                  ? "Evidence"
                  : activeView === "calibration"
                    ? "Calibration"
                    : "Analysis Workspace"}
            </h1>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
            {activeView === "reports" ? (
              <ReportsHistoryPanel />
            ) : activeView === "evidence" ? (
              <WorkspaceEvidencePanel links={evidenceLinks} />
            ) : activeView === "calibration" ? (
              <WorkspaceCalibrationPanel items={calibrationItems} />
            ) : (
              <div className="ci-panel flex min-h-0 min-w-0 flex-col overflow-hidden">{center}</div>
            )}
            <aside className="ci-panel hidden min-h-0 flex-col overflow-y-auto p-3 lg:flex">
              {right}
            </aside>
          </div>

          {activeView === "workspace" ? (
            <div className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-3">
              <CaseActivityPanel events={caseEvents} />
              <AnalysisInsightsPanel riskScore={riskScore} confidence={confidence} />
              <DamagePreviewPanel images={damageImages} />
            </div>
          ) : null}

          {bottom ? <div className="shrink-0">{bottom}</div> : null}
        </main>
      </div>
    </div>
  );
}
