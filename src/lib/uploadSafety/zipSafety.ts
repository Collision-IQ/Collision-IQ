import path from "node:path";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import {
  cccMimeTypeForFilename,
  getCccUploadClassification,
  isExplicitlyAllowedCccExtension,
  type UploadClassification,
} from "@/lib/ccc/cccWorkfile";
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  BLOCKED_UPLOAD_EXTENSIONS,
  CCC_UPLOAD_EXTENSIONS,
  SCREENSHOT_IMAGE_EXTENSIONS,
  VIDEO_UPLOAD_EXTENSIONS,
  formatUploadLimitBytes,
  type UploadPlanLimits,
} from "@/lib/uploadSafety/uploadLimits";
import {
  isSupportedVideoUpload,
  isVideoExtension,
  validateVideoDurationFromBuffer,
  VIDEO_DURATION_LIMIT_MESSAGE,
} from "@/lib/uploadSafety/videoSafety";

export type PreparedUploadFile = {
  filename: string;
  type: string;
  buffer: Buffer;
  sizeBytes: number;
  source: "direct_upload" | "zip_extraction";
  sourceArchive?: string;
  classification: UploadClassification;
};

export type UploadRejectedFile = {
  filename: string;
  reason: string;
  code: string;
};

export type ZipExtractionSummary = {
  archive: string;
  acceptedFiles: number;
  rejectedFiles: number;
  extractedBytes: number;
  entryCount: number;
  acceptedEntries: string[];
  rejectedEntries: Array<{
    filename: string;
    reason: string;
    code: string;
  }>;
};

type ZipAccumulator = {
  accepted: PreparedUploadFile[];
  rejected: UploadRejectedFile[];
  extractedBytes: number;
  entryCount: number;
  usedFilenames: Map<string, number>;
};

type ZipErrorCode =
  | "ZIP_TOO_LARGE"
  | "ZIP_TOO_MANY_ENTRIES"
  | "ZIP_BOMB_SUSPECTED"
  | "ZIP_DISALLOWED_TYPE"
  | "ZIP_UNSAFE_PATH"
  | "ZIP_CORRUPT"
  | "ZIP_ENCRYPTED";

const ZIP_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
]);
const ZIP_MAX_BYTES = 50 * 1024 * 1024;
const ZIP_MAX_ENTRIES = 50;
const ZIP_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const ZIP_MAX_RATIO = 100;
const ZIP_ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".webp",
  ".txt",
  ".awf",
]);

class ZipUploadError extends Error {
  code: ZipErrorCode;
  filename: string;

  constructor(code: ZipErrorCode, message: string, filename: string) {
    super(message);
    this.name = "ZipUploadError";
    this.code = code;
    this.filename = filename;
  }
}

export function isZipFilename(filename: string) {
  return path.extname(filename).toLowerCase() === ".zip";
}

export function isZipUpload(file: Pick<File, "name" | "type">) {
  return isZipFilename(file.name) || ZIP_MIME_TYPES.has((file.type || "").toLowerCase());
}

export function getUploadExtension(filename: string) {
  return path.extname(filename).toLowerCase();
}

export function getZipMaxBytes() {
  return ZIP_MAX_BYTES;
}

export function checkZipBudget(params: {
  archiveBytes?: number;
  entryCount?: number;
  uncompressed?: number;
  ratio?: number;
}) {
  if (typeof params.archiveBytes === "number" && params.archiveBytes > ZIP_MAX_BYTES) {
    return { ok: false as const, code: "ZIP_TOO_LARGE" as const };
  }

  if (typeof params.entryCount === "number" && params.entryCount > ZIP_MAX_ENTRIES) {
    return { ok: false as const, code: "ZIP_TOO_MANY_ENTRIES" as const };
  }

  if (typeof params.uncompressed === "number" && params.uncompressed > ZIP_MAX_UNCOMPRESSED_BYTES) {
    return { ok: false as const, code: "ZIP_TOO_LARGE" as const };
  }

  if (typeof params.ratio === "number" && params.ratio > ZIP_MAX_RATIO) {
    return { ok: false as const, code: "ZIP_BOMB_SUSPECTED" as const };
  }

  return { ok: true as const, code: null };
}

export function classifyUploadFilename(filename: string): PreparedUploadFile["classification"] {
  const cccClassification = getCccUploadClassification(filename);
  if (cccClassification) return cccClassification;

  const extension = getUploadExtension(filename);
  if (SCREENSHOT_IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_UPLOAD_EXTENSIONS.has(extension)) return "video";
  if (extension === ".pdf") return "pdf";
  if (extension === ".docx") return "docx";
  return "text";
}

export function normalizeUploadFilename(filename: string) {
  const normalized = filename.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
  const baseName = path.posix.basename(normalized).trim();
  return baseName.replace(/[^\w.\- ()]/g, "_").replace(/\s+/g, " ").slice(0, 180);
}

export function validateUploadFilename(
  filename: string,
  limits?: Pick<UploadPlanLimits, "cccWorkfileAllowed"> & { mimeType?: string | null }
): UploadRejectedFile | null {
  const normalized = filename.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const safeName = normalizeUploadFilename(filename);

  if (
    !safeName ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    segments.includes("..")
  ) {
    return {
      filename,
      reason: "Unsafe archive filename was rejected.",
      code: "UNSAFE_FILENAME",
    };
  }

  const extension = getUploadExtension(safeName);
  const normalizedMimeType = limits?.mimeType ?? null;
  if (BLOCKED_UPLOAD_EXTENSIONS.has(extension)) {
    return {
      filename: safeName,
      reason: `File type ${extension} is not allowed.`,
      code: "BLOCKED_EXTENSION",
    };
  }

  if (CCC_UPLOAD_EXTENSIONS.has(extension) || isExplicitlyAllowedCccExtension(safeName)) {
    if (!limits?.cccWorkfileAllowed) {
      return {
        filename: safeName,
        reason: "CCC workfile/AWF uploads are available on Pro and Admin plans.",
        code: "CCC_WORKFILE_PLAN_REQUIRED",
      };
    }

    if (!isExplicitlyAllowedCccExtension(safeName)) {
      return {
        filename: safeName,
        reason: `CCC companion file type ${extension || "unknown"} is not explicitly allowed.`,
        code: "CCC_COMPANION_UNSUPPORTED",
      };
    }

    return null;
  }

  if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
    return {
      filename: safeName,
      reason: `File type ${extension || "unknown"} is not supported.`,
      code: "UNSUPPORTED_EXTENSION",
    };
  }

  if (isVideoExtension(extension) && !isSupportedVideoUpload({ extension, mimeType: normalizedMimeType })) {
    return {
      filename: safeName,
      reason: `File type ${extension || "unknown"} is not supported.`,
      code: "UNSUPPORTED_EXTENSION",
    };
  }

  return null;
}

export async function prepareUploadFile(file: File, limits: UploadPlanLimits) {
  const buffer = Buffer.from(await file.arrayBuffer());

  if (isZipUpload(file)) {
    return prepareZipUpload({
      filename: file.name,
      buffer,
      mimeType: file.type,
      limits,
    });
  }

  const rejected = validateUploadFilename(file.name, {
    ...limits,
    mimeType: file.type,
  });
  if (rejected) {
    return {
      files: [],
      rejectedFiles: [rejected],
      zipSummaries: [],
    };
  }

  if (isVideoExtension(getUploadExtension(file.name))) {
    const videoDuration = validateVideoDurationFromBuffer(buffer, file.type || mimeTypeForFilename(file.name));
    if (!videoDuration.valid) {
      return {
        files: [],
        rejectedFiles: [
          {
            filename: normalizeUploadFilename(file.name),
            reason: VIDEO_DURATION_LIMIT_MESSAGE,
            code: videoDuration.code,
          },
        ],
        zipSummaries: [],
      };
    }
  }

  return {
    files: [
      {
        filename: normalizeUploadFilename(file.name),
        type: file.type || mimeTypeForFilename(file.name),
        buffer,
        sizeBytes: buffer.byteLength,
        source: "direct_upload" as const,
        classification: classifyUploadFilename(file.name),
      },
    ],
    rejectedFiles: [],
    zipSummaries: [],
  };
}

export async function prepareZipUpload(params: {
  filename: string;
  buffer: Buffer;
  mimeType?: string;
  limits: UploadPlanLimits;
}) {
  const archive = normalizeUploadFilename(params.filename);
  const accumulator: ZipAccumulator = {
    accepted: [],
    rejected: [],
    extractedBytes: 0,
    entryCount: 0,
    usedFilenames: new Map(),
  };

  try {
    if (!params.limits.zipAllowed) {
      throw new ZipUploadError(
        "ZIP_DISALLOWED_TYPE",
        "ZIP uploads are not included in your current plan.",
        archive
      );
    }

    const archiveBudget = checkZipBudget({ archiveBytes: params.buffer.byteLength });
    if (!archiveBudget.ok) {
      throw new ZipUploadError(
        archiveBudget.code,
        `ZIP archive exceeds ${formatUploadLimitBytes(ZIP_MAX_BYTES)}.`,
        archive
      );
    }

    await extractZipEntries({
      archiveName: archive,
      buffer: params.buffer,
      limits: params.limits,
      accumulator,
    });
  } catch (error) {
    const rejected = toZipRejectedFile(error, archive);
    accumulator.accepted = [];
    accumulator.rejected = [rejected];
  }

  return {
    files: accumulator.accepted,
    rejectedFiles: accumulator.rejected,
    zipSummaries: [
      {
        archive,
        acceptedFiles: accumulator.accepted.length,
        rejectedFiles: accumulator.rejected.length,
        extractedBytes: accumulator.extractedBytes,
        entryCount: accumulator.entryCount,
        acceptedEntries: accumulator.accepted.map((entry) => entry.filename),
        rejectedEntries: accumulator.rejected.map((entry) => ({
          filename: entry.filename,
          reason: entry.reason,
          code: entry.code,
        })),
      },
    ],
  };
}

async function extractZipEntries(params: {
  archiveName: string;
  buffer: Buffer;
  limits: UploadPlanLimits;
  accumulator: ZipAccumulator;
}) {
  const zip = await openZipFromBuffer(params.buffer, params.archiveName);

  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("entry", (entry: Entry) => {
        void handleZipEntry(entry, zip, params)
          .then(() => zip.readEntry())
          .catch(reject);
      });
      zip.once("end", resolve);
      zip.once("error", (error) =>
        reject(toZipOpenError(error, params.archiveName))
      );
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

async function handleZipEntry(
  entry: Entry,
  zip: ZipFile,
  params: {
    archiveName: string;
    limits: UploadPlanLimits;
    accumulator: ZipAccumulator;
  }
) {
  if (entry.fileName.endsWith("/")) {
    return;
  }

  params.accumulator.entryCount += 1;
  const entryBudget = checkZipBudget({ entryCount: params.accumulator.entryCount });
  if (!entryBudget.ok) {
    throw new ZipUploadError(
      entryBudget.code,
      `ZIP archive contains more than ${ZIP_MAX_ENTRIES} files.`,
      entry.fileName
    );
  }

  validateZipEntryPath(entry.fileName);

  if (entry.isEncrypted()) {
    throw new ZipUploadError(
      "ZIP_ENCRYPTED",
      "Password-protected ZIP files are not supported.",
      entry.fileName
    );
  }

  if (isZipFilename(entry.fileName)) {
    throw new ZipUploadError(
      "ZIP_DISALLOWED_TYPE",
      "Nested ZIP files are not supported.",
      entry.fileName
    );
  }

  const normalizedName = normalizeUploadFilename(entry.fileName);
  const extension = getUploadExtension(normalizedName);
  if (!ZIP_ALLOWED_EXTENSIONS.has(extension)) {
    throw new ZipUploadError(
      "ZIP_DISALLOWED_TYPE",
      `File type ${extension || "unknown"} is not supported inside ZIP archives.`,
      entry.fileName
    );
  }

  const entrySizeBudget = checkZipBudget({ uncompressed: entry.uncompressedSize });
  if (!entrySizeBudget.ok) {
    throw new ZipUploadError(
      entrySizeBudget.code,
      `Extracted ZIP files exceed ${formatUploadLimitBytes(ZIP_MAX_UNCOMPRESSED_BYTES)} total.`,
      entry.fileName
    );
  }

  const nextTotal = params.accumulator.extractedBytes + entry.uncompressedSize;
  const totalBudget = checkZipBudget({ uncompressed: nextTotal });
  if (!totalBudget.ok) {
    throw new ZipUploadError(
      totalBudget.code,
      `Extracted ZIP files exceed ${formatUploadLimitBytes(ZIP_MAX_UNCOMPRESSED_BYTES)} total.`,
      entry.fileName
    );
  }

  const ratioBudget =
    entry.compressedSize === 0 && entry.uncompressedSize > 0
      ? { ok: false as const, code: "ZIP_BOMB_SUSPECTED" as const }
      : checkZipBudget({
          ratio: entry.compressedSize > 0
            ? entry.uncompressedSize / entry.compressedSize
            : 0,
        });

  if (!ratioBudget.ok) {
    throw new ZipUploadError(
      ratioBudget.code,
      "ZIP archive looks unsafe. Try uploading the files directly.",
      entry.fileName
    );
  }

  const buffer = await readEntryBuffer(zip, entry);
  if (buffer.byteLength !== entry.uncompressedSize) {
    throw new ZipUploadError(
      "ZIP_CORRUPT",
      "ZIP archive entry size did not match its metadata.",
      entry.fileName
    );
  }

  const filename = dedupeFilename(normalizedName, params.accumulator.usedFilenames);
  params.accumulator.accepted.push({
    filename,
    type: mimeTypeForFilename(filename),
    buffer,
    sizeBytes: buffer.byteLength,
    source: "zip_extraction",
    sourceArchive: params.archiveName,
    classification: classifyUploadFilename(filename),
  });
  params.accumulator.extractedBytes = nextTotal;
}

function validateZipEntryPath(filename: string) {
  const normalized = filename.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const extractionRoot = path.resolve("/zip-root");
  const resolved = path.resolve(extractionRoot, normalized);

  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    segments.includes("..") ||
    (resolved !== extractionRoot && !resolved.startsWith(`${extractionRoot}${path.sep}`))
  ) {
    throw new ZipUploadError(
      "ZIP_UNSAFE_PATH",
      "Unsafe archive filename was rejected.",
      filename
    );
  }
}

function dedupeFilename(filename: string, usedFilenames: Map<string, number>) {
  const extension = path.extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  const key = filename.toLowerCase();
  const count = usedFilenames.get(key) ?? 0;
  usedFilenames.set(key, count + 1);

  if (count === 0) {
    return filename;
  }

  const candidate = `${stem}-${count}${extension}`;
  usedFilenames.set(candidate.toLowerCase(), 1);
  return candidate;
}

function openZipFromBuffer(buffer: Buffer, filename: string) {
  return new Promise<ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      {
        lazyEntries: true,
        validateEntrySizes: true,
        strictFileNames: false,
      },
      (error, zip) => {
        if (error || !zip) {
          reject(toZipOpenError(error, filename));
          return;
        }

        resolve(zip);
      }
    );
  });
}

function readEntryBuffer(zip: ZipFile, entry: Entry) {
  return new Promise<Buffer>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(
          new ZipUploadError(
            entry.isEncrypted() ? "ZIP_ENCRYPTED" : "ZIP_CORRUPT",
            error instanceof Error ? error.message : "ZIP archive entry could not be read.",
            entry.fileName
          )
        );
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      stream
        .on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.byteLength;
          if (totalBytes > ZIP_MAX_UNCOMPRESSED_BYTES) {
            stream.destroy(
              new ZipUploadError(
                "ZIP_TOO_LARGE",
                `Extracted ZIP files exceed ${formatUploadLimitBytes(ZIP_MAX_UNCOMPRESSED_BYTES)} total.`,
                entry.fileName
              )
            );
            return;
          }
          chunks.push(buffer);
        })
        .once("error", reject)
        .once("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

function toZipRejectedFile(error: unknown, archive: string): UploadRejectedFile {
  if (error instanceof ZipUploadError) {
    return {
      filename: error.filename || archive,
      reason: error.message,
      code: error.code,
    };
  }

  return {
    filename: archive,
    reason: error instanceof Error ? error.message : "ZIP archive is corrupt.",
    code: "ZIP_CORRUPT",
  };
}

function toZipOpenError(error: unknown, filename: string) {
  const message = error instanceof Error ? error.message : "ZIP archive is corrupt.";
  if (/invalid relative path|absolute path|parent directory/i.test(message)) {
    return new ZipUploadError("ZIP_UNSAFE_PATH", "Unsafe archive filename was rejected.", filename);
  }

  return new ZipUploadError("ZIP_CORRUPT", message, filename);
}

export function mimeTypeForFilename(filename: string) {
  if (isExplicitlyAllowedCccExtension(filename)) {
    return cccMimeTypeForFilename(filename);
  }

  switch (getUploadExtension(filename)) {
    case ".pdf":
      return "application/pdf";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".heic":
      return "image/heic";
    case ".txt":
      return "text/plain";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}
