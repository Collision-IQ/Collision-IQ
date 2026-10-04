/**
 * A report card asked for before there is a case (Quick answer mode, or a
 * case analysis still running) waits for the case, starting the analysis when
 * none is running. Before, it stopped in the browser with "needs an active
 * case" and never reached the server (production, RO 21548: uploads and a
 * quick chat, no /api/analysis, no report request).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CASE_ANALYSIS_NOT_FINISHED,
  CASE_ANALYSIS_TIMED_OUT,
  caseStartFailureReason,
  createCaseForReports,
  planCaseForReports,
} from "../caseForReports";

describe("the case a report builds from", () => {
  it("uses the case, waits for a running analysis, or starts one", () => {
    expect(planCaseForReports({ caseId: "case-1", status: "complete" })).toBe("ready");
    expect(planCaseForReports({ caseId: "case-1", status: "idle" })).toBe("ready");
    // An analysis merging new estimates into the case is waited for.
    expect(planCaseForReports({ caseId: "case-1", status: "processing" })).toBe("wait");
    expect(planCaseForReports({ caseId: null, status: "processing" })).toBe("wait");
    expect(planCaseForReports({ caseId: null, status: "idle" })).toBe("start");
    expect(planCaseForReports({ caseId: null, status: "error" })).toBe("start");
  });

  it("with no case, starts the case analysis and builds from the case it creates", async () => {
    const coordinator = createCaseForReports();
    const start = vi.fn(() => {
      // As ChatWidget does, synchronously inside the send: a new case's run
      // clears the workspace (case null, "idle") and goes to "processing".
      coordinator.setCaseId(null);
      coordinator.setStatus("idle");
      coordinator.setStatus("processing");
      // Then the analysis answers: the case, then its completion.
      queueMicrotask(() => {
        coordinator.setCaseId("case-new");
        coordinator.setStatus("complete");
      });
      return "started" as const;
    });
    coordinator.setStart(start);
    await expect(coordinator.ensure()).resolves.toEqual({ caseId: "case-new" });
    expect(start).toHaveBeenCalledTimes(1);
    expect(coordinator.pendingReports).toBe(0);
  });

  it("never misses an analysis that ends before the report starts waiting", async () => {
    const coordinator = createCaseForReports();
    coordinator.setStart(() => {
      coordinator.setCaseId("case-fast");
      coordinator.setStatus("complete");
      return "started";
    });
    await expect(coordinator.ensure()).resolves.toEqual({ caseId: "case-fast" });
  });

  it("joins an analysis already running instead of starting another", async () => {
    const coordinator = createCaseForReports();
    const start = vi.fn(() => "started" as const);
    coordinator.setStart(start);
    coordinator.setStatus("processing");
    const report = coordinator.ensure();
    const email = coordinator.ensure();
    coordinator.setCaseId("case-1");
    coordinator.setStatus("complete");
    await expect(Promise.all([report, email])).resolves.toEqual([{ caseId: "case-1" }, { caseId: "case-1" }]);
    expect(start).not.toHaveBeenCalled();
  });

  it("an open case is used at once", async () => {
    const coordinator = createCaseForReports();
    const start = vi.fn(() => "started" as const);
    coordinator.setStart(start);
    coordinator.setCaseId("case-open");
    coordinator.setStatus("complete");
    await expect(coordinator.ensure()).resolves.toEqual({ caseId: "case-open" });
    expect(start).not.toHaveBeenCalled();
  });

  it("says why there is no report when the analysis fails, the session resets or it cannot start", async () => {
    // The analysis fails, or the session resets ("idle") while it runs.
    for (const end of ["error", "idle"] as const) {
      const coordinator = createCaseForReports();
      coordinator.setStart(() => {
        coordinator.setStatus("idle");
        coordinator.setStatus("processing");
        queueMicrotask(() => coordinator.setStatus(end));
        return "started";
      });
      await expect(coordinator.ensure()).resolves.toEqual({ reason: CASE_ANALYSIS_NOT_FINISHED });
    }
    for (const refusal of ["busy", "no_uploads", "unavailable"] as const) {
      const coordinator = createCaseForReports();
      coordinator.setStart(() => refusal);
      await expect(coordinator.ensure()).resolves.toEqual({ reason: caseStartFailureReason(refusal) });
      expect(coordinator.pendingReports).toBe(0);
    }
    // Before the chat hands over how to start one.
    await expect(createCaseForReports().ensure()).resolves.toEqual({ reason: caseStartFailureReason("unavailable") });
  });

  it("says so when the analysis outlasts the wait", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = createCaseForReports();
      coordinator.setStart(() => "started");
      const report = coordinator.ensure(1000);
      await vi.advanceTimersByTimeAsync(1001);
      await expect(report).resolves.toEqual({ reason: CASE_ANALYSIS_TIMED_OUT });
      expect(coordinator.pendingReports).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the report card and the chat are wired to it", () => {
  const read = (file: string) => readFileSync(path.join(__dirname, "../../../components", file), "utf8");
  const page = read("ChatbotPage.tsx");
  const chat = read("ChatWidget.tsx");

  it("the download and email paths resolve the case before generating, and generate with it", () => {
    const download = page.slice(page.indexOf("async function downloadReportDocument("), page.indexOf('if (reportType === "oem_citation_density")'));
    expect(download.indexOf("await resolveCaseForReports()")).toBeGreaterThan(-1);
    expect(download.indexOf("await resolveCaseForReports()")).toBeLessThan(download.indexOf("generateAnnotatedCitationDensityEstimate("));
    expect(download).toContain("generateAnnotatedCitationDensityEstimate(options.comparisonDocumentId, caseForReports.caseId)");
    expect(download).toContain("generateForensicEstimateReview(caseForReports.caseId)");
    const email = page.slice(page.indexOf("async function sendReportEmail("));
    expect(email.indexOf("await resolveCaseForReports()")).toBeLessThan(email.indexOf("generateAnnotatedCitationDensityEstimate("));
    // The chat reports the case and the analysis lifecycle into the coordinator.
    expect(page).toContain("caseForReports.setCaseId(reportId)");
    expect(page).toContain("caseForReports.setStatus(status)");
    expect(page).toContain("caseForReports.setStart(controls.runCaseAnalysis)");
  });

  it("the chat runs the case pipeline when a report card asks, whatever the Researched Answer toggle says", () => {
    expect(chat).toMatch(/researchModeEffective \|\| options\.forceCaseAnalysis === true/);
    expect(chat).toContain('void handleSend(CASE_ANALYSIS_FOR_REPORTS_PROMPT, { forceCaseAnalysis: true })');
    expect(chat).toContain("runCaseAnalysis: () => startCaseAnalysisRef.current()");
  });

  it("a new case's run clears to idle before processing, the order the coordinator is tested with", () => {
    const begin = chat.slice(chat.indexOf("function beginStructuredAnalysisRun("), chat.indexOf("return runId;", chat.indexOf("function beginStructuredAnalysisRun(")));
    expect(begin.indexOf("clearStructuredAnalysisState()")).toBeGreaterThan(-1);
    expect(begin.indexOf("clearStructuredAnalysisState()")).toBeLessThan(begin.indexOf('onAnalysisStatusChange?.("processing"'));
    const clear = chat.slice(chat.indexOf("const clearStructuredAnalysisState = useCallback("), chat.indexOf("}, [", chat.indexOf("const clearStructuredAnalysisState = useCallback(")));
    expect(clear).toContain('onAnalysisStatusChange?.("idle", null)');
  });
});
