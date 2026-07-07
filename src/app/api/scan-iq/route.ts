import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { canUseProIntegrations, PRO_FEATURE_REQUIRED_MESSAGE } from "@/lib/billing/proFeatures";
import { extractPreviewDataFromBuffer } from "@/lib/attachments/extractPreviewData";
import { getUploadedAttachments, saveUploadedAttachment } from "@/lib/uploadedAttachmentStore";
import { saveAnalysisReport } from "@/lib/analysisReportStore";
import { parseScanReport } from "@/lib/scans/scanParser";
import { compareScans } from "@/lib/scans/scanComparator";
import { buildScanIqHistoryReport, buildScanIqReportText } from "@/lib/scans/scanReportBuilder";
import { lookupMotorDtcs } from "@/lib/vendor/motor/motorDtcLookup";
import type { ParsedScanReport, ScanIqComparison, ScanSide } from "@/lib/scans/scanTypes";

// Scan IQ (Pro-only): pre/post diagnostic-scan comparison with optional MOTOR
// DaaS DTC enrichment. Reuses the app's existing extraction pipeline (PDF text
// + OCR fallback, TXT/CSV/DOCX) — no new file-type surface, no weakened upload
// rules. MOTOR failures never fail the scan report.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_SCAN_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_SCAN_MIME = /^(application\/pdf|text\/(?:plain|csv)|application\/csv|image\/(?:png|jpe?g|webp|heic|heif))$/i;

function isScanIqEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SCAN_IQ_ENABLED === "true";
}

type ScanSideInput = {
  attachmentId?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  dataUrl?: unknown;
};

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;
  try {
    return Buffer.from(dataUrl.slice(comma + 1), "base64");
  } catch {
    return null;
  }
}

async function resolveScanSide(params: {
  input: ScanSideInput | undefined;
  side: ScanSide;
  userId: string;
}): Promise<
  | { ok: true; parsed: ParsedScanReport; attachmentId: string | null }
  | { ok: false; error: string; status: number }
> {
  const input = params.input;
  const label = params.side === "pre" ? "pre-scan" : "post-scan";
  if (!input || typeof input !== "object") {
    return { ok: false, error: `A ${label} file is required.`, status: 400 };
  }

  // Path 1: already-uploaded attachment (chat upload pipeline).
  if (typeof input.attachmentId === "string" && input.attachmentId.trim()) {
    const [attachment] = await getUploadedAttachments([input.attachmentId.trim()], {
      ownerUserId: params.userId,
    });
    if (!attachment) {
      return { ok: false, error: `The ${label} attachment was not found.`, status: 404 };
    }
    return {
      ok: true,
      attachmentId: attachment.id,
      parsed: parseScanReport({
        text: attachment.text,
        sourceFile: attachment.filename,
        side: params.side,
      }),
    };
  }

  // Path 2: direct file payload — extracted with the app's existing pipeline
  // and stored as a normal attachment so the source file is preserved.
  const filename = typeof input.filename === "string" && input.filename.trim() ? input.filename.trim() : `${label}.pdf`;
  const mimeType = typeof input.mimeType === "string" ? input.mimeType.trim() : "";
  const dataUrl = typeof input.dataUrl === "string" ? input.dataUrl : "";

  if (!dataUrl) {
    return { ok: false, error: `A ${label} file is required.`, status: 400 };
  }
  if (!ALLOWED_SCAN_MIME.test(mimeType)) {
    return {
      ok: false,
      error: `Unsupported ${label} file type. Use PDF, TXT, CSV, or an image.`,
      status: 400,
    };
  }
  const buffer = dataUrlToBuffer(dataUrl);
  if (!buffer) {
    return { ok: false, error: `The ${label} file could not be decoded.`, status: 400 };
  }
  if (buffer.byteLength > MAX_SCAN_FILE_BYTES) {
    return { ok: false, error: `The ${label} file must be under 10 MB.`, status: 413 };
  }

  const extracted = await extractPreviewDataFromBuffer({ buffer, mimeType, filename }).catch(
    () => ({ text: "", pageCount: undefined as number | undefined })
  );

  // Preserve the uploaded file as a regular attachment regardless of parse
  // outcome — an unreadable scan must never delete or drop the user's file.
  const storedId = await saveUploadedAttachment({
    ownerUserId: params.userId,
    filename,
    type: mimeType,
    text: extracted.text ?? "",
    pageCount: extracted.pageCount,
    sizeBytes: buffer.byteLength,
    source: "direct_upload",
  })
    .then((stored) => stored.id)
    .catch(() => null);

  return {
    ok: true,
    attachmentId: storedId,
    parsed: parseScanReport({ text: extracted.text, sourceFile: filename, side: params.side }),
  };
}

async function enrichWithMotor(comparison: ScanIqComparison): Promise<void> {
  if (process.env.MOTOR_DAAS_DTC_ENABLED !== "true") return;
  try {
    const vehicle = {
      vin: comparison.post.vin ?? comparison.pre.vin,
      year: comparison.post.year ?? comparison.pre.year,
      make: comparison.post.make ?? comparison.pre.make,
      model: comparison.post.model ?? comparison.pre.model,
    };
    const codes = comparison.rows.map((row) => row.code.slice(0, 5));
    const batch = await lookupMotorDtcs({ vehicle, codes });
    for (const row of comparison.rows) {
      const result = batch.results.get(row.code.slice(0, 5).toUpperCase());
      if (!result) continue;
      row.motorLookupStatus = result.status === "not-configured" ? "not-configured" : result.status;
      row.motorSource = result.metadata;
      if (result.description) {
        row.normalizedDescription = result.description;
      }
    }
  } catch (error) {
    // MOTOR must never fail the scan report.
    console.warn("[scan-iq] MOTOR enrichment skipped", {
      reason: error instanceof Error ? error.name : "unknown",
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isScanIqEnabled()) {
      return NextResponse.json({ error: "Scan IQ is not enabled." }, { status: 503 });
    }

    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements({ isPlatformAdmin });
    if (!canUseProIntegrations(entitlements)) {
      return NextResponse.json({ error: PRO_FEATURE_REQUIRED_MESSAGE }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as {
      pre?: ScanSideInput;
      post?: ScanSideInput;
    } | null;

    const pre = await resolveScanSide({ input: body?.pre, side: "pre", userId: user.id });
    if (!pre.ok) return NextResponse.json({ error: pre.error }, { status: pre.status });
    const post = await resolveScanSide({ input: body?.post, side: "post", userId: user.id });
    if (!post.ok) return NextResponse.json({ error: post.error }, { status: post.status });

    if (pre.parsed.unreadable && post.parsed.unreadable) {
      // Files are already stored as attachments — nothing is deleted.
      return NextResponse.json(
        {
          error:
            "Neither scan file contained readable scan text. The files were kept — try a text or PDF export from the scan tool.",
        },
        { status: 422 }
      );
    }

    const comparison = compareScans(pre.parsed, post.parsed);
    await enrichWithMotor(comparison);

    const text = buildScanIqReportText(comparison);
    const report = buildScanIqHistoryReport(comparison, text);
    const saved = await saveAnalysisReport({
      ownerUserId: user.id,
      artifactIds: [pre.attachmentId, post.attachmentId].filter((id): id is string => Boolean(id)),
      report,
    });

    // Metadata-only logging.
    console.info("[scan-iq] comparison complete", {
      reportId: saved.id,
      preDtcs: pre.parsed.dtcs.length,
      postDtcs: post.parsed.dtcs.length,
      cleared: comparison.summary.clearedCount,
      remaining: comparison.summary.remainingCount,
      newCodes: comparison.summary.newCount,
    });

    return NextResponse.json(
      {
        reportId: saved.id,
        summary: comparison.summary,
        customerSummary: text.customerSummary,
        technicalTable: text.technicalTable,
        motorStatusLine: text.motorStatusLine,
        rows: comparison.rows,
        pre: {
          sourceFile: comparison.pre.sourceFile,
          vin: comparison.pre.vin,
          scanDate: comparison.pre.scanDate,
          scannerVendor: comparison.pre.scannerVendor,
          dtcCount: comparison.pre.dtcs.length,
          warnings: comparison.pre.warnings,
        },
        post: {
          sourceFile: comparison.post.sourceFile,
          vin: comparison.post.vin,
          scanDate: comparison.post.scanDate,
          scannerVendor: comparison.post.scannerVendor,
          dtcCount: comparison.post.dtcs.length,
          warnings: comparison.post.warnings,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[scan-iq] failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Scan comparison failed. Your files were kept." }, { status: 500 });
  }
}
