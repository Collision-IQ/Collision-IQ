import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { canUseProIntegrations, PRO_FEATURE_REQUIRED_MESSAGE } from "@/lib/billing/proFeatures";
import { extractPreviewDataFromBuffer } from "@/lib/attachments/extractPreviewData";
import { extractPdfWords } from "@/lib/reports/citationDensityRowAnchors";
import { readEstimateColumns, type MitchellColumnReading } from "@/lib/rekey/mitchellColumnBands";
import { getUploadedAttachments, saveUploadedAttachment } from "@/lib/uploadedAttachmentStore";
import { saveAnalysisReport } from "@/lib/analysisReportStore";
import { assessRekeySheet, buildRekeySheet } from "@/lib/rekey/rekeyLedger";
import { classifyEmsSelection, normalizeEmsEstimate, readEmsBundle, type EmsBundle } from "@/lib/rekey/emsReader";
import type { RekeySheet } from "@/lib/rekey/rekeyTypes";
import { isRekeyEmsWriterEnabled } from "@/lib/rekey/emsWriter";
import {
  explainDocumentIsNotVerification,
  explainKeyedExport,
  isSourceOwnExport,
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
  | {
      ok: true;
      kind: "document";
      filename: string;
      text: string;
      /** RS-3: the page's own measured column bands, when the upload is a PDF
       *  this process can lay out. Null for every other path, and the sheet
       *  falls back to reading the columns out of the reflowed text. */
      columns: MitchellColumnReading | null;
      attachmentId: string | null;
    }
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
      // A file already in the attachment store is kept as extracted text, so
      // there is no page geometry to measure columns from.
      columns: null,
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

  return {
    ok: true,
    kind: "document",
    filename,
    text: extracted.text ?? "",
    columns: await readColumnBands({ buffer, mimeType, filename }),
    attachmentId: storedId,
  };
}

/**
 * RS-3: the Number / Qty / Price columns, measured from the page.
 *
 * Both prints weld a row's columns together in reflowed text — Mitchell a
 * part number onto its quantity, CCC a quantity onto its price — so the
 * text cannot prove where one column ends and the next begins. The header
 * row's own x positions can, on either layout. Reuses the extractor the
 * citation-density lane already runs in this runtime — no second PDF stack.
 *
 * Failure here is never fatal: the sheet is built from the text either way,
 * and the rows keep the caveat they carried before.
 */
async function readColumnBands(params: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}): Promise<MitchellColumnReading | null> {
  if (!/pdf/i.test(params.mimeType) && !/\.pdf$/i.test(params.filename)) return null;
  try {
    const words = await extractPdfWords(new Uint8Array(params.buffer));
    if (words.length === 0) return null;
    return readEstimateColumns(
      words.map((word) => ({
        page: word.pageNumber,
        x: word.x,
        y: word.y,
        width: word.width,
        height: word.height,
        text: word.text,
      }))
    );
  } catch (error) {
    console.error("[rekey] column-band extraction failed", {
      filename: params.filename,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * An EMS export selected as LOOSE FILES rather than as a ZIP.
 *
 * CCC writes an EMS export as a dozen-plus dBase tables side by side in a
 * folder — there is no archive to pick. Asking for a ZIP asked the estimator
 * to make one before they could verify anything, and the picker would not even
 * let them select the tables together, so the verification half of this
 * feature was unreachable from a real export. The files are accepted as they
 * come off the export folder, companions and all.
 *
 * The caps are per BUNDLE, not per file: an export is small (a real one here
 * is under 100 KB across 14 tables), and the same 20 MB ceiling the single
 * upload uses applies to the whole selection.
 */
const MAX_EMS_FILES = 60;

async function resolveEmsFiles(params: {
  inputs: FileInput[];
  userId: string;
}): Promise<
  | { ok: true; files: Array<{ filename: string; bytes: Uint8Array }>; filename: string; skipped: string[] }
  | { ok: false; error: string; status: number }
> {
  if (params.inputs.length > MAX_EMS_FILES) {
    return { ok: false, error: `Select at most ${MAX_EMS_FILES} files from the EMS export folder.`, status: 400 };
  }
  const selected: Array<{ filename: string; bytes: Uint8Array }> = [];
  let total = 0;
  for (const input of params.inputs) {
    const filename =
      typeof input.filename === "string" && input.filename.trim() ? input.filename.trim().split(/[\\/]/).pop()! : "";
    const dataUrl = typeof input.dataUrl === "string" ? input.dataUrl : "";
    if (!filename || !dataUrl) continue;
    const buffer = dataUrlToBuffer(dataUrl);
    if (!buffer) return { ok: false, error: `${filename} could not be decoded.`, status: 400 };
    total += buffer.byteLength;
    if (total > MAX_FILE_BYTES) {
      return { ok: false, error: "The EMS export must be under 20 MB in total.", status: 413 };
    }
    selected.push({ filename, bytes: new Uint8Array(buffer) });
    // Same promise as every other upload: the file is kept whatever the parse
    // produces.
    await saveUploadedAttachment({
      ownerUserId: params.userId,
      filename,
      type: "application/octet-stream",
      text: "",
      sizeBytes: buffer.byteLength,
      source: "direct_upload",
    }).catch(() => null);
  }
  // An archive in the selection is opened rather than thrown away, and what
  // comes out of it is classified the same way.
  const sorted = classifyEmsSelection(selected);
  const files = [...sorted.tables];
  const skipped = [...sorted.skipped];
  for (const archive of sorted.archives) {
    const inner = classifyEmsSelection(await readEmsFilesFromZip(Buffer.from(archive.bytes)));
    files.push(...inner.tables);
    skipped.push(...inner.skipped);
  }
  if (files.length === 0) {
    return {
      ok: false,
      error: "No EMS tables were found in that selection. Select the export folder's files (.env, .lin, .ttl and the rest), or a ZIP of them.",
      status: 400,
    };
  }
  const stem = files[0].filename.replace(/\.[^.]+$/, "");
  return { ok: true, files, filename: `${stem} EMS export (${files.length} files)`, skipped };
}

/**
 * What an EMS export upload IS, decided in one place.
 *
 * Two things arrive through the same slot and carry the same VIN: the workfile
 * someone keyed the sheet INTO, and the source estimate's OWN export. The
 * platform separates them — an export from the system that wrote the source is
 * that estimate's own — and each is used for what it is: the first verifies
 * the rekey, the second supplies line values better than the page's.
 *
 * The print keeps what only it carries either way: the section headings, the
 * line notes, the totals page the sheet reconciles against. A rebuild that
 * produces no rows keeps the sheet that was already built.
 */
function readKeyedExport(params: {
  sheet: RekeySheet;
  bundle: EmsBundle;
  filename: string;
  source: { text: string; filename: string; columns: MitchellColumnReading | null };
}): { sheet: RekeySheet; verification: RekeyVerification | null; notice: string | null } {
  const estimate = normalizeEmsEstimate(params.bundle);
  if (isSourceOwnExport({ sheet: params.sheet, estimate }).yes) {
    const rebuilt = buildRekeySheet({
      text: params.source.text,
      sourceFile: params.source.filename,
      columns: params.source.columns,
      sourceExport: estimate,
      // The rebuild is the same sheet with better values, so it keys into the
      // same system; without this it would silently fall back to the default.
      target: params.sheet.target,
    });
    const sheet = rebuilt.rows.length > 0 ? rebuilt : params.sheet;
    const usedForRows =
      rebuilt.rows.length > 0
        ? sheet.rows.filter(
            (row) => row.sourceLine !== null && estimate.lines.some((line) => line.lineNumber === row.sourceLine)
          ).length
        : 0;
    return { sheet, verification: null, notice: explainKeyedExport({ sheet, bundle: params.bundle, usedForRows }) };
  }

  const result = keyedEstimateFromEms(params.bundle, params.filename);
  if (result.ok) {
    return { sheet: params.sheet, verification: verifyRekey({ sheet: params.sheet, keyed: result.estimate }), notice: null };
  }
  return { sheet: params.sheet, verification: null, notice: result.reason };
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

    const body = (await request.json().catch(() => null)) as {
      source?: FileInput;
      keyed?: FileInput;
      keyedFiles?: FileInput[];
    } | null;
    // One file still comes through the single-upload path — a ZIP, or the
    // document that gets explained rather than verified.
    const looseEmsFiles = Array.isArray(body?.keyedFiles) ? body.keyedFiles.filter(Boolean) : [];

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

    let sheet = buildRekeySheet({
      text: source.text,
      sourceFile: source.filename,
      columns: source.kind === "document" ? source.columns : null,
    });
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

    if (looseEmsFiles.length > 0) {
      const loose = await resolveEmsFiles({ inputs: looseEmsFiles, userId: user.id });
      if (!loose.ok) return NextResponse.json({ error: loose.error }, { status: loose.status });
      keyedFilename = loose.filename;
      const bundle = readEmsBundle(loose.files);
      const outcome = readKeyedExport({ sheet, bundle, filename: loose.filename, source });
      sheet = outcome.sheet;
      verification = outcome.verification;
      keyedNotice = outcome.notice;
      // Say what was read and what was passed over, so the estimator can see
      // that the estimate PDF sitting in the same folder was not the thing
      // verified against.
      if (loose.skipped.length > 0) {
        const left = `${loose.skipped.length} file${loose.skipped.length === 1 ? "" : "s"} in that selection ${
          loose.skipped.length === 1 ? "is" : "are"
        } not part of the EMS export and ${loose.skipped.length === 1 ? "was" : "were"} left out: ${loose.skipped.join(", ")}.`;
        keyedNotice = keyedNotice ? `${keyedNotice} ${left}` : left;
      }
    } else if (body?.keyed) {
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
        const outcome = readKeyedExport({ sheet, bundle, filename: keyed.filename, source });
        sheet = outcome.sheet;
        verification = outcome.verification;
        keyedNotice = outcome.notice;
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
        // The EMS export is flagged off by default; the panel offers it only
        // where the flag is on, rather than showing a button that 503s.
        emsExportAvailable: isRekeyEmsWriterEnabled(),
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
