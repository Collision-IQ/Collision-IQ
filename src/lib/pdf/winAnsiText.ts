/**
 * WinAnsi text safety for every PDF this app produces.
 *
 * Both PDF engines here draw with the standard 14 fonts, whose only encoding
 * is WinAnsi. A character outside it does not fail loudly:
 *
 *   - pdf-lib THROWS at draw time, so one curly quote in an estimate
 *     description can take a whole report down;
 *   - jsPDF silently switches that string to UTF-16BE — with no byte-order
 *     mark, and still pointing at a WinAnsi font — so the text reaches the
 *     reader as mojibake. Measured on a real export, "source → keyed" is
 *     written as (\x00s\x00o\x00u\x00r\x00c\x00e\x00 !\x92\x00 ...).
 *
 * Both failures are silent on the machine that generated the file, because
 * the author reads the report they already know. So normalization belongs
 * HERE, once, rather than at the call sites where it is easy to forget.
 *
 * Two passes, in order:
 *   1. TRANSLITERATE characters that carry meaning to their ASCII convention,
 *      so "≥ 2.0" reads as ">= 2.0" instead of losing the operator.
 *   2. STRIP whatever is still outside WinAnsi. Deleting is the conservative
 *      end state: a dropped decorative glyph costs nothing, while a guessed
 *      substitution could change what a repair document appears to say.
 */

/**
 * Characters with an unambiguous ASCII convention. Deliberately NOT a general
 * Unicode fold: only symbols whose plain-text spelling is standard, so nothing
 * here can alter the meaning of a repair or estimate line.
 */
const TRANSLITERATIONS: ReadonlyArray<[RegExp, string]> = [
  // Quote and dash forms that WinAnsi does NOT carry. The curly quotes, the
  // en/em dash, the ellipsis and the bullet are all WinAnsi characters and are
  // deliberately absent here: this function is a safety net, and a safety net
  // that rewrites text which already drew correctly is a regression, not a
  // fix. A builder that wants those flattened calls flattenPunctuation.
  [/[‛]/g, "'"],
  [/[‟]/g, '"'],
  [/[‐‑‒―−]/g, "-"],
  // Arrows — these appear in comparison output ("source -> keyed").
  [/[→⇒➡➔➜]/g, "->"],
  [/[←⇐]/g, "<-"],
  [/[↔⇔]/g, "<->"],
  [/↑/g, "^"],
  [/↓/g, "v"],
  // Comparison and arithmetic — an operator that silently vanishes changes
  // what a tolerance or threshold appears to say.
  [/≥/g, ">="],
  [/≤/g, "<="],
  [/≠/g, "!="],
  [/[≈∼]/g, "~"],
  [/±/g, "+/-"],
  [/∞/g, "infinity"],
  // Marks used in checklists.
  [/[✓✔]/g, "[x]"],
  [/[✗✘✕✖]/g, "[ ]"],
  // Bullets and separators that are not the WinAnsi bullet.
  [/[●○▪▫‣⁃]/g, "•"],
  [/[‧⋅]/g, "·"],
  // Spaces that are not a plain space.
  [/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " "],
  // Zero-width and directional marks carry no glyph at all.
  [/[\u200B-\u200F\u2028\u2029\u202A-\u202E\uFEFF]/g, ""],
  // Marks outside WinAnsi with a settled plain-text spelling.
  [/℅/g, "c/o"],
  [/№/g, "No."],
];

/**
 * Everything WinAnsi can draw.
 *
 * Three ranges, and the third is the one that is easy to get wrong: WinAnsi
 * puts typographic punctuation — the en and em dash, curly quotes, the bullet,
 * the ellipsis, the euro and trademark marks — in bytes 0x80-0x9F, which map
 * to code points scattered well outside Latin-1. A class of
 * "ASCII plus Latin-1" therefore STRIPS the em dash, and an earlier draft of
 * this module did exactly that: it deleted the dash out of a shipped report
 * label that had been drawing correctly for months.
 *
 * Whitespace stays in the class rather than being stripped — removing a
 * newline here would glue two words together before the caller collapses runs
 * of whitespace.
 */
const WIN_ANSI_HIGH_PUNCTUATION =
  "\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D" +
  "\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178";
const WIN_ANSI_ALLOWED = new RegExp(`[^\\s\\x20-\\x7E\\u00A0-\\u00FF${WIN_ANSI_HIGH_PUNCTUATION}]`, "g");

/**
 * Make text safe to draw with a standard PDF font.
 *
 * Idempotent: the output contains only WinAnsi characters, so running it twice
 * (once through line-splitting, once at draw time) is harmless.
 */
export function toWinAnsiPdfText(value: string | null | undefined): string {
  let text = String(value ?? "");
  if (!text) return "";
  for (const [pattern, replacement] of TRANSLITERATIONS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(WIN_ANSI_ALLOWED, "");
}

/**
 * Flatten WinAnsi punctuation to plain ASCII.
 *
 * Separate from the safety net and opt-in: the characters it touches all draw
 * correctly, so this is a house-style choice, not a correctness one. Two
 * builders already made that choice before this module existed and keep it.
 */
export function flattenPunctuation(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...");
}

/** True when every character can be drawn by a standard PDF font. */
export function isWinAnsiSafe(value: string): boolean {
  // A fresh matcher each call: a global regex carries lastIndex between calls
  // and would report alternating answers for the same input.
  return !new RegExp(WIN_ANSI_ALLOWED.source, "").test(String(value ?? ""));
}

/**
 * Marks an object whose text methods are already guarded. Page objects are
 * fetched inside per-annotation loops, so without this the same page would
 * gain a new wrapper on every pass.
 */
const GUARDED = Symbol.for("collisioniq.winAnsiGuarded");

function alreadyGuarded(target: object): boolean {
  return (target as Record<symbol, unknown>)[GUARDED] === true;
}

function markGuarded(target: object): void {
  Object.defineProperty(target, GUARDED, { value: true, enumerable: false, configurable: true });
}

/** The subset of a jsPDF document this module needs to guard. */
type WinAnsiGuardable = {
  text: (...args: never[]) => unknown;
  splitTextToSize: (...args: never[]) => unknown;
};

/**
 * Guard a jsPDF document so every string drawn through it is WinAnsi-safe.
 *
 * The instance is patched rather than each call site being changed: a report
 * builder makes hundreds of `text` calls, and one missed call is a page of
 * mojibake for the recipient with nothing visible to the author. Line
 * splitting is guarded too, because widths must be measured on the SAME text
 * that is finally drawn or the wrapping no longer matches the page.
 */
export function withWinAnsiText<T extends WinAnsiGuardable>(doc: T): T {
  if (alreadyGuarded(doc)) return doc;
  const originalText = doc.text.bind(doc) as (...args: unknown[]) => unknown;
  const originalSplit = doc.splitTextToSize.bind(doc) as (...args: unknown[]) => unknown;

  const clean = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map((entry) => (typeof entry === "string" ? toWinAnsiPdfText(entry) : entry))
      : typeof value === "string"
        ? toWinAnsiPdfText(value)
        : value;

  doc.text = ((...args: unknown[]) =>
    originalText(clean(args[0]), ...args.slice(1))) as unknown as T["text"];
  doc.splitTextToSize = ((...args: unknown[]) =>
    originalSplit(clean(args[0]), ...args.slice(1))) as unknown as T["splitTextToSize"];

  markGuarded(doc);
  return doc;
}

/** The subset of a pdf-lib page this module needs to guard. */
type WinAnsiGuardablePage = { drawText: (...args: never[]) => unknown };

/**
 * Guard a pdf-lib page so every string drawn on it is WinAnsi-safe.
 *
 * pdf-lib is the stricter of the two engines: a standard font THROWS on a
 * character it cannot encode, so a single curly quote arriving in an estimate
 * description does not degrade the report, it fails the whole render. Guarding
 * the page means that can no longer happen wherever the text came from.
 */
export function withWinAnsiPage<T extends WinAnsiGuardablePage>(page: T): T {
  if (alreadyGuarded(page)) return page;
  const originalDrawText = page.drawText.bind(page) as (...args: unknown[]) => unknown;
  page.drawText = ((...args: unknown[]) =>
    originalDrawText(
      typeof args[0] === "string" ? toWinAnsiPdfText(args[0]) : args[0],
      ...args.slice(1)
    )) as unknown as T["drawText"];
  markGuarded(page);
  return page;
}
