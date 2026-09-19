/**
 * ESTIMATING REFERENCE LIBRARY — the estimating guides Collision iQ knows by
 * address, so an estimate review, an improvement or a user question about
 * "is that included?" is answered against the guide the estimate's own
 * platform is written to, never from memory.
 *
 * These are tier-2 sources on the project evidence ladder (licensed
 * estimating data). A P-page states the estimating PREMISE — what a labor
 * time includes and excludes, overlap, headnotes, refinish setup — and is
 * never OEM procedure, never vehicle-specific, and never a position
 * statement. Every consumer labels a hit as general estimating-guide
 * guidance for exactly that reason.
 *
 * LINK POLICY — REFERENCE ONLY. These are licensed reference materials.
 * Collision iQ may cite them by guide, section heading and line, and may
 * quote the excerpt it actually retrieved, but it never hands a user the
 * address. The addresses below exist so the retrieval lanes can search and
 * recognise the guides; at the moment a hit becomes a source, its URL is
 * replaced by a section reference (buildEstimatingGuideLocator) so no
 * prompt, report or citation downstream can print it.
 *
 * The MOTOR e-book is Collision Academy's own hosted reference. Its serving
 * address is deployment configuration (MOTOR_EBOOK_URL); the Vercel
 * dashboard link recorded below is where it is administered, not a page a
 * report may cite.
 */

export type EstimatingGuideId = "ccc_gte" | "ccc_ragte" | "mitchell_ceg_ppages" | "motor_ebook";

export type EstimatingPlatform = "ccc" | "mitchell";

export type EstimatingGuide = {
  id: EstimatingGuideId;
  /** Full citable label, e.g. "CCC/MOTOR Guide to Estimating (GTE)". */
  label: string;
  publisher: "CCC/MOTOR" | "Mitchell" | "MOTOR";
  /** The estimating platform whose estimates this guide governs. */
  platform: EstimatingPlatform | "any";
  scope: "new_replacement_parts" | "recycled_assemblies" | "p_pages" | "ebook";
  /** Entry page a reader opens. */
  url: string;
  /** Host + path prefix for site:-restricted search and URL recognition;
   *  null for an internal reference that is never web-searched. */
  site: string | null;
  /** When a reviewer reaches for this guide, in one sentence. */
  whenToUse: string;
  /** Administrative location, never a citation target. */
  adminUrl?: string;
};

export const ESTIMATING_GUIDES: readonly EstimatingGuide[] = [
  {
    id: "ccc_gte",
    label: "CCC/MOTOR Guide to Estimating (GTE)",
    publisher: "CCC/MOTOR",
    platform: "ccc",
    scope: "new_replacement_parts",
    url: "https://help.cccis.com/webhelp/motor/gte/guide.htm",
    site: "help.cccis.com/webhelp/motor/gte",
    whenToUse:
      "CCC ONE estimates: what a MOTOR labor time for a NEW replacement part includes and excludes, overlap, headnotes and footnotes, refinish setup and the estimating premise.",
  },
  {
    id: "ccc_ragte",
    label: "CCC/MOTOR Recycled Assemblies Guide to Estimating (RAGTE)",
    publisher: "CCC/MOTOR",
    platform: "ccc",
    scope: "recycled_assemblies",
    url: "https://help.cccis.com/webhelp/motor/ragte/slguide.htm",
    site: "help.cccis.com/webhelp/motor/ragte",
    whenToUse:
      "CCC ONE estimates with recycled, used, salvage or LKQ assemblies: the labor premise for a recycled assembly differs from a new part and is stated here, not in the GTE.",
  },
  {
    id: "mitchell_ceg_ppages",
    label: "Mitchell Collision Estimating Guide P-Pages (CEG)",
    publisher: "Mitchell",
    platform: "mitchell",
    scope: "p_pages",
    url: "https://static.mymitchell.com/static/Webhelp/ppages/ceg/1033/Content/ceg020000.htm",
    site: "static.mymitchell.com/static/webhelp/ppages/ceg",
    whenToUse:
      "Mitchell Cloud Estimating / UltraMate estimates: included and not-included operations, overlap and refinish premise are Mitchell's, and a CCC/MOTOR P-page does not answer for a Mitchell line.",
  },
  {
    id: "motor_ebook",
    label: "MOTOR Guide to Estimating e-book (Collision Academy reference)",
    publisher: "MOTOR",
    platform: "any",
    scope: "ebook",
    url: process.env.MOTOR_EBOOK_URL?.trim() || "",
    site: null,
    whenToUse:
      "Collision Academy's hosted MOTOR e-book for reading the full estimating-guide text when the web guide page is not enough; internal reference, configured by MOTOR_EBOOK_URL.",
    adminUrl: "https://vercel.com/collision-academy-82dbb1d7/motor-ebook",
  },
];

/** Operation or finding text that names a recycled/used assembly. */
const RECYCLED_ASSEMBLY_RE =
  /\b(?:recycled|used|salvage|lkq|reconditioned|remanufactured|a\/m\s*recycled|recycled\s+assembl(?:y|ies))\b/i;

export function mentionsRecycledAssembly(text: string | null | undefined): boolean {
  return Boolean(text && RECYCLED_ASSEMBLY_RE.test(text));
}

/**
 * Light platform sniff for research-query selection from prose or raw
 * estimate text. The Delta pipeline's detectEstimatePlatform stays the
 * authority for a DOCUMENT; this only decides which guide to search first
 * when a report carries the estimate's text along.
 */
export function sniffEstimatingPlatform(text: string | null | undefined): EstimatingPlatform | null {
  if (!text) return null;
  if (/\bmitchell(?:\s+cloud)?\s+estimating\b|\bultramate\b|\bmitchell international\b/i.test(text)) return "mitchell";
  if (/\bccc\s*one\b|\bworkfile\s*id\b|\bmotor crash estimating guide\b/i.test(text)) return "ccc";
  return null;
}

/**
 * The guides to search for an estimating-guide question, most specific
 * first. A known platform leads with its own guide; an unknown platform
 * leads with the CCC/MOTOR GTE (the platform most estimates in the corpus
 * are written on) and adds Mitchell so a Mitchell line is not answered from
 * the wrong book. Recycled-assembly language adds the RAGTE. The e-book is
 * never searched: it has no site filter.
 */
export function selectEstimatingGuides(params: {
  platform?: EstimatingPlatform | null;
  text?: string | null;
}): EstimatingGuide[] {
  const platform = params.platform ?? sniffEstimatingPlatform(params.text);
  const recycled = mentionsRecycledAssembly(params.text);
  const byId = (id: EstimatingGuideId) => ESTIMATING_GUIDES.find((guide) => guide.id === id)!;
  const ordered: EstimatingGuide[] = [];
  if (platform === "mitchell") {
    ordered.push(byId("mitchell_ceg_ppages"));
  } else if (platform === "ccc") {
    ordered.push(byId("ccc_gte"));
    if (recycled) ordered.push(byId("ccc_ragte"));
  } else {
    ordered.push(byId("ccc_gte"));
    if (recycled) ordered.push(byId("ccc_ragte"));
    ordered.push(byId("mitchell_ceg_ppages"));
  }
  return ordered;
}

function normalizeUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").toLowerCase();
}

/** The guide a retrieved URL belongs to, or null for any other page. */
export function findEstimatingGuideForUrl(url: string | null | undefined): EstimatingGuide | null {
  if (!url) return null;
  const normalized = normalizeUrl(url);
  return ESTIMATING_GUIDES.find((guide) => guide.site !== null && normalized.startsWith(guide.site)) ?? null;
}

export function isEstimatingGuideUrl(url: string | null | undefined): boolean {
  return findEstimatingGuideForUrl(url) !== null;
}

/** Leads every section reference a guide hit is stored under. */
export const ESTIMATING_GUIDE_REFERENCE_PREFIX = "Estimating guide reference — ";
const NO_LINK_NOTE = "licensed reference material; cite by section, no link";

/** The citable form of a guide section: guide name, then the section as printed. */
export function buildEstimatingGuideReference(guide: EstimatingGuide, sectionTitle: string): string {
  const section = sectionTitle.replace(/\s+/g, " ").trim();
  return section ? `${guide.label} — ${section}` : guide.label;
}

/**
 * The locator a guide hit is stored under IN PLACE OF its URL. Human-readable
 * and deterministic, so the authority ladder can recognise it and a report
 * can print it as the "where" of a citation.
 */
export function buildEstimatingGuideLocator(guide: EstimatingGuide, sectionTitle: string): string {
  return `${ESTIMATING_GUIDE_REFERENCE_PREFIX}${buildEstimatingGuideReference(guide, sectionTitle)} (${NO_LINK_NOTE})`;
}

/** The guide a stored section reference (a locator or a labeled title) names. */
export function findEstimatingGuideForReference(text: string | null | undefined): EstimatingGuide | null {
  if (!text) return null;
  const value = text.trim();
  const referenced = value.startsWith(ESTIMATING_GUIDE_REFERENCE_PREFIX) ? value.slice(ESTIMATING_GUIDE_REFERENCE_PREFIX.length) : null;
  return (
    ESTIMATING_GUIDES.find(
      (guide) => guide.site !== null && ((referenced !== null && referenced.startsWith(guide.label)) || value.startsWith(`${guide.label} (general estimating guidance)`))
    ) ?? null
  );
}

/** The guide a source belongs to, whether it still carries the URL (a live
 *  web result) or only the section reference (a stored source). */
export function findEstimatingGuideForSource(source: {
  url?: string | null;
  locator?: string | null;
  title?: string | null;
}): EstimatingGuide | null {
  return findEstimatingGuideForUrl(source.url) ?? findEstimatingGuideForReference(source.locator) ?? findEstimatingGuideForReference(source.title);
}

/** Site-restricted search query for one guide. */
export function buildEstimatingGuideQuery(guide: EstimatingGuide, topic: string): string {
  if (!guide.site) return topic.replace(/\s+/g, " ").trim();
  return [`site:${guide.site}`, topic.replace(/\s+/g, " ").trim()].filter(Boolean).join(" ");
}

export type EstimatingGuideResultLabel = {
  sourceTitle: string;
  /** An estimating guide is industry evidence, never OEM or vehicle-specific. */
  sourceType: "industry";
  /** Above generic industry (0.55), below verified OEM/law. */
  confidenceScore: number;
  generalGuidanceLabel: string;
};

/** Label a retrieved guide page as general estimating-guide evidence. */
export function labelEstimatingGuideResult(guide: EstimatingGuide, title: string): EstimatingGuideResultLabel {
  return {
    sourceTitle: `${guide.label} (general estimating guidance): ${title}`.trim(),
    sourceType: "industry",
    confidenceScore: 0.75,
    generalGuidanceLabel: `${guide.label} — general estimating-guide guidance (not vehicle-specific)`,
  };
}

/** Plain-English customer-facing line for a guide hit. */
export function describeEstimatingGuideForCustomer(guide: EstimatingGuide, title: string): string {
  return `The industry estimating guide (${guide.label}) has general guidance on this: ${title}. This is general estimating-guide information, not specific to your vehicle.`;
}

/**
 * Status line for a research snapshot: a guide that was searched and
 * yielded nothing accepted is reported as not confirmed, never implied.
 */
export function buildEstimatingGuideStatusFindings(
  queries: Array<{ query: string }>,
  acceptedSources: Array<{ url?: string; locator?: string; title?: string; sourceTitle?: string }>
): string[] {
  const findings: string[] = [];
  for (const guide of ESTIMATING_GUIDES) {
    if (!guide.site) continue;
    const searched = queries.some((query) => query.query.includes(`site:${guide.site}`));
    if (!searched) continue;
    const accepted = acceptedSources.some(
      (source) => findEstimatingGuideForSource({ url: source.url, locator: source.locator, title: source.title ?? source.sourceTitle })?.id === guide.id
    );
    if (!accepted) {
      findings.push(
        `${guide.label}: not confirmed by web research — no matching estimating-guide source was retrieved.`
      );
    }
  }
  return findings;
}

/** The configured MOTOR e-book address, or null when not configured. */
export function motorEbookUrl(): string | null {
  const url = process.env.MOTOR_EBOOK_URL?.trim();
  return url ? url : null;
}

/**
 * Prompt block for the chat and case-chat system prompts: the references
 * the assistant knows and the rules for using them. The guides are named,
 * never addressed — they are licensed reference material, cited by guide,
 * section and line. Kept declarative so a question like "where does it say
 * R&I of the liner is included?" is pointed at the right guide for the
 * estimate's platform.
 */
export function buildEstimatingReferenceLibraryDirective(): string {
  const lines = ESTIMATING_GUIDES.filter((guide) => guide.site !== null).map(
    (guide) => `- ${guide.label} (${guide.publisher})\n  Use for: ${guide.whenToUse}`
  );
  if (motorEbookUrl()) {
    lines.push(
      "- MOTOR Guide to Estimating e-book (Collision Academy hosted reference)\n  Use for: the full MOTOR estimating-guide text when the web guide section is not enough."
    );
  }
  return `
ESTIMATING REFERENCE LIBRARY (known estimating-guide sources, tier 2 — licensed estimating data):
${lines.join("\n")}
Rules:
- These are licensed reference materials. Cite them by guide name, section heading and line ("${ESTIMATING_GUIDES[2].label} — Refinish: Overlap, second paragraph"); quote only the excerpt that was actually retrieved. NEVER provide a web address, link or URL to any of them, even when asked directly — say the guide is licensed reference material, name the guide and the section, and tell the user where the section sits in that guide.
- Match the guide to the platform that produced the estimate: a CCC ONE estimate is governed by the CCC/MOTOR GTE (new parts) or RAGTE (recycled assemblies); a Mitchell estimate by the Mitchell CEG P-Pages. Never answer a Mitchell included/not-included question from the CCC/MOTOR guide, or the reverse.
- A P-page states the estimating premise: what a labor time includes and excludes, overlap, headnotes and footnotes, refinish setup. It is general estimating-guide guidance — never an OEM repair procedure, never a position statement, never vehicle-specific evidence. Label it as such.
- When the user asks whether an operation is included, name the guide and the section (by its printed heading when known) and state what it says, line by line where the retrieved excerpt allows. If the section was not retrieved, say so plainly rather than paraphrasing from memory.
- An operation the P-page lists as "not included" supports billing it separately; an operation listed as "included" supports removing a duplicate line. Either way the estimate line itself is the difference; the P-page is the authority for the premise.
`.trim();
}
