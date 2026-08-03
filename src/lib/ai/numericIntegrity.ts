/**
 * NUMERIC INTEGRITY — no dollar figure reaches a reader that the structured
 * findings do not support.
 *
 * RO 22185 shipped a Customer Report stating the carrier-only inner bracket at
 * "$180.56", twice, and the chat repeated it. The Estimate of Record says
 * $80.56 and the findings report had it right. A $100 fabrication, in the only
 * document the vehicle owner reads.
 *
 * The cause is structural, not a one-off: prose is generated from a model that
 * is free to TYPE a number rather than interpolate a typed field. The durable
 * fix is to interpolate; this module is the net underneath it, and it runs
 * over every generated artifact including chat.
 *
 * Honest rounding is allowed. "a gap of roughly $5,100" against a known
 * $5,102.78 is good writing, not a fabrication, so a prose figure is supported
 * when it equals a known value OR when a known value rounds to it at a
 * human rounding step. "$180.56" against a known "$80.56" survives no such
 * test, which is the point.
 */

/** Currency-shaped tokens as written, e.g. "$8,745.29", "$5,100", "$80.56". */
const CURRENCY_TOKEN = /\$\s?-?\d[\d,]*(?:\.\d{1,2})?/g;

/** Rounding steps a writer legitimately uses when saying "roughly". */
const ROUNDING_STEPS = [1, 5, 10, 25, 50, 100, 500, 1000] as const;

export interface CurrencyMention {
  /** The token exactly as it appeared in the prose. */
  text: string;
  /** Parsed numeric value. */
  value: number;
  /** Character offset of the token in the source string. */
  index: number;
}

/** Every currency mention in a block of generated prose. */
export function extractCurrencyMentions(text: string): CurrencyMention[] {
  const out: CurrencyMention[] = [];
  if (!text) return out;
  for (const match of text.matchAll(CURRENCY_TOKEN)) {
    const raw = match[0];
    const value = Number(raw.replace(/[$\s,]/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push({ text: raw.replace(/\s+/g, ""), value, index: match.index ?? 0 });
  }
  return out;
}

/** Round-half-up to a step, in cents, so 5102.78 -> 5100 at step 100. */
function roundsTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * Is `value` supported by the structured set — exactly, or as an honest
 * rounding of one of its members?
 */
export function isSupportedCurrencyValue(value: number, known: ReadonlySet<number>): boolean {
  if (known.has(value)) return true;
  // Cent-level tolerance for float noise on derived figures (sums of cells).
  for (const candidate of known) {
    if (Math.abs(candidate - value) < 0.005) return true;
  }
  // A writer may round a known figure DOWN or UP to a readable step, but the
  // rounded form must be coarser than the source — rounding never invents
  // precision, so a two-decimal prose figure must match a known one exactly.
  if (!Number.isInteger(value)) return false;
  for (const candidate of known) {
    for (const step of ROUNDING_STEPS) {
      if (step > Math.max(1, Math.abs(candidate))) break;
      if (roundsTo(candidate, step) === value) return true;
    }
  }
  return false;
}

/** Collect every numeric value the structured findings actually support. */
export function collectKnownCurrencyValues(source: unknown, depth = 0): Set<number> {
  const known = new Set<number>();
  const visit = (node: unknown, level: number) => {
    if (node === null || node === undefined || level > 8) return;
    if (typeof node === "number") {
      if (Number.isFinite(node)) {
        known.add(node);
        known.add(Math.round(node * 100) / 100);
        known.add(Math.abs(node));
      }
      return;
    }
    if (typeof node === "string") {
      for (const mention of extractCurrencyMentions(node)) known.add(mention.value);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, level + 1);
      return;
    }
    if (typeof node === "object") {
      for (const value of Object.values(node as Record<string, unknown>)) visit(value, level + 1);
    }
  };
  visit(source, depth);
  return known;
}

export interface FabricatedCurrency {
  text: string;
  value: number;
  index: number;
  /** The closest supported figure, when one is near — usually the real answer. */
  nearest: number | null;
}

/**
 * Dollar figures present in prose that the structured findings do not support.
 * Empty is the only healthy result.
 */
export function findFabricatedCurrency(
  prose: string,
  structured: unknown
): FabricatedCurrency[] {
  const known = structured instanceof Set ? (structured as Set<number>) : collectKnownCurrencyValues(structured);
  if (known.size === 0) return [];
  const out: FabricatedCurrency[] = [];
  for (const mention of extractCurrencyMentions(prose)) {
    if (isSupportedCurrencyValue(mention.value, known)) continue;
    let nearest: number | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const candidate of known) {
      const gap = Math.abs(candidate - mention.value);
      if (gap < bestGap) {
        bestGap = gap;
        nearest = candidate;
      }
    }
    out.push({ text: mention.text, value: mention.value, index: mention.index, nearest });
  }
  return out;
}

export class NumericHallucinationError extends Error {
  readonly fabricated: FabricatedCurrency[];
  constructor(artifact: string, fabricated: FabricatedCurrency[]) {
    const detail = fabricated
      .map((item) => `${item.text}${item.nearest !== null ? ` (nearest supported: ${item.nearest})` : ""}`)
      .join(", ");
    super(`${artifact} states dollar figures absent from the structured findings: ${detail}`);
    this.name = "NumericHallucinationError";
    this.fabricated = fabricated;
  }
}

/**
 * Guard for a generated artifact. Throws when prose states money the findings
 * do not support — a fabricated figure must never reach a reader, and failing
 * the build is cheaper than being caught by an adjuster.
 */
export function assertNoFabricatedCurrency(
  artifact: string,
  prose: string,
  structured: unknown
): void {
  const fabricated = findFabricatedCurrency(prose, structured);
  if (fabricated.length > 0) throw new NumericHallucinationError(artifact, fabricated);
}
