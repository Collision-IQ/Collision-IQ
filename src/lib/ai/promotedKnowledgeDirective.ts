/**
 * Promoted collision knowledge — pure selection and directive rules.
 *
 * This is the READ side of the Collision Learning Engine. The engine itself
 * never writes to prompts (see learning/__tests__/isolationAndGovernance.test.ts);
 * instead the chat pipeline reads knowledge that has already cleared the
 * promotion gates and a Platform Admin's approval, and renders it as one more
 * system directive alongside the other builders.
 *
 * Only PROMOTED, non-holdout items are eligible:
 *  - DRAFT/VERIFIED items have not been human-approved, so they never ship.
 *  - HOLDOUT items are benchmark-only; injecting them would teach to the test
 *    and invalidate every holdout measurement.
 *
 * No server imports here so the rules stay directly unit-testable;
 * promotedKnowledge.ts applies them against the database.
 */

export type PromotedKnowledgeSource = {
  sourceType: string;
  title: string;
  version?: string;
};

export type PromotedKnowledgeEntry = {
  slug: string;
  domain: string;
  objective: string;
  keyPoints: string[];
  forbiddenAssertions: string[];
  authorityMentions: string[];
  sources: PromotedKnowledgeSource[];
  /** Manufacturer scope. null means the knowledge is manufacturer-neutral. */
  oem: string | null;
  /** Jurisdiction scope. null means the knowledge is jurisdiction-neutral. */
  jurisdiction: string | null;
  vehicleScopeLabel: string | null;
  safetyCritical: boolean;
};

export type PromotedKnowledgeContext = {
  oem?: string | null;
  jurisdiction?: string | null;
};

export type PromotedKnowledgeSelection = {
  selected: PromotedKnowledgeEntry[];
  /** Dropped because the entry is scoped to another OEM/jurisdiction. */
  omittedForScope: number;
  /** Dropped because the prompt budget was exhausted. */
  omittedForBudget: number;
};

/** Hard caps so promoted knowledge can never crowd out case evidence. */
export const PROMOTED_KNOWLEDGE_MAX_ITEMS = 12;
export const PROMOTED_KNOWLEDGE_MAX_CHARS = 6000;
/** Key points per entry — enough to carry the rule, not the whole source. */
export const PROMOTED_KNOWLEDGE_MAX_KEY_POINTS = 4;

function normalizeScope(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Manufacturer- and jurisdiction-scoped knowledge applies ONLY inside its
 * scope. Per the project rule "never generalize one manufacturer's requirement
 * to another", an entry scoped to an OEM is withheld entirely when the turn's
 * manufacturer is unknown or different — silence is safer than a cross-applied
 * procedure.
 */
export function isEntryInScope(
  entry: PromotedKnowledgeEntry,
  context: PromotedKnowledgeContext
): boolean {
  const entryOem = normalizeScope(entry.oem);
  if (entryOem && entryOem !== normalizeScope(context.oem)) return false;

  const entryJurisdiction = normalizeScope(entry.jurisdiction);
  if (entryJurisdiction && entryJurisdiction !== normalizeScope(context.jurisdiction)) return false;

  return true;
}

function scopeLabel(entry: PromotedKnowledgeEntry): string {
  const parts = [
    entry.oem ? entry.oem : "manufacturer-neutral",
    entry.jurisdiction ? entry.jurisdiction : "jurisdiction-neutral",
    entry.vehicleScopeLabel ?? "",
  ].filter(Boolean);
  return parts.join("; ");
}

export function renderPromotedEntry(entry: PromotedKnowledgeEntry, index: number): string {
  const lines: string[] = [];
  const prefix = entry.safetyCritical ? "[SAFETY-CRITICAL] " : "";
  lines.push(`${index}. ${prefix}${entry.objective} (scope: ${scopeLabel(entry)})`);

  for (const keyPoint of entry.keyPoints.slice(0, PROMOTED_KNOWLEDGE_MAX_KEY_POINTS)) {
    lines.push(`   - ${keyPoint}`);
  }
  if (entry.forbiddenAssertions.length > 0) {
    lines.push(`   - Do not assert: ${entry.forbiddenAssertions.join(" / ")}`);
  }
  if (entry.sources.length > 0) {
    const rendered = entry.sources
      .map((source) => `${source.sourceType}: ${source.title}${source.version ? ` (${source.version})` : ""}`)
      .join("; ");
    lines.push(`   - Authority: ${rendered}`);
  }
  return lines.join("\n");
}

/**
 * Selects in-scope entries, safety-critical first, within the item and
 * character budgets. Ordering is deterministic (slug breaks ties) so the same
 * inputs always produce the same prompt — a prompt that varies run to run is
 * untestable.
 */
export function selectPromotedEntries(
  entries: PromotedKnowledgeEntry[],
  context: PromotedKnowledgeContext
): PromotedKnowledgeSelection {
  const inScope = entries.filter((entry) => isEntryInScope(entry, context));
  const omittedForScope = entries.length - inScope.length;

  const ordered = [...inScope].sort((left, right) => {
    if (left.safetyCritical !== right.safetyCritical) return left.safetyCritical ? -1 : 1;
    return left.slug.localeCompare(right.slug);
  });

  const selected: PromotedKnowledgeEntry[] = [];
  let usedChars = 0;

  for (const entry of ordered) {
    if (selected.length >= PROMOTED_KNOWLEDGE_MAX_ITEMS) break;
    const cost = renderPromotedEntry(entry, selected.length + 1).length;
    if (usedChars + cost > PROMOTED_KNOWLEDGE_MAX_CHARS) break;
    usedChars += cost;
    selected.push(entry);
  }

  return {
    selected,
    omittedForScope,
    omittedForBudget: ordered.length - selected.length,
  };
}

const DIRECTIVE_HEADER = [
  "VERIFIED COLLISION KNOWLEDGE (internally reviewed and approved):",
  "- Treat the entries below as established, already-verified knowledge. They cleared source verification, delayed recall, contrast and transfer testing, a citation-fidelity review, and human approval.",
  "- Each entry states its scope. Never apply a manufacturer-scoped or jurisdiction-scoped entry outside that scope, and never generalize one manufacturer's requirement to another.",
  "- These are background knowledge, not documents retrieved for this turn. Do not present them as a retrieved citation, a link, or evidence from the user's case, and do not claim to have looked them up.",
  "- Uploaded case evidence always outranks these entries. If case evidence contradicts one, follow the evidence and say plainly that the conflict exists.",
].join("\n");

/**
 * Builds the directive block. Returns "" when nothing is in scope, so callers
 * can drop it from the instruction array exactly like the other builders.
 */
export function buildPromotedKnowledgeDirective(entries: PromotedKnowledgeEntry[]): string {
  if (entries.length === 0) return "";
  const rendered = entries.map((entry, index) => renderPromotedEntry(entry, index + 1));
  return `${DIRECTIVE_HEADER}\n\n${rendered.join("\n")}`;
}
