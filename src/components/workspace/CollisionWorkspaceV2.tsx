"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  clearNavUpdate,
  markVehicleMaintenanceIfChanged,
  useNavUpdateFlags,
  type NavUpdateSection,
} from "@/lib/ui/navUpdates";
import { CHAT_REOPEN_EVENT } from "@/lib/ui/chatReopen";
import { WORKSPACE_NAV_EVENT, type WorkspaceNavDetail } from "@/lib/ui/workspaceNav";
import { useWorkspaceExtraSlots } from "@/components/workspace/WorkspaceExtraSlots";
import {
  Activity,
  BookOpen,
  Camera,
  Car,
  ChevronDown,
  FileText,
  FolderCheck,

  HelpCircle,
  LayoutDashboard,
  Menu,
  Settings as SettingsIcon,
  Workflow,
  X,
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
import MyVehiclePanel from "@/components/workspace/MyVehiclePanel";
import ScanIqPanel from "@/components/workspace/ScanIqPanel";
import {
  WorkspaceCalibrationPanel,
  WorkspaceEvidencePanel,
  type WorkspaceCalibrationItem,
  type WorkspaceEvidenceLink,
} from "@/components/workspace/WorkspaceEvidenceCalibration";

function restartOnboardingTour() {
  window.dispatchEvent(new Event("collisioniq:tutorial:start"));
}

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
  /** Stored analysis report id — used for on-demand fresh OEM/jurisdiction retrieval. */
  caseId?: string | null;
  headerAuth?: ReactNode;
  /** Reused ChatbotPage slots — unchanged logic. */
  center: ReactNode;
  right: ReactNode;
  bottom?: ReactNode;
  /** Dedicated Reports tab content (the live report cards, full width). */
  reportsPanel?: ReactNode;
};

type WorkspaceView =
  | "workspace"
  | "reportcenter"
  | "reports"
  | "evidence"
  | "calibration"
  | "vehicle"
  | "scaniq";

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
  // "Command Center" and "Calibration" were removed deliberately: Command
  // Center duplicated the Analysis Workspace view, and Calibration guidance
  // lives inside the analysis itself. "Reports" hosts the live report cards
  // (Snapshot, Repair Intelligence, Delta/OEM Citation Density, DOI,
  // Customer) so chat and the review workspace stay open while inspecting
  // them; "History" holds the saved archive + past chats.
  { id: "workspace", label: "Analysis Workspace", icon: Workflow, view: "workspace" },
  { id: "reports", label: "Reports", icon: FileText, view: "reportcenter", requiresAnalysis: true },
  { id: "evidence", label: "Evidence", icon: FolderCheck, view: "evidence", requiresAnalysis: true },
  { id: "vehicle", label: "My Vehicle", icon: Car, view: "vehicle" },
  { id: "scaniq", label: "Scan IQ", icon: Activity, view: "scaniq" },
  { id: "history", label: "History", icon: BookOpen, view: "reports" },
  { id: "knowledge", label: "Knowledge Base", icon: BookOpen, href: "/how-it-works" },
  { id: "settings", label: "Settings", icon: SettingsIcon, href: "/account" },
];

const NAV_TOUR_TARGETS: Record<string, string> = {
  workspace: "nav-analysis-workspace",
  reports: "nav-reports",
  evidence: "nav-evidence",
  vehicle: "nav-my-vehicle",
  history: "nav-history",
  knowledge: "nav-knowledge-base",
  settings: "nav-settings",
};

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
  caseId,
  headerAuth,
  center,
  right,
  bottom,
  reportsPanel,
}: Props) {
  // ChatShell doesn't thread this slot; the context provider around it does.
  const extraSlots = useWorkspaceExtraSlots();
  const effectiveReportsPanel = reportsPanel ?? extraSlots.reportsPanel;
  const [activeNav, setActiveNav] = useState<string>("workspace");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // "Recent reports" strip in the Analysis Workspace + deep link into History.
  const [recentReports, setRecentReports] = useState<Array<{ id: string; title: string }>>([]);
  const [pendingReportId, setPendingReportId] = useState<string | null>(null);
  const navUpdateFlags = useNavUpdateFlags();

  // A section the user is currently viewing never keeps an unseen-update dot:
  // updates that land while it's open are already seen.
  useEffect(() => {
    if (navUpdateFlags[activeNav as NavUpdateSection]) {
      clearNavUpdate(activeNav as NavUpdateSection);
    }
  }, [navUpdateFlags, activeNav]);

  // Reopening a saved chat always lands in the Analysis Workspace.
  useEffect(() => {
    const handleReopen = () => {
      clearNavUpdate("workspace");
      setActiveNav("workspace");
      setMobileNavOpen(false);
    };
    window.addEventListener(CHAT_REOPEN_EVENT, handleReopen);
    return () => window.removeEventListener(CHAT_REOPEN_EVENT, handleReopen);
  }, []);

  // External nav requests (e.g. the "Reports ready" toast opening the
  // Reports tab). Only known, in-shell sections are honored.
  useEffect(() => {
    const handleNavRequest = (event: Event) => {
      const section = (event as CustomEvent<WorkspaceNavDetail>).detail?.section;
      const item = NAV_ITEMS.find((candidate) => candidate.id === section);
      if (!item || !item.view) return;
      clearNavUpdate(item.id as NavUpdateSection);
      setPendingReportId(null);
      setActiveNav(item.id);
      setMobileNavOpen(false);
    };
    window.addEventListener(WORKSPACE_NAV_EVENT, handleNavRequest);
    return () => window.removeEventListener(WORKSPACE_NAV_EVENT, handleNavRequest);
  }, []);
  // My Vehicle red dot: check the maintenance picture once per mount and flag
  // the nav item when something newly came due (fingerprinted so the same due
  // set never re-notifies).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/vehicle", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as {
          maintenance?: { items?: Array<{ key: string; status: string }> } | null;
        };
        const dueKeys = (data.maintenance?.items ?? [])
          .filter((item) => item.status === "overdue" || item.status === "due-soon")
          .map((item) => item.key);
        if (!cancelled) markVehicleMaintenanceIfChanged(dueKeys);
      } catch {
        // signed-out / offline — no dot
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Saved reports surface directly in the Analysis Workspace (it doubles as
  // the command center). Refetched when a new analysis resolves so the strip
  // always includes the report that just generated.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/reports/history", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as {
          reports?: Array<{ id: string; title: string }>;
        };
        if (!cancelled) {
          setRecentReports(
            (data.reports ?? []).slice(0, 3).map((report) => ({ id: report.id, title: report.title }))
          );
        }
      } catch {
        // signed-out / plan-locked — no strip
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [analysisReady]);
  const activeItem = NAV_ITEMS.find((item) => item.id === activeNav);
  // Guard: never stay on a gated view if analysis is no longer available.
  const activeView: WorkspaceView =
    activeItem?.requiresAnalysis && !analysisReady ? "workspace" : activeItem?.view ?? "workspace";

  // Shared nav-item renderer used by both the desktop sidebar and the mobile
  // drawer. `onNavigate` lets the drawer close itself after a selection.
  const renderNavItem = (item: (typeof NAV_ITEMS)[number], onNavigate?: () => void) => {
    const Icon = item.icon;
    const active = activeNav === item.id;
    const locked = Boolean(item.requiresAnalysis && !analysisReady);
    const hasUpdate = !active && !locked && navUpdateFlags[item.id as NavUpdateSection] === true;
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
        <span className="flex-1">{item.label}</span>
        {hasUpdate ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-red-500"
            aria-label="New update"
            title="New update in this section"
          />
        ) : null}
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
          data-tour={NAV_TOUR_TARGETS[item.id]}
        >
          {inner}
        </button>
      );
    }
    return item.href ? (
      <Link
        key={item.id}
        href={item.href}
        className={classes}
        onClick={() => {
          clearNavUpdate(item.id as NavUpdateSection);
          onNavigate?.();
        }}
        data-tour={NAV_TOUR_TARGETS[item.id]}
      >
        {inner}
      </Link>
    ) : (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          clearNavUpdate(item.id as NavUpdateSection);
          // Direct nav clicks open the plain History list, not a deep link.
          setPendingReportId(null);
          setActiveNav(item.id);
          onNavigate?.();
        }}
        className={classes}
        aria-current={active ? "page" : undefined}
        data-tour={NAV_TOUR_TARGETS[item.id]}
      >
        {inner}
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      {/* Top bar */}
      <header data-tour="app-header" className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-foreground transition hover:bg-muted lg:hidden"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
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

      {/* Mobile / foldable nav drawer (< lg) */}
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
          <nav
            className="absolute left-0 top-0 flex h-full w-64 max-w-[82%] flex-col gap-1 border-r border-border bg-card p-3 shadow-2xl"
            data-tour="command-center-sidebar"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="ci-eyebrow">Menu</span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>
            {NAV_ITEMS.map((item) => renderNavItem(item, () => setMobileNavOpen(false)))}
            <button
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                restartOnboardingTour();
              }}
              className="mt-auto inline-flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
            >
              <HelpCircle size={16} />
              Tutorial
            </button>
          </nav>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Sidebar (lg+) */}
        <nav
          className="hidden w-52 shrink-0 flex-col gap-1 border-r border-border bg-card/60 p-2 lg:flex"
          data-tour="command-center-sidebar"
        >
          {NAV_ITEMS.map((item) => renderNavItem(item))}
          <button
            type="button"
            onClick={restartOnboardingTour}
            className="mt-auto inline-flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
          >
            <HelpCircle size={16} />
            Tutorial
          </button>
        </nav>

        {/* Main + rail + bottom panels */}
        <main data-tour="report-workspace" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 sm:p-3">
          <div className="flex items-center gap-2 px-1">
            <Workflow size={16} className="text-[var(--accent)]" />
            <h1 className="text-[15px] font-semibold text-foreground">
              {activeView === "reports"
                ? "History"
                : activeView === "reportcenter"
                  ? "Reports"
                : activeView === "vehicle"
                  ? "My Vehicle"
                  : activeView === "scaniq"
                    ? "Scan IQ"
                  : activeView === "evidence"
                    ? "Evidence"
                    : activeView === "calibration"
                      ? "Calibration"
                      : "Analysis Workspace"}
            </h1>
          </div>

          {/* The workspace doubles as the command center: generated reports
              surface here immediately, with History holding the full archive. */}
          {activeView === "workspace" && recentReports.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--accent)]/30 bg-card px-3 py-2"
              data-tour="recent-reports"
            >
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                Recent reports
              </span>
              {recentReports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => {
                    clearNavUpdate("history");
                    setPendingReportId(report.id);
                    setActiveNav("history");
                  }}
                  className="max-w-[240px] truncate rounded-lg border border-border bg-muted px-2.5 py-1.5 text-[12px] font-medium text-foreground transition hover:border-[var(--accent)]/45 hover:bg-background"
                  title={`Open report: ${report.title}`}
                >
                  {report.title}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  clearNavUpdate("history");
                  setPendingReportId(null);
                  setActiveNav("history");
                }}
                className="text-[12px] font-medium text-[var(--accent)] underline-offset-2 hover:underline"
              >
                View all
              </button>
            </div>
          ) : null}

          {/* Chat fills all available height (maximized); the mobile Damage
              Preview accordion + footer sit below it at the bottom. */}
          <div
            className={`grid min-h-0 flex-1 grid-cols-1 gap-3 ${
              activeView === "reportcenter" ? "" : "lg:grid-cols-[minmax(0,1fr)_360px]"
            }`}
          >
            {activeView === "reports" ? (
              <div data-tour="past-reports">
                <ReportsHistoryPanel initialReportId={pendingReportId} />
              </div>
            ) : activeView === "reportcenter" ? (
              <div className="flex min-h-0 flex-col" data-tour="reports-tab">
                {effectiveReportsPanel}
              </div>
            ) : activeView === "vehicle" ? (
              <MyVehiclePanel />
            ) : activeView === "scaniq" ? (
              <ScanIqPanel />
            ) : activeView === "evidence" ? (
              <WorkspaceEvidencePanel links={evidenceLinks} caseId={caseId} />
            ) : activeView === "calibration" ? (
              <WorkspaceCalibrationPanel items={calibrationItems} />
            ) : (
              <div className="ci-panel flex min-h-0 min-w-0 flex-col overflow-hidden">{center}</div>
            )}
            {activeView === "reportcenter" ? null : (
              // The Reports tab IS the rail's report section at full width —
              // hiding the rail there avoids duplicate report cards.
              <aside className="ci-panel hidden min-h-0 flex-col overflow-y-auto p-3 lg:flex">
                {right}
              </aside>
            )}
          </div>

          {activeView === "workspace" ? (
            <>
              {/* Tablet / desktop: full insight rail. */}
              <div className="hidden shrink-0 grid-cols-3 gap-3 md:grid">
                <CaseActivityPanel events={caseEvents} />
                <AnalysisInsightsPanel riskScore={riskScore} confidence={confidence} />
                <div data-tour="damage-preview">
                  <DamagePreviewPanel images={damageImages} />
                </div>
              </div>
              {/* Mobile: chat is the focus. Drop Case Activity + Analysis Insights;
                  Damage Preview stays collapsed and only generates when opened. */}
              <div className="shrink-0 md:hidden" data-tour="damage-preview">
                <MobileDamagePreview images={damageImages} />
              </div>
            </>
          ) : null}

          {bottom ? <div className="shrink-0">{bottom}</div> : null}
        </main>
      </div>
    </div>
  );
}

/**
 * Mobile-only collapsed Damage Preview. The panel auto-generates a heat map on
 * mount, so we lazy-mount it only after the user opens the accordion — nothing
 * runs (or calls the vision API) until it's prompted.
 */
function MobileDamagePreview({ images }: { images: DamagePreviewImage[] }) {
  const [open, setOpen] = useState(false);
  const count = images.length;
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ci-panel flex w-full items-center justify-between gap-3 p-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Camera size={15} className="shrink-0 text-[var(--accent)]" />
          <span className="truncate text-sm font-medium text-foreground">Damage Preview</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {count === 0 ? "no photos yet" : open ? "tap to hide" : "tap to generate heat map"}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? <DamagePreviewPanel images={images} /> : null}
    </div>
  );
}
