import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { canUseProIntegrations, PRO_FEATURE_REQUIRED_MESSAGE } from "@/lib/billing/proFeatures";
import { extractPreviewDataFromBuffer } from "@/lib/attachments/extractPreviewData";
import { getUploadedAttachments, saveUploadedAttachment } from "@/lib/uploadedAttachmentStore";
import { saveAnalysisReport } from "@/lib/analysisReportStore";
import { assessRekeySheet, buildRekeySheet } from "@/lib/rekey/rekeyLedger";
import { readEmsBundle } from "@/lib/rekey/emsReader";
import {
  explainDocumentIsNotVerification,
  keyedEstimateFromEms,
  verifyRekey,
  type RekeyVerification,
} from "@/lib/rekey/rekeyVerification";
import {
  buildRekeyHistoryReport,
  buildRekeySheetText,
  buildRekeyVerificationText,
} from "@/lib/rekey/rekeyReportBuilder";

/**
 * Rekey Sheet + verification (Pro-only).
 *
 * Upload 1 is the estimate that must be rekeyed — it produces the keying
 * sheet. Upload 2 is optional: the shop's estimate (or an EMS export of it)
 * that was, or is being, keyed to match upload 1; supplying it adds the
 * verification pass.
 *
 * Reuses the app's existing extraction pipeline and attachment store — no new
 * file-type surface, and the uploaded files are preserved whatever the parse
 * outcome.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_DOCUMENT_MIME =
  /^(application\/pdf|text\/(?:plain|csv)|application\/csv|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|image\/(?:png|jpe?g|webp|heic|heif))$/i;
const ZIP_MIME = /^(application\/(?:zip|x-zip-compressed|octet-stream))$/i;
/** Archive entries that are not EMS tables. */
const EMS_SKIP_ENTRY = /(?:^|\/)(?:__MACOSX\/|\.)/;

type FileInput = {
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

function looksLikeZip(filename: string, mimeType: string, buffer: Buffer): boolean {
  if (/\.zip$/i.test(filename)) return true;
  if (!ZIP_MIME.test(mimeType)) return false;
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

type ResolvedFile =
  | { ok: true; kind: "document"; filename: string; text: string; attachmentId: string | null }
  | { ok: true; kind: "ems"; filename: string; buffer: Buffer; attachmentId: string | null }
  | { ok: false; error: string; status: number };

async function resolveFile(params: {
  input: FileInput | undefined;
  label: string;
  userId: string;
  allowEms: boolean;
}): Promise<ResolvedFile> {
  const { input, label, userId, allowEms } = params;
  if (!input || typeof input !== "object") {
    return { ok: false, error: `A ${label} file is required.`, status: 400 };
  }

  // Path 1: a file already uploaded through the chat pipeline.
  if (typeof input.attachmentId === "string" && input.attachmentId.trim()) {
    const [attachment] = await getUploadedAttachments([input.attachmentId.trim()], { ownerUserId: userId });
    if (!attachment) return { ok: false, error: `The ${label} attachment was not found.`, status: 404 };
    return {
      ok: true,
      kind: "document",
      filename: attachment.filename,
      text: attachment.text ?? "",
      attachmentId: attachment.id,
    };
  }

  const filename =
    typeof input.filename === "string" && input.filename.trim() ? input.filename.trim() : `${label}.pdf`;
  const mimeType = typeof input.mimeType === "string" ? input.mimeType.trim() : "";
  const dataUrl = typeof input.dataUrl === "string" ? input.dataUrl : "";
  if (!dataUrl) return { ok: false, error: `A ${label} file is required.`, status: 400 };

  const buffer = dataUrlToBuffer(dataUrl);
  if (!buffer) return { ok: false, error: `The ${label} file could not be decoded.`, status: 400 };
  if (buffer.byteLength > MAX_FILE_BYTES) {
    return { ok: false, error: `The ${label} file must be under 20 MB.`, status: 413 };
  }

  const isZip = looksLikeZip(filename, mimeType, buffer);
  if (isZip && !allowEms) {
    return { ok: false, error: "The estimate to rekey must be a document, not an archive.", status: 400 };
  }
  if (!isZip && !ALLOWED_DOCUMENT_MIME.test(mimeType)) {
    return {
      ok: false,
      error: `Unsupported ${label} file type. Use a PDF, an image, a text/CSV export${
        allowEms ? ", or a ZIP of an EMS export" : ""
      }.`,
      status: 400,
    };
  }

  // Preserve the upload regardless of what the parse produces — an unreadable
  // document must never cost the user their file.
  const storedId = await saveUploadedAttachment({
    ownerUserId: userId,
    filename,
    type: mimeType || (isZip ? "application/zip" : "application/pdf"),
    text: "",
    sizeBytes: buffer.byteLength,
    source: "direct_upload",
  })
    .then((stored) => stored.id)
    .catch(() => null);

  if (isZip) return { ok: true, kind: "ems", filename, buffer, attachmentId: storedId };

  const extracted = await extractPreviewDataFromBuffer({ buffer, mimeType, filename }).catch((error: unknown) => {
    // Never fail the request over extraction, and never hide the reason: a
    // silent catch here reads to the user as "the document had no lines".
    console.error("[rekey] extraction failed", {
      label,
      mimeType,
      message: error instanceof Error ? error.message : String(error),
    });
    return { text: "", pageCount: undefined as number | undefined };
  });

  return { ok: true, kind: "document", filename, text: extracted.text ?? "", attachmentId: storedId };
}

async function readEmsFilesFromZip(buffer: Buffer): Promise<Array<{ filename: string; bytes: Uint8Array }>> {
  const zip = await JSZip.loadAsync(buffer);
  const files: Array<{ filename: string; bytes: Uint8Array }> = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || EMS_SKIP_ENTRY.test(entry.name)) continue;
    files.push({ filename: entry.name.split("/").pop() ?? entry.name, bytes: await entry.async("uint8array") });
  }
  return files;
}

export async function POST(request: NextRequest) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements({ isPlatformAdmin });
    if (!canUseProIntegrations(entitlements)) {
      return NextResponse.json({ error: PRO_FEATURE_REQUIRED_MESSAGE }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as { source?: FileInput; keyed?: FileInput } | null;

    const source = await resolveFile({
      input: body?.source,
      label: "estimate to rekey",
      userId: user.id,
      allowEms: false,
    });
    if (!source.ok) return NextResponse.json({ error: source.error }, { status: source.status });
    if (source.kind !== "document" || !source.text.trim()) {
      return NextResponse.json(
        {
          error:
            "No readable text was found in the estimate to rekey. Your file was kept — try a text-based PDF export rather than a scan.",
        },
        { status: 422 }
      );
    }

    const sheet = buildRekeySheet({ text: source.text, sourceFile: source.filename });
    // Fail closed: an unreadable document yields a convincing-looking sheet of
    // fragments, and a sheet is a thing people key from.
    const quality = assessRekeySheet(sheet);
    if (!quality.ok) {
      return NextResponse.json(
        { error: `${quality.reason} Your file was kept.` },
        { status: 422 }
      );
    }

    let verification: RekeyVerification | null = null;
    let keyedFilename: string | null = null;
    let keyedNotice: string | null = null;

    if (body?.keyed) {
      const keyed = await resolveFile({
        input: body.keyed,
        label: "keyed estimate",
        userId: user.id,
        allowEms: true,
      });
      if (!keyed.ok) return NextResponse.json({ error: keyed.error }, { status: keyed.status });
      keyedFilename = keyed.filename;

      if (keyed.kind === "ems") {
        const bundle = readEmsBundle(await readEmsFilesFromZip(keyed.buffer));
        const result = keyedEstimateFromEms(bundle, keyed.filename);
        if (!result.ok) keyedNotice = result.reason;
        else verification = verifyRekey({ sheet, keyed: result.estimate });
      } else if (!keyed.text.trim()) {
        keyedNotice =
          "No readable text was found in the second document, so no verification was produced. Your file was kept.";
      } else {
        // RV-7: a second estimate DOCUMENT is not a rekey verification — it
        // is a shop-versus-carrier comparison of two estimates, which is the
        // Estimate Delta report. Verification takes only the EMS export of
        // the rekeyed CCC workfile; a document is explained and left out.
        keyedNotice = explainDocumentIsNotVerification({ keyedText: keyed.text });
      }
    }

    const report = buildRekeyHistoryReport({ sheet, verification });
    const saved = await saveAnalysisReport({
      ownerUserId: user.id,
      artifactIds: [source.attachmentId].filter((id): id is string => Boolean(id)),
      report,
    });

    // Metadata-only logging.
    console.info("[rekey] sheet built", {
      reportId: saved.id,
      sourceRows: sheet.stats.sourceRows,
      keyableRows: sheet.stats.keyableRows,
      verified: verification !== null,
      pass: verification?.summary.pass ?? null,
    });

    return NextResponse.json(
      {
        reportId: saved.id,
        sheet,
        sheetText: buildRekeySheetText(sheet),
        verification,
        verificationText: verification ? buildRekeyVerificationText(verification) : null,
        keyedFilename,
        keyedNotice,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[rekey] failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return NextResponse.json({ error: "The rekey sheet could not be built. Your files were kept." }, { status: 500 });
  }
}
