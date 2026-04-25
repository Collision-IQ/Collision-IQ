import { canAccessFeature, type ProductPlan } from "@/lib/featureAccess";

export type CrmEventName =
  | "snapshot_created"
  | "snapshot_downloaded"
  | "snapshot_copied"
  | "snapshot_sent_customer"
  | "snapshot_sent_carrier"
  | "report_generated"
  | "upload_batch_completed";

export type SafeCrmEventPayload = {
  event: CrmEventName;
  plan?: ProductPlan | string | null;
  source?: "client" | "server";
  destinationType?: "customer" | "carrier";
  fileCount?: number;
  totalFilesReviewed?: number;
  adjustedConfidence?: string;
  completenessStatus?: string;
  topDisputeCount?: number;
  uploadLimitReached?: boolean;
  userIndicatedMoreFiles?: boolean;
  exportType?: "snapshot" | "full_report" | "dispute_report" | "rebuttal" | "customer_report";
};

export async function emitSafeCrmEvent(payload: SafeCrmEventPayload): Promise<void> {
  const safePayload = sanitizeCrmPayload(payload);

  if (!canAccessFeature(safePayload.plan, "crm_sync")) {
    console.info("[crm:event:skipped]", {
      event: safePayload.event,
      reason: "plan_not_enabled",
      plan: safePayload.plan ?? null,
    });
    return;
  }

  if (!process.env.HUBSPOT_PRIVATE_APP_TOKEN) {
    console.info("[crm:event:skipped]", {
      event: safePayload.event,
      reason: "hubspot_not_configured",
    });
    return;
  }

  try {
    await sendHubSpotTimelineStub(safePayload);
  } catch (error) {
    console.warn("[crm:event:hubspot_failed]", {
      event: safePayload.event,
      message: error instanceof Error ? error.message : "Unknown HubSpot error",
    });
  }
}

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
  };
}

async function sendHubSpotTimelineStub(payload: SafeCrmEventPayload): Promise<void> {
  // Stub for later HubSpot timeline-note mapping. Keep non-blocking and PII-free.
  console.info("[crm:event:hubspot_stub]", {
    event: payload.event,
    exportType: payload.exportType ?? null,
    destinationType: payload.destinationType ?? null,
  });
}

function finiteNumber(value?: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
