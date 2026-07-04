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
import CommandCenterPanel, {
  type WorkspaceAnalysisStatus,
} from "@/components/workspace/CommandCenterPanel";
import {
  AnalysisInsightsPanel,
  CaseActivityPanel,
  DamagePreviewPanel,
} from "@/components/workspace/WorkspaceInsightPanels";

type Props = {
  planLabel?: string | null;
  reviewProgress: ReviewProgress;
  analysisStatus: WorkspaceAnalysisStatus;
  latestFileName?: string | null;
  damagePreviewImage?: string | null;
  caseEvents: string[];
  onUploadPhotos?: () => void;
  headerAuth?: ReactNode;
  /** Reused ChatbotPage slots — unchanged logic. */
  center: ReactNode;
  right: ReactNode;
  bottom?: ReactNode;
};

const NAV_ITEMS = [
  { key: "command", label: "Command Center", icon: LayoutDashboard },
  { key: "workspace", label: "Analysis Workspace", icon: Workflow, active: true },
  { key: "evidence", label: "Evidence", icon: FolderCheck },
  { key: "reports", label: "Reports", icon: BookOpen },
  { key: "knowledge", label: "Knowledge Base", icon: BookOpen },
  { key: "calibration", label: "Calibration", icon: Gauge },
  { key: "settings", label: "Settings", icon: SettingsIcon },
] as const;

/**
 * V2 "Analysis Workspace" shell. Purely presentational chrome (top bar, sidebar,
 * command-center rail, bottom insight panels) wrapped around the existing
 * ChatbotPage center/right/bottom slots — no logic, state, or API changes.
 */
export default function CollisionWorkspaceV2({
  planLabel,
  reviewProgress,
  analysisStatus,
  latestFileName,
  damagePreviewImage,
  caseEvents,
  onUploadPhotos,
  headerAuth,
  center,
  right,
  bottom,
}: Props) {
  const [activeNav, setActiveNav] = useState<string>("workspace");

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
            const active = activeNav === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveNav(item.key)}
                className={`inline-flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition ${
                  active
                    ? "bg-[var(--accent)]/12 text-foreground ring-1 ring-[var(--accent)]/30"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={16} className={active ? "text-[var(--accent)]" : ""} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Main + rail + bottom panels */}
        <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 sm:p-3">
          <div className="flex items-center gap-2 px-1">
            <Workflow size={16} className="text-[var(--accent)]" />
            <h1 className="text-[15px] font-semibold text-foreground">Analysis Workspace</h1>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="ci-panel flex min-h-0 min-w-0 flex-col overflow-hidden">{center}</div>
            <aside className="hidden min-h-0 flex-col lg:flex">
              <CommandCenterPanel
                reviewProgress={reviewProgress}
                analysisStatus={analysisStatus}
                latestFileName={latestFileName}
              >
                {right}
              </CommandCenterPanel>
            </aside>
          </div>

          <div className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-3">
            <CaseActivityPanel events={caseEvents} />
            <AnalysisInsightsPanel status={analysisStatus} />
            <DamagePreviewPanel imageSrc={damagePreviewImage} onUploadPhotos={onUploadPhotos} />
          </div>

          {bottom ? <div className="shrink-0">{bottom}</div> : null}
        </main>
      </div>
    </div>
  );
}
