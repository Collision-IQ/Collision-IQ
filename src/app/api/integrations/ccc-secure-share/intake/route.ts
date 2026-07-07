import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { canUseProIntegrations, PRO_FEATURE_REQUIRED_MESSAGE } from "@/lib/billing/proFeatures";
import {
  getCccSecureSharePreviewEvent,
  listCccSecureSharePreviewEvents,
} from "@/lib/ccc/secureSharePreview";
import {
  buildCccImportHistoryReport,
  buildCccSecureShareImport,
  isCccSecureSharePipelineEnabled,
} from "@/lib/integrations/ccc/cccSecureShareIntake";
import { saveAnalysisReport } from "@/lib/analysisReportStore";

// CCC Secure Share Import (Pro-only). Reads the already-received, sanitized
// Secure Share events and imports them as reviewable Collision IQ cases.
// No CCC write-back, no scraping, no credentials, metadata-only logging.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Gate =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

async function gateProAccess(): Promise<Gate> {
  if (!isCccSecureSharePipelineEnabled()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "CCC Secure Share import is not enabled." },
        { status: 503 }
      ),
    };
  }

  const { user, isPlatformAdmin } = await requireCurrentUser();
  const entitlements = await getCurrentEntitlements({ isPlatformAdmin });
  if (!canUseProIntegrations(entitlements)) {
    return {
      ok: false,
      response: NextResponse.json({ error: PRO_FEATURE_REQUIRED_MESSAGE }, { status: 403 }),
    };
  }

  return { ok: true, userId: user.id };
}

/** List recent importable (normalized) CCC Secure Share events. */
export async function GET() {
  try {
    const gate = await gateProAccess();
    if (!gate.ok) return gate.response;

    const events = await listCccSecureSharePreviewEvents({ limit: 25 });
    const importable = events.filter(
      (event) =>
        event.normalizationStatus === "normalized" ||
        event.normalizationStatus === "normalized_with_warnings"
    );

    return NextResponse.json(
      { events: importable },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return handleError(error, "list");
  }
}

/** Import one event into the user's report history as a reviewable case. */
export async function POST(request: NextRequest) {
  try {
    const gate = await gateProAccess();
    if (!gate.ok) return gate.response;

    const body = (await request.json().catch(() => null)) as { eventId?: unknown } | null;
    const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
    if (!eventId) {
      return NextResponse.json({ error: "An eventId is required." }, { status: 400 });
    }

    const detail = await getCccSecureSharePreviewEvent(eventId);
    if (!detail) {
      return NextResponse.json({ error: "CCC Secure Share event not found." }, { status: 404 });
    }

    const imported = buildCccSecureShareImport(detail);
    const report = buildCccImportHistoryReport(imported);
    const saved = await saveAnalysisReport({
      ownerUserId: gate.userId,
      artifactIds: [],
      report,
    });

    // Metadata-only log (never full payloads).
    console.info("[ccc-secure-share-intake] imported", {
      eventId,
      reportId: saved.id,
      lineCount: imported.estimate.lineCount,
      photosAvailable: imported.attachments.photosAvailable,
      jurisdiction: imported.jurisdiction.stateCode,
    });

    return NextResponse.json(
      {
        reportId: saved.id,
        import: {
          sourceSystem: imported.sourceSystem,
          sourceApplication: imported.sourceApplication,
          externalWorkfileId: imported.externalWorkfileId,
          estimateVersion: imported.estimateVersion,
          supplementNumber: imported.supplementNumber,
          receivedAt: imported.receivedAt,
          vehicle: imported.vehicle,
          lineCount: imported.estimate.lineCount,
          attachments: imported.attachments,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return handleError(error, "import");
  }
}

function handleError(error: unknown, action: string) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`[ccc-secure-share-intake] ${action} failed`, {
    message: error instanceof Error ? error.message : "Unknown error",
  });
  return NextResponse.json({ error: `Could not ${action} from CCC Secure Share.` }, { status: 500 });
}
