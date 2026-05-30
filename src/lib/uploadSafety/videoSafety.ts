export const VIDEO_MAX_DURATION_SECONDS = 5;
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const VIDEO_DURATION_LIMIT_MESSAGE = "Videos must be 5 seconds or shorter.";

export const ALLOWED_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);
export const ALLOWED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const MP4_CONTAINER_BOXES = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts"]);

export type VideoDurationValidationResult =
  | { valid: true; durationSeconds: number | null }
  | { valid: false; durationSeconds: number; reason: string; code: "VIDEO_TOO_LONG" };

export function isVideoExtension(extension: string) {
  return ALLOWED_VIDEO_EXTENSIONS.has(extension.toLowerCase());
}

export function isVideoMimeType(mimeType: string | null | undefined) {
  return ALLOWED_VIDEO_MIME_TYPES.has((mimeType ?? "").toLowerCase());
}

export function isSupportedVideoUpload(params: {
  extension: string;
  mimeType?: string | null;
}) {
  const normalizedMimeType = (params.mimeType ?? "").toLowerCase();
  const hasAllowedExtension = isVideoExtension(params.extension);

  if (!hasAllowedExtension) {
    return false;
  }

  return !normalizedMimeType || isVideoMimeType(normalizedMimeType);
}

export function validateVideoDurationFromBuffer(
  buffer: Buffer,
  mimeType?: string | null
): VideoDurationValidationResult {
  const durationSeconds = readVideoDurationSeconds(buffer, mimeType);

  if (durationSeconds !== null && durationSeconds > VIDEO_MAX_DURATION_SECONDS) {
    return {
      valid: false,
      durationSeconds,
      reason: VIDEO_DURATION_LIMIT_MESSAGE,
      code: "VIDEO_TOO_LONG",
    };
  }

  return { valid: true, durationSeconds };
}

export function readVideoDurationSeconds(
  buffer: Buffer,
  mimeType?: string | null
): number | null {
  const normalizedMimeType = (mimeType ?? "").toLowerCase();

  if (
    normalizedMimeType === "video/mp4" ||
    normalizedMimeType === "video/quicktime" ||
    looksLikeMp4(buffer)
  ) {
    return readMp4DurationSeconds(buffer);
  }

  if (normalizedMimeType === "video/webm" || looksLikeWebm(buffer)) {
    return readWebmDurationSeconds(buffer);
  }

  return null;
}

function looksLikeMp4(buffer: Buffer) {
  return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
}

function looksLikeWebm(buffer: Buffer) {
  return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
}

function readMp4DurationSeconds(buffer: Buffer): number | null {
  return readMp4Boxes(buffer, 0, buffer.length);
}

function readMp4Boxes(buffer: Buffer, start: number, end: number): number | null {
  let offset = start;

  while (offset + 8 <= end) {
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    let headerBytes = 8;
    let size = size32;

    if (size32 === 1) {
      if (offset + 16 > end) return null;
      const largeSize = buffer.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(largeSize);
      headerBytes = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }

    if (size < headerBytes || offset + size > end) {
      return null;
    }

    const payloadStart = offset + headerBytes;
    const payloadEnd = offset + size;

    if (type === "mvhd") {
      return readMvhdDurationSeconds(buffer, payloadStart, payloadEnd);
    }

    if (MP4_CONTAINER_BOXES.has(type)) {
      const nested = readMp4Boxes(buffer, payloadStart, payloadEnd);
      if (nested !== null) return nested;
    }

    offset += size;
  }

  return null;
}

function readMvhdDurationSeconds(buffer: Buffer, start: number, end: number): number | null {
  if (start + 4 > end) return null;

  const version = buffer[start];
  if (version === 1) {
    if (start + 32 > end) return null;
    const timescale = buffer.readUInt32BE(start + 20);
    const duration = buffer.readBigUInt64BE(start + 24);
    if (!timescale || duration > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(duration) / timescale;
  }

  if (start + 20 > end) return null;
  const timescale = buffer.readUInt32BE(start + 12);
  const duration = buffer.readUInt32BE(start + 16);
  if (!timescale) return null;
  return duration / timescale;
}

function readWebmDurationSeconds(buffer: Buffer): number | null {
  const durationElement = Buffer.from([0x44, 0x89]);
  const durationOffset = buffer.indexOf(durationElement);
  if (durationOffset < 0) return null;

  const sizeOffset = durationOffset + durationElement.length;
  const size = readEbmlVint(buffer, sizeOffset);
  if (!size || size.value < 4 || size.value > 8) return null;

  const valueOffset = sizeOffset + size.length;
  if (valueOffset + size.value > buffer.length) return null;

  if (size.value === 4) {
    return buffer.readFloatBE(valueOffset) / 1000;
  }

  if (size.value === 8) {
    return buffer.readDoubleBE(valueOffset) / 1000;
  }

  return null;
}

function readEbmlVint(buffer: Buffer, offset: number): { value: number; length: number } | null {
  if (offset >= buffer.length) return null;

  const first = buffer[offset];
  let mask = 0x80;
  let length = 1;

  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }

  if (length > 8 || offset + length > buffer.length) return null;

  let value = first & (mask - 1);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + buffer[offset + index];
  }

  return { value, length };
}
