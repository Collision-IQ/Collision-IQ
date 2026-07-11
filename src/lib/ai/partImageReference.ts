/**
 * Part-number reference image lookup.
 *
 * A generative image model cannot know the geometry of a specific OEM part
 * number — asking it for "a diagram of part # 8V5821467B" always produces a
 * fabricated visual. When an image request references an identifiable part,
 * the system must retrieve REAL images from the internet (Serper image
 * search) and present them as sourced references — research leads, never
 * verified OEM diagrams.
 */

export type PartImageReference = {
  title: string;
  imageUrl: string;
  sourceUrl: string;
  source: string;
};

export type PartImageSearchResponse = {
  status: "success" | "no_results" | "not_configured" | "error";
  query: string;
  results: PartImageReference[];
};

/**
 * Detect a part-number-style token in an image-generation prompt. Requires
 * BOTH a part-shaped token (6+ alphanumerics containing a digit, dashes
 * allowed) AND a part/diagram context cue, so ordinary prompts ("matte black
 * 2020 Civic") never divert to search.
 */
export function extractPartNumberFromImagePrompt(prompt: string): string | null {
  const text = (prompt ?? "").trim();
  if (!text) return null;
  const hasContextCue = /\b(?:part\s*(?:#|no\.?|number)?|oem|diagram|exploded view|schematic|catalog)\b/i.test(text);
  if (!hasContextCue) return null;

  const candidates = text.match(/\b[A-Za-z0-9][A-Za-z0-9-]{5,}\b/g) ?? [];
  for (const candidate of candidates) {
    const compact = candidate.replace(/-/g, "");
    if (compact.length < 6) continue;
    if (!/\d/.test(compact)) continue; // part numbers carry digits
    if (/^\d{4}$/.test(compact)) continue;
    // Reject plain years/dates and common words with digits.
    if (/^(19|20)\d{2}$/.test(compact)) continue;
    return candidate;
  }
  return null;
}

/** Query sent to the image search: keep the vehicle context words around the part. */
export function buildPartImageSearchQuery(prompt: string, partNumber: string): string {
  const context = prompt
    .replace(/\/(?:image|generate-image|design-car)\b[:\s]*/gi, "")
    .replace(/\b(?:diagram|exploded view|schematic|drawing|picture|image|photo)\s+(?:of|for)?\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return context.includes(partNumber) ? context : `${context} ${partNumber}`.trim();
}
