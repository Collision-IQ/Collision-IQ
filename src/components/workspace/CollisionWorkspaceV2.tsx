"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
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
  ChevronUp,
  FileText,
  FolderCheck,

  HelpCircle,
  LayoutDashboard,
  Menu,
  ChevronsLeft,
  ChevronsRight,
  Settings as SettingsIcon,
  Workflow,
  X,
  Briefcase,
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
import ToolboxPanel from "@/components/workspace/ToolboxPanel";
import MyVehiclePanel from "@/components/workspace/MyVehiclePanel";
import ScanIqPanel from "@/components/workspace/ScanIqPanel";
import { MembershipPopup } from "@/components/MembershipPopup";
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
  | "scaniq"
  | "toolbox";

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
  // Paid pay-per-report flow, deliberately a separate route (not a workspace
  // view): it has its own payment gate and must stay usable without an
  // analysis session.
  { id: "dvgenerator", label: "Value IQ (ACV + DV)", icon: FileText, href: "/diminished-value" },
  { id: "history", label: "History", icon: BookOpen, view: "reports" },
  // Toolbox = saved CHATS, deliberately kept, reopenable with their files.
  // History above it is saved ANALYSES. Adjacent because both are "things I
  // came back for", distinct because one is a conversation and one is a report.
  { id: "toolbox", label: "Toolbox", icon: Briefcase, view: "toolbox" },
  { id: "knowledge", label: "Knowledge Base", icon: BookOpen, href: "/how-it-works" },
];

/** Pinned to the bottom of the rail beside Tutorial: account-level, not workflow. */
const NAV_FOOTER_ITEMS: typeof NAV_ITEMS = [
  { id: "settings", label: "Settings", icon: SettingsIcon, href: "/account" },
];

const NAV_TOUR_TARGETS: Record<string, string> = {
  workspace: "nav-analysis-workspace",
  reports: "nav-reports",
  evidence: "nav-evidence",
  vehicle: "nav-my-vehicle",
  scaniq: "nav-scan-iq",
  dvgenerator: "nav-dv-generator",
  history: "nav-history",
  toolbox: "nav-toolbox",
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
  reviewProgress,
  analysisStatus,
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

  // Chat-first rails: collapsed by default so the chat fills the space, and
  // EDGE-TRIGGERED autos — every new upload event opens the bottom rail, and
  // every review completion opens the side rails, even if the user closed
  // them earlier. A manual close simply holds until the next workflow event;
  // a manual open is immediate. Last state persists across sessions.
  const RAIL_STATE_STORAGE_KEY = "collisionIq.workspaceRails.v2";
  const [railsOpen, setRailsOpen] = useState<{ left: boolean; right: boolean; bottom: boolean }>({
    left: false,
    right: false,
    bottom: false,
  });
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RAIL_STATE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<"left" | "right" | "bottom", boolean>>;
      setRailsOpen((current) => ({
        left: typeof parsed.left === "boolean" ? parsed.left : current.left,
        right: typeof parsed.right === "boolean" ? parsed.right : current.right,
        bottom: typeof parsed.bottom === "boolean" ? parsed.bottom : current.bottom,
      }));
    } catch {
      // Preferences are a convenience; never block the workspace on them.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const applyRails = (updates: Partial<Record<"left" | "right" | "bottom", boolean>>) => {
    setRailsOpen((current) => {
      const next = { ...current, ...updates };
      try {
        window.localStorage.setItem(RAIL_STATE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage failures (private mode).
      }
      return next;
    });
  };
  // Edge triggers: fire on the TRANSITION, not the standing condition, so a
  // user's manual close is respected until the workflow genuinely advances.
  const uploadedCount = reviewProgress?.uploaded ?? 0;
  const knownFileCount = reviewProgress?.totalKnownFiles ?? 0;
  const reviewComplete = analysisStatus === "complete";
  const prevUploadSignalRef = useRef(0);
  useEffect(() => {
    const signal = Math.max(uploadedCount, knownFileCount);
    if (signal > prevUploadSignalRef.current) {
      applyRails({ bottom: true });
    }
    prevUploadSignalRef.current = signal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedCount, knownFileCount]);
  const prevReviewCompleteRef = useRef(false);
  useEffect(() => {
    if (reviewComplete && !prevReviewCompleteRef.current) {
      applyRails({ left: true, right: true });
    }
    prevReviewCompleteRef.current = reviewComplete;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewComplete]);
  // The tutorial highlights rail targets — open them while it runs so its
  // anchors exist.
  useEffect(() => {
    const handleTourOpen = () => applyRails({ left: true, right: true, bottom: true });
    window.addEventListener("collisioniq:tutorial:starting", handleTourOpen);
    window.addEventListener("collisioniq:tutorial:start", handleTourOpen);
    return () => {
      window.removeEventListener("collisioniq:tutorial:starting", handleTourOpen);
      window.removeEventListener("collisioniq:tutorial:start", handleTourOpen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const leftRailOpen = railsOpen.left;
  const rightRailOpen = railsOpen.right;
  const bottomRailOpen = railsOpen.bottom;

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
            <div className="mt-auto flex flex-col gap-1">
              {NAV_FOOTER_ITEMS.map((item) => renderNavItem(item, () => setMobileNavOpen(false)))}
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  restartOnboardingTour();
                }}
                className="inline-flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
              >
                <HelpCircle size={16} />
                Tutorial
              </button>
            </div>
          </nav>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Sidebar (lg+) — collapsible so the chat can take the full width. */}
        {leftRailOpen ? (
          <nav
            className="hidden w-52 shrink-0 flex-col gap-1 border-r border-border bg-card/60 p-2 lg:flex"
            data-tour="command-center-sidebar"
          >
            <button
              type="button"
              onClick={() => applyRails({ left: false })}
              className="mb-1 inline-flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
              aria-label="Collapse menu"
            >
              <ChevronsLeft size={16} />
              Collapse
            </button>
            {NAV_ITEMS.map((item) => renderNavItem(item))}
            <div className="mt-auto flex flex-col gap-1">
              <MembershipPopup />
              {NAV_FOOTER_ITEMS.map((item) => renderNavItem(item))}
              <button
                type="button"
                onClick={restartOnboardingTour}
                className="inline-flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
              >
                <HelpCircle size={16} />
                Tutorial
              </button>
            </div>
          </nav>
        ) : (
          // Entire collapsed strip is the click target — the chevron is the
          // hint, not the only hot zone.
          <button
            type="button"
            onClick={() => applyRails({ left: true })}
            className="hidden w-8 shrink-0 flex-col items-center gap-2 border-r border-[var(--accent)]/30 bg-[var(--accent)]/8 py-3 text-muted-foreground transition hover:bg-[var(--accent)]/15 hover:text-foreground lg:flex"
            aria-label="Open menu"
            title="Open menu"
          >
            <ChevronsRight size={17} className="text-[var(--accent)]" />
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{ writingMode: "vertical-rl" }}
            >
              Menu
            </span>
          </button>
        )}

        {/* Main + rail + bottom panels */}
        <main data-tour="report-workspace" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 sm:p-3">
          <div className="flex items-center gap-2 px-1">
            <Workflow size={16} className="text-[var(--accent)]" />
            <h1 className="text-[15px] font-semibold text-foreground">
              {activeView === "toolbox"
                ? "Toolbox"
                : activeView === "reports"
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
              activeView === "reportcenter"
                ? ""
                : rightRailOpen
                  ? "lg:grid-cols-[minmax(0,1fr)_360px]"
                  : "lg:grid-cols-[minmax(0,1fr)_auto]"
            }`}
            // The chat's centered column reads this: rails open -> condensed
            // reading column; rails closed -> the freed width goes INTO the
            // conversation column, so the chat visibly expands/condenses with
            // the claim panel instead of pooling dead space on one side.
            style={{ "--workspace-chat-col": rightRailOpen ? "1080px" : "1280px" } as CSSProperties}
          >
            {activeView === "toolbox" ? (
              <ToolboxPanel />
            ) : activeView === "reports" ? (
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
            {activeView === "reportcenter" ? null : rightRailOpen ? (
              // The Reports tab IS the rail's report section at full width —
              // hiding the rail there avoids duplicate report cards.
              <aside className="ci-panel relative hidden min-h-0 flex-col overflow-y-auto p-3 lg:flex">
                <button
                  type="button"
                  onClick={() => applyRails({ right: false })}
                  className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                  aria-label="Collapse claim panel"
                  title="Collapse claim panel"
                >
                  <ChevronsRight size={15} />
                </button>
                {right}
              </aside>
            ) : (
              // Entire collapsed strip is the click target — full height so
              // the rail is discoverable anywhere along the right edge.
              <button
                type="button"
                onClick={() => applyRails({ right: true })}
                className="hidden w-8 min-h-0 flex-col items-center gap-2 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/8 py-3 text-muted-foreground transition hover:bg-[var(--accent)]/15 hover:text-foreground lg:flex"
                aria-label="Open claim panel"
                title="Open claim panel"
              >
                <ChevronsLeft size={17} className="text-[var(--accent)]" />
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.18em]"
                  style={{ writingMode: "vertical-rl" }}
                >
                  Claim Panel
                </span>
              </button>
            )}
          </div>

          {activeView === "workspace" ? (
            <>
              {/* Tablet / desktop: collapsible insight rail — collapsed the
                  chat keeps the space; it auto-opens once files upload. */}
              <div className="hidden shrink-0 md:block">
                <button
                  type="button"
                  onClick={() => applyRails({ bottom: !bottomRailOpen })}
                  className="mb-2 inline-flex w-full items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-left transition hover:border-[var(--accent)]/45"
                  aria-expanded={bottomRailOpen}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Case Activity · Analysis Insights · Damage Preview
                  </span>
                  {bottomRailOpen ? (
                    <ChevronDown size={15} className="text-muted-foreground" />
                  ) : (
                    <ChevronUp size={15} className="text-muted-foreground" />
                  )}
                </button>
                {bottomRailOpen ? (
                  <div className="grid grid-cols-3 gap-3">
                    <CaseActivityPanel events={caseEvents} />
                    <AnalysisInsightsPanel riskScore={riskScore} confidence={confidence} />
                    <div data-tour="damage-preview">
                      <DamagePreviewPanel images={damageImages} />
                    </div>
                  </div>
                ) : null}
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
