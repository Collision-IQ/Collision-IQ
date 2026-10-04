/**
 * The case a report card builds from. Reports are built from the case the
 * full case analysis creates. Asked for before there is one (Quick answer
 * mode, or a case analysis still running), a report waits for it, and starts
 * the analysis when none is running, instead of failing in the browser with
 * "needs an active case" and never reaching the server.
 */

export type AnalysisLifecycle = "idle" | "processing" | "complete" | "error";

export type CaseForReports = { caseId: string } | { reason: string };

/** Use the case, wait for the analysis running now, or start one. */
export function planCaseForReports(state: { caseId: string | null; status: AnalysisLifecycle }): "ready" | "wait" | "start" {
  // A running analysis may be merging new estimates into the case: the
  // report waits for it rather than building from what it replaces.
  if (state.status === "processing") return "wait";
  return state.caseId ? "ready" : "start";
}

/** Why a case analysis could not be started for a report. */
export function caseStartFailureReason(start: "busy" | "no_uploads" | "unavailable"): string {
  if (start === "no_uploads") {
    return "The reports are built from the case analysis of your estimates. Upload the estimates to compare, then run the report.";
  }
  if (start === "busy") {
    return "The chat is still working on your last message or upload. Run the report again when it finishes, and the case analysis will start first.";
  }
  return "The case analysis could not be started from here. Turn on Researched Answer and send your estimates, then run the report.";
}

export const CASE_ANALYSIS_NOT_FINISHED =
  "The case analysis did not finish, so no report was built. The chat says what went wrong; run the report again once it is resolved.";

export const CASE_ANALYSIS_TIMED_OUT =
  "The case analysis is still running after 10 minutes. Run the report again when it finishes.";

/** How long a report waits for the case analysis before it says so. */
export const CASE_ANALYSIS_WAIT_MS = 10 * 60 * 1000;

/**
 * Reports waiting for the case analysis to end. Each waiter settles once:
 * with the case id when the analysis completes, null when it fails or the
 * session resets, "timeout" when it outlasts the wait.
 */
export function createCaseWaiters() {
  let waiters: Array<(caseId: string | null) => void> = [];
  return {
    wait(timeoutMs: number): { promise: Promise<string | null | "timeout">; cancel: () => void } {
      let resolver: ((caseId: string | null) => void) | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const promise = new Promise<string | null | "timeout">((resolve) => {
        resolver = (caseId) => {
          clearTimeout(timer);
          resolve(caseId);
        };
        waiters.push(resolver);
        timer = setTimeout(() => {
          waiters = waiters.filter((waiter) => waiter !== resolver);
          resolve("timeout");
        }, timeoutMs);
      });
      return {
        promise,
        cancel: () => {
          clearTimeout(timer);
          waiters = waiters.filter((waiter) => waiter !== resolver);
        },
      };
    },
    settle(caseId: string | null) {
      const pending = waiters;
      waiters = [];
      pending.forEach((resolve) => resolve(caseId));
    },
    get pending() {
      return waiters.length;
    },
  };
}

export type CaseAnalysisStart = "started" | "busy" | "no_uploads" | "unavailable";

/**
 * The page's coordinator between the report cards and the case analysis.
 * The chat reports the case id and the analysis lifecycle into it; a report
 * calls ensure(), which resolves with the case to build from, or the reason
 * there is none. A waiter is registered before the analysis is started, so
 * an analysis that ends at once is never missed. Until the chat hands over
 * how to start an analysis, a report that needs one says it cannot start.
 */
export function createCaseForReports() {
  const waiters = createCaseWaiters();
  let caseId: string | null = null;
  let status: AnalysisLifecycle = "idle";
  // How to start the case analysis: handed over once the chat is ready.
  let start: () => CaseAnalysisStart = () => "unavailable";
  return {
    setStart(next: () => CaseAnalysisStart) {
      start = next;
    },
    setCaseId(next: string | null) {
      caseId = next;
    },
    setStatus(next: AnalysisLifecycle) {
      const previous = status;
      status = next;
      if (next === "complete") waiters.settle(caseId);
      else if (next === "error") waiters.settle(null);
      // "idle" ends a running analysis only when the session resets during
      // it. A new case's analysis clears the workspace to "idle" on its way
      // to "processing": that is the start the report is waiting for.
      else if (next === "idle" && previous === "processing") waiters.settle(null);
    },
    async ensure(timeoutMs = CASE_ANALYSIS_WAIT_MS): Promise<CaseForReports> {
      const plan = planCaseForReports({ caseId, status });
      if (plan === "ready" && caseId) return { caseId };
      const waiting = waiters.wait(timeoutMs);
      if (plan === "start") {
        const started = start();
        if (started !== "started") {
          waiting.cancel();
          return { reason: caseStartFailureReason(started) };
        }
      }
      const settled = await waiting.promise;
      if (settled === "timeout") return { reason: CASE_ANALYSIS_TIMED_OUT };
      return settled ? { caseId: settled } : { reason: CASE_ANALYSIS_NOT_FINISHED };
    },
    get pendingReports() {
      return waiters.pending;
    },
  };
}
