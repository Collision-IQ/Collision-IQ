import type { ProductPlan } from "@/lib/featureAccess";

export type CrmEventName =
  | "snapshot_created"
  | "snapshot_downloaded"
  | "snapshot_copied"
  | "snapshot_sent_customer"
  | "snapshot_sent_carrier"
  | "report_sent"
  | "report_generated"
  | "upload_batch_completed";

export type SafeCrmEventPayload = {
  event: CrmEventName;
  plan?: ProductPlan | string | null;
  source?: "client" | "server";
  destinationType?: "customer" | "carrier" | "internal";
  fileCount?: number;
  totalFilesReviewed?: number;
  adjustedConfidence?: string;
  completenessStatus?: string;
  topDisputeCount?: number;
  uploadLimitReached?: boolean;
  userIndicatedMoreFiles?: boolean;
  exportType?:
    | "snapshot"
    | "customer_report"
    | "repair_intelligence"
    | "estimate_scrubber"
    | "estimator_change_request_list"
    | "policy_rights_review"
    | "doi_complaint_packet";
  caseId?: string | null;
  reportType?: string | null;
  recipient?: string | null;
  sentAt?: string | null;
  resendId?: string | null;
  reportSendId?: string | null;
};

export function emitSafeCrmEventFromClient(payload: SafeCrmEventPayload): void {
  const safePayload = sanitizeCrmPayload({ ...payload, source: "client" });

  void fetch("/api/crm/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(safePayload),
  }).catch((error) => {
    console.warn("[crm:event:client_failed]", {
      event: safePayload.event,
      message: error instanceof Error ? error.message : "Unknown CRM event error",
    });
  });
}

export function sanitizeCrmPayload(payload: SafeCrmEventPayload): SafeCrmEventPayload {
  return {
    event: payload.event,
    plan: payload.plan ?? null,
    source: payload.source,
    destinationType: payload.destinationType,
    fileCount: finiteNumber(payload.fileCount),
    totalFilesReviewed: finiteNumber(payload.totalFilesReviewed),
    adjustedConfidence: payload.adjustedConfidence,
    completenessStatus: payload.completenessStatus,
    topDisputeCount: finiteNumber(payload.topDisputeCount),
    uploadLimitReached: payload.uploadLimitReached,
    userIndicatedMoreFiles: payload.userIndicatedMoreFiles,
    exportType: payload.exportType,
    caseId: payload.caseId ?? null,
    reportType: payload.reportType ?? null,
    recipient: payload.recipient ?? null,
    sentAt: payload.sentAt ?? null,
    resendId: payload.resendId ?? null,
    reportSendId: payload.reportSendId ?? null,
  };
}

function finiteNumber(value?: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
