import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { canUseProIntegrations, PRO_FEATURE_REQUIRED_MESSAGE } from "@/lib/billing/proFeatures";
import { buildEmsExport, isRekeyEmsWriterEnabled } from "@/lib/rekey/emsWriter";
import type { RekeySheet } from "@/lib/rekey/rekeyTypes";

/**
 * The EMS export of a rekey sheet (Pro, and behind a flag).
 *
 * Takes the sheet the build already produced and writes it as a CIECA EMS
 * v2.01 export, which is the one format a receiving estimating system imports
 * from a folder. It pre-populates; it does not rekey — every line arrives as a
 * manually entered line, and the notes returned here say so. See
 * `docs/ccc-writeback-scope.md`.
 *
 * No workfile copy is produced (WO-RK1 §1).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A file stem is 8 characters in an EMS export, and it names files on the
 *  estimator's disk: nothing but letters and digits goes into one. */
function safeStem(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/[^A-Za-z0-9]/g, "") : "";
  return (text || `rk${Date.now().toString(36)}`).slice(0, 8).toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    if (!isRekeyEmsWriterEnabled()) {
      return NextResponse.json({ error: "The EMS export is not enabled." }, { status: 503 });
    }
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements({ isPlatformAdmin });
    if (!canUseProIntegrations(entitlements)) {
      return NextResponse.json({ error: PRO_FEATURE_REQUIRED_MESSAGE }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as {
      sheet?: RekeySheet;
      stem?: unknown;
      estimatingSystem?: unknown;
    } | null;
    const sheet = body?.sheet;
    if (!sheet || !Array.isArray(sheet.rows) || sheet.rows.length === 0) {
      return NextResponse.json({ error: "A rekey sheet is required to build an EMS export." }, { status: 400 });
    }

    const stem = safeStem(body?.stem);
    const estimatingSystem =
      typeof body?.estimatingSystem === "string" && /^[A-Za-z]$/.test(body.estimatingSystem.trim())
        ? body.estimatingSystem.trim().toUpperCase()
        : (process.env.REKEY_EMS_WRITER_SYSTEM_CODE ?? null);

    const written = buildEmsExport({ sheet, stem, estimatingSystem });
    const zip = new JSZip();
    for (const file of written.files) zip.file(file.filename, file.bytes);
    const archive = await zip.generateAsync({ type: "nodebuffer" });

    // Metadata-only logging: counts, never estimate content.
    console.info("[rekey] ems export built", {
      userId: user.id,
      tables: written.files.length,
      lines: written.lineCount,
      identified: Boolean(estimatingSystem),
    });

    return NextResponse.json(
      {
        filename: `${stem}-ems.zip`,
        zipBase64: archive.toString("base64"),
        tables: written.files.map((file) => file.filename),
        lineCount: written.lineCount,
        notes: written.notes,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[rekey] ems export failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "The EMS export could not be built." }, { status: 500 });
  }
}
