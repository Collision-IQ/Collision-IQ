// CCC/MOTOR Guide to Estimating (GTE / P-Pages) — preferred Serper research
// source for general estimating-guide support (included/not-included operations,
// estimating premise, labor/refinish procedure explanations, overlap,
// headnotes/footnotes, P-page guidance).
//
// Scope guardrails (per CCC/MOTOR arrangement):
// - Targeted site: queries only — no whole-site crawling.
// - Store only source metadata: URL, title, short snippet, retrievedAt, citation
//   mapping. No large copied sections are cached.
// - Results are ALWAYS labeled as general CCC/MOTOR GTE guidance — never as
//   vehicle-specific MOTOR DaaS sandbox evidence.
// - No CCC/MOTOR claim is made without a retrieved source; when nothing is
//   retrieved the item is reported as not confirmed by GTE web research.

export const GTE_SITE = "help.cccis.com/webhelp/motor/gte";
export const GTE_SITE_FILTER = `site:${GTE_SITE}`;
export const GTE_SOURCE_LABEL = "CCC/MOTOR Guide to Estimating (GTE)";
export const GTE_GENERAL_GUIDANCE_LABEL =
  "CCC/MOTOR GTE — general estimating-guide guidance (not vehicle-specific)";
export const GTE_NOT_CONFIRMED_NOTE =
  "Not confirmed by CCC/MOTOR GTE web research — no matching Guide to Estimating source was retrieved.";

/** True when a URL points at the allowed GTE WebHelp target. */
export function isGteUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const normalized = url.replace(/^https?:\/\//i, "").toLowerCase();
    return normalized.startsWith(GTE_SITE);
  } catch {
    return false;
  }
}

/** Estimating-guide topics where the GTE is the preferred web source. */
const GTE_TOPIC_RE =
  /\b(included|not[\s-]?included|estimating premise|labor (?:procedure|operation|time)|refinish|blend|overlap|headnote|footnote|p[\s-]?pages?|two[\s-]?tone|clear ?coat|denib|de-?nib|feather|prime|block|masking|setup|set[\s-]?up|drill time|access time|r&i|r&r|remove (?:and|\/) (?:install|replace))\b/i;

/** True when finding/operation text calls for estimating-guide (GTE) support. */
export function needsGteEstimatingGuideSupport(text: string | null | undefined): boolean {
  return Boolean(text && GTE_TOPIC_RE.test(text));
}

/** Build the targeted Serper query — always constrained to the GTE site. */
export function buildGteSerperQuery(topic: string): string {
  const cleaned = topic.replace(/\s+/g, " ").trim();
  return [GTE_SITE_FILTER, cleaned].filter(Boolean).join(" ").trim();
}

export type GteWebResultLabel = {
  /** Labeled title, e.g. "CCC/MOTOR GTE (general estimating guidance): Refinish — Overlap". */
  sourceTitle: string;
  /** GTE is an estimating-industry guide, never OEM/vehicle-specific evidence. */
  sourceType: "industry";
  /** Above generic industry (0.55), below verified OEM/law. */
  confidenceScore: number;
};

/** Label a retrieved GTE web result as general estimating-guide evidence. */
export function labelGteWebResult(title: string): GteWebResultLabel {
  return {
    sourceTitle: `${GTE_SOURCE_LABEL} (general estimating guidance): ${title}`.trim(),
    sourceType: "industry",
    confidenceScore: 0.75,
  };
}

/** Plain-English customer-facing summary line (leads the customer report). */
export function describeGteSourceForCustomer(title: string): string {
  return `The industry estimating guide (CCC/MOTOR Guide to Estimating) has general guidance on this: ${title}. This is general estimating-guide information, not specific to your vehicle.`;
}

/**
 * Status finding for the research snapshot: when a GTE-targeted query ran but no
 * GTE source was accepted, say so explicitly instead of implying CCC/MOTOR support.
 */
export function buildGteResearchStatusFindings(
  queries: Array<{ query: string }>,
  acceptedSources: Array<{ url?: string }>
): string[] {
  const gteQueryRan = queries.some((query) => query.query.includes(GTE_SITE_FILTER));
  if (!gteQueryRan) return [];
  const gteSourceAccepted = acceptedSources.some((source) => isGteUrl(source.url));
  return gteSourceAccepted ? [] : [`CCC/MOTOR GTE: ${GTE_NOT_CONFIRMED_NOTE}`];
}
