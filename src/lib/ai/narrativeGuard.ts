/**
 * Narrative-synthesis guard.
 *
 * The line-by-line estimate engine is evidence-anchored, but the prose synthesis
 * layer can drift into speculative "damage-zone" storytelling that the estimate
 * never actually establishes (e.g. "the carrier estimate reads like front-end").
 * This module removes those speculative constructions unless the estimate itself
 * explicitly establishes the zone (via a documented Point of Impact), and exposes
 * the system-prompt directives that force evidence-anchored, structured output.
 *
 * It is intentionally TARGETED: it only neutralizes the speculative damage-zone
 * constructions. It must not strip evidence-anchored references such as
 * "OEM-style front-end parts" (literal part scope) or "fit-sensitive repair path"
 * (established by an OEM position statement).
 */

const NEUTRAL_SCOPE = "the documented repair scope";

// Whole-sentence speculation: "the shop estimate reads like ...",
// "the carrier estimate reads more like ...".
const READS_LIKE_SENTENCE =
  /[^.?!]*\b(?:shop|carrier|insurer)\s+estimate\s+reads\s+(?:like|more\s+like)\b[^.?!]*[.?!]\s*/gi;

// Specific banned damage-zone phrases.
const BANNED_ZONE_PHRASES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bfront-end\s+repair\s+path\b/gi, replacement: NEUTRAL_SCOPE },
  { pattern: /\brear-end\s+repair\s+path\b/gi, replacement: NEUTRAL_SCOPE },
  { pattern: /\blocalized\s+repair\s+zone\b/gi, replacement: NEUTRAL_SCOPE },
  { pattern: /\b(?:front-end|rear-end)\s+repair\s+zone\b/gi, replacement: NEUTRAL_SCOPE },
];

/**
 * True when the estimate text explicitly establishes an impact zone, e.g. a CCC
 * "Point of Impact: 12 Front" field. When established, references to that zone
 * are evidence-anchored and are left untouched.
 */
export function estimateEstablishesDamageZone(estimateText: string | null | undefined): boolean {
  if (!estimateText) return false;
  return /point\s+of\s+impact\b[^\n]{0,40}\b(?:front|rear|side|left|right|driver|passenger)\b/i.test(
    estimateText
  );
}

/**
 * Remove speculative damage-zone narratives from synthesized prose. When the
 * estimate explicitly establishes the impact zone, the text is returned
 * unchanged (the zone is supported by documented evidence).
 */
export function guardDamageZoneNarrative(
  text: string | null | undefined,
  options: { estimateText?: string | null } = {}
): string {
  const original = text ?? "";
  if (!original.trim()) return "";
  if (estimateEstablishesDamageZone(options.estimateText)) {
    return original;
  }

  let guarded = original.replace(READS_LIKE_SENTENCE, "");
  for (const { pattern, replacement } of BANNED_ZONE_PHRASES) {
    guarded = guarded.replace(pattern, replacement);
  }

  return guarded
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True if the text still contains a speculative, unestablished damage-zone narrative. */
export function containsSpeculativeDamageZoneNarrative(text: string | null | undefined): boolean {
  if (!text) return false;
  if (READS_LIKE_SENTENCE.test(text)) {
    READS_LIKE_SENTENCE.lastIndex = 0;
    return true;
  }
  return BANNED_ZONE_PHRASES.some(({ pattern }) => {
    const hit = pattern.test(text);
    pattern.lastIndex = 0;
    return hit;
  });
}

/**
 * System-prompt directive that bans speculative damage-zone storytelling and
 * forces the structured, evidence-anchored format for every major determination.
 */
export const DAMAGE_ZONE_AND_DETERMINATION_DIRECTIVE = `
Damage-zone honesty and determination-structure directive:
- Do not generate speculative damage-zone narratives. Do not say a "front-end repair path", "rear-end repair path", or "localized repair zone", and do not say an estimate "reads like front-end", "reads like rear-end", or "reads more like" a particular zone, unless the estimate itself explicitly establishes that conclusion (for example a documented Point of Impact, or an explicit front/rear/side scope stated in the estimate).
- Describe what each estimate actually documents line by line. Do not infer or assume a damage zone, repair character, or repair "story" that the estimate does not state.
- Referencing literal part scope ("OEM-style front-end parts") or an OEM-established posture ("fit-sensitive repair path supported by an OEM position statement") is allowed because it is anchored to documented evidence; inventing a damage-zone narrative is not.
- For every major determination, use this exact structure with these labels:
  Evidence Reviewed: the specific uploaded files, estimate lines, photos, or documents the determination relies on.
  Finding: the concrete, evidence-anchored conclusion.
  Why It Matters: the safety, repair-completeness, fit/function, verification, or amount-of-loss significance.
  Missing Documentation: what is referenced-but-not-produced or not yet established from the reviewed files.
  Next Step: the specific document, procedure, invoice, or verification needed to close the item.
- Keep each field anchored to the documented evidence. If a field cannot be supported from the reviewed files, say so plainly rather than filling it with narrative.
`.trim();
