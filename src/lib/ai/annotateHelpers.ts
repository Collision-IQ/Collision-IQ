/** Shared request helpers for the /api/vision/annotate routes. */

export function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Decode a base64 data URL into raw bytes for the deterministic renderer. */
export function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const match = /^data:[^;,]+;base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
}

/**
 * Accept vehicleContext as either a plain string or a structured object
 * ({ year, make, model, side, lossArea, ... }) and flatten it into a short
 * context line for the vision prompt.
 */
export function stringifyVehicleContext(value: unknown): string | undefined {
  const asString = normalizeNonEmptyString(value);
  if (asString) return asString;
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const order = ["year", "make", "model", "trim", "side", "lossArea", "loss_area"];
  const seen = new Set<string>();
  const parts: string[] = [];
  const push = (key: string) => {
    const v = normalizeNonEmptyString(record[key]);
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      parts.push(v);
    }
  };
  for (const key of order) push(key);
  return parts.length > 0 ? parts.join(" ") : undefined;
}
