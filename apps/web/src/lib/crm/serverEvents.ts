import { canAccessFeature } from "@/lib/featureAccess";
import { sanitizeCrmPayload, type SafeCrmEventPayload } from "@/lib/crm/events";

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

  try {
    await sendHubSpotTimelineStub(safePayload);
    if (safePayload.event === "report_sent") {
      await updateHubSpotReportLifecycleStub(safePayload);
    }
  } catch (error) {
    if (safePayload.event === "report_sent") {
      console.warn("[report_sent_crm_failed]", {
        reportType: safePayload.reportType ?? safePayload.exportType ?? null,
        reportSendId: safePayload.reportSendId ?? null,
        message: error instanceof Error ? error.message : "Unknown HubSpot error",
      });
    }
    console.warn("[crm:event:hubspot_failed]", {
      event: safePayload.event,
      message: error instanceof Error ? error.message : "Unknown HubSpot error",
    });
  }
}

async function sendHubSpotTimelineStub(payload: SafeCrmEventPayload): Promise<void> {
  // Stub for later HubSpot timeline-note mapping. Keep non-blocking and PII-free.
  console.info("[crm:event:hubspot_stub]", {
    event: payload.event,
    exportType: payload.exportType ?? null,
    caseId: payload.caseId ?? null,
    reportType: payload.reportType ?? null,
    destinationType: payload.destinationType ?? null,
    resendId: payload.resendId ?? null,
    reportSendId: payload.reportSendId ?? null,
  });
}

async function updateHubSpotReportLifecycleStub(payload: SafeCrmEventPayload): Promise<void> {
  if (payload.destinationType !== "carrier" && payload.destinationType !== "customer") {
    return;
  }

  console.info("[crm:event:hubspot_lifecycle_stub]", {
    caseId: payload.caseId ?? null,
    stage: payload.destinationType === "carrier" ? "Sent to Carrier" : "Sent to Customer",
    reportType: payload.reportType ?? payload.exportType ?? null,
    reportSendId: payload.reportSendId ?? null,
  });
}
