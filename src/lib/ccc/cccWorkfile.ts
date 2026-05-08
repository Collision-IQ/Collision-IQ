import crypto from "node:crypto";
import path from "node:path";

export const CCC_WORKFILE_DISCLAIMER =
  "CCC workfile support is used for estimate-structure review and supplement assistance only. Final estimate entries must be reviewed in the estimating platform by a qualified estimator.";

export type UploadClassification =
  | "image"
  | "pdf"
  | "text"
  | "docx"
  | "ccc_workfile"
  | "ccc_awf"
  | "ccc_companion_file";

const CCC_AWF_EXTENSION = ".awf";
const CCC_GENERIC_WORKFILE_EXTENSIONS = new Set([".ccc"]);
const CCC_COMPANION_EXTENSIONS = new Set([
  ".xml",
  ".json",
  ".csv",
  ".dat",
  ".dbf",
  ".cfg",
  ".ini",
  ".log",
]);
const SAFE_READABLE_COMPANION_EXTENSIONS = new Set([
  ".xml",
  ".json",
  ".csv",
  ".cfg",
  ".ini",
  ".log",
]);

export function getCccUploadClassification(filename: string): UploadClassification | null {
  const extension = path.extname(filename).toLowerCase();
  if (extension === CCC_AWF_EXTENSION) return "ccc_awf";
  if (CCC_GENERIC_WORKFILE_EXTENSIONS.has(extension)) return "ccc_workfile";
  if (CCC_COMPANION_EXTENSIONS.has(extension)) return "ccc_companion_file";
  return null;
}

export function isCccUploadClassification(
  classification: UploadClassification
): classification is "ccc_workfile" | "ccc_awf" | "ccc_companion_file" {
  return (
    classification === "ccc_workfile" ||
    classification === "ccc_awf" ||
    classification === "ccc_companion_file"
  );
}

export function isExplicitlyAllowedCccExtension(filename: string) {
  return Boolean(getCccUploadClassification(filename));
}

export function cccMimeTypeForFilename(filename: string) {
  switch (path.extname(filename).toLowerCase()) {
    case ".awf":
      return "application/vnd.collisioniq.ccc-awf";
    case ".ccc":
      return "application/vnd.collisioniq.ccc-workfile";
    case ".xml":
      return "application/xml";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".txt":
    case ".log":
    case ".cfg":
    case ".ini":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

export type CccWorkfileMetadata = {
  artifactFamily: "ccc_workfile";
  classification: "ccc_workfile" | "ccc_awf" | "ccc_companion_file";
  parserStatus: "metadata_only" | "safe_text_extracted" | "opaque_artifact";
  filename: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  readableTextExtracted: boolean;
  disclaimer: string;
  warnings: string[];
};

export function parseCccWorkfileArtifact(params: {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  classification: "ccc_workfile" | "ccc_awf" | "ccc_companion_file";
}): { text: string; metadata: CccWorkfileMetadata } {
  const extension = path.extname(params.filename).toLowerCase();
  const sha256 = crypto.createHash("sha256").update(params.buffer).digest("hex");
  const mayReadText =
    params.classification === "ccc_companion_file" &&
    SAFE_READABLE_COMPANION_EXTENSIONS.has(extension) &&
    bufferLooksLikeText(params.buffer);
  const safeText = mayReadText ? params.buffer.toString("utf8").slice(0, 12000) : "";
  const parserStatus = mayReadText
    ? "safe_text_extracted"
    : params.classification === "ccc_awf" || params.classification === "ccc_workfile"
      ? "opaque_artifact"
      : "metadata_only";
  const warnings = [
    "CCC artifact was not executed.",
    "Binary workfile contents were not interpreted.",
    "Use extracted context only as estimate-structure support.",
  ];

  const metadata: CccWorkfileMetadata = {
    artifactFamily: "ccc_workfile",
    classification: params.classification,
    parserStatus,
    filename: params.filename,
    extension,
    mimeType: params.mimeType || cccMimeTypeForFilename(params.filename),
    sizeBytes: params.buffer.byteLength,
    sha256,
    readableTextExtracted: Boolean(safeText),
    disclaimer: CCC_WORKFILE_DISCLAIMER,
    warnings,
  };

  const text = [
    `[CCC Workfile Artifact: ${params.filename}]`,
    `Classification: ${params.classification}`,
    `Parser status: ${parserStatus}`,
    `Size bytes: ${params.buffer.byteLength}`,
    `SHA-256: ${sha256}`,
    CCC_WORKFILE_DISCLAIMER,
    safeText ? `[Safe readable companion text]\n${safeText}` : "Stored as an opaque estimate artifact for structure review context.",
  ].join("\n");

  return { text, metadata };
}

function bufferLooksLikeText(buffer: Buffer) {
  if (buffer.byteLength === 0) return true;
  const sample = buffer.subarray(0, Math.min(buffer.byteLength, 4096));
  let suspicious = 0;

  for (const byte of sample) {
    if (byte === 0) return false;
    const isCommonWhitespace = byte === 9 || byte === 10 || byte === 13;
    const isPrintableAscii = byte >= 32 && byte <= 126;
    const isUtf8HighByte = byte >= 128;
    if (!isCommonWhitespace && !isPrintableAscii && !isUtf8HighByte) {
      suspicious += 1;
    }
  }

  return suspicious / sample.byteLength < 0.05;
}
