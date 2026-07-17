import { createHash } from "node:crypto";
import sharp from "sharp";

export type NormalizedDamageImage = {
  buffer: Buffer;
  dataUrl: string;
  sourceHash: string;
  naturalWidth: number;
  naturalHeight: number;
  originalOrientation: number;
  normalizedOrientation: 1;
};

async function sourceToBuffer(source: string | Buffer | Uint8Array): Promise<Buffer> {
  if (Buffer.isBuffer(source)) return source;
  if (source instanceof Uint8Array) return Buffer.from(source);
  const data = source.match(/^data:[^;,]+;base64,(.+)$/s);
  if (data) return Buffer.from(data[1], "base64");
  const response = await fetch(source, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

/** Apply EXIF orientation once, convert to sRGB, and create the sole pipeline source. */
export async function normalizeDamageImage(
  source: string | Buffer | Uint8Array
): Promise<NormalizedDamageImage> {
  const input = await sourceToBuffer(source);
  const original = await sharp(input).metadata();
  const buffer = await sharp(input)
    .rotate()
    .toColorspace("srgb")
    .png({ compressionLevel: 9 })
    .withMetadata({ orientation: 1 })
    .toBuffer();
  const normalized = await sharp(buffer).metadata();
  if (!normalized.width || !normalized.height) throw new Error("Normalized image has no dimensions");
  return {
    buffer,
    dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    sourceHash: createHash("sha256").update(buffer).digest("hex"),
    naturalWidth: normalized.width,
    naturalHeight: normalized.height,
    originalOrientation: original.orientation ?? 1,
    normalizedOrientation: 1,
  };
}
