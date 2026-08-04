/**
 * Reader-facing wording, from the rules file — never a literal in the annotator.
 *
 * The annotator wrote its phrases inline, so a wording fix was a per-document
 * edit that died with its document. RO 22116 shipped "MISSED on AMERICAN
 * FAMILY" 44 times and "lower-cost estimate" 219 times, both of which the
 * release gate's R09 already flags as banned. This module is the single place
 * those phrases come from, so a change to data/deltaRules.json changes every
 * future comparison at once.
 *
 * Two rules the vocabulary encodes:
 *
 * ROLE-BASED, NOT COST-BASED. The document to annotate is chosen by role, so
 * calling the other one "the lower-cost estimate" is both wrong wording and
 * sometimes wrong fact — on RO 22116 the carrier pays MORE for materials, just
 * through a different category.
 *
 * DESCRIPTIVE, NOT ACCUSATORY. "MISSED on <carrier>" asserts the carrier
 * omitted something. Applied to a deduction the shop itself took off, or to an
 * operation the carrier bundles under another line, it argues against the
 * shop's own case.
 */
import RULES from "./data/deltaRules.json";

const BANNED: readonly string[] = RULES.wording.bannedPhrases;

/** Neutral name for the document being compared against. */
export function counterpartLabel(resolved?: string | null): string {
  const trimmed = resolved?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "the comparison estimate";
}

/**
 * A line carried here with no counterpart. Descriptive: it states where the
 * line is absent, and does not assert that anyone missed anything.
 */
export function notWrittenOn(counterpart?: string | null): string {
  return RULES.wording.missingOperation.replace("$counterpart", counterpartLabel(counterpart));
}

/** A line carried only on the counterpart document. */
export function onCounterpartOnly(counterpart?: string | null): string {
  return RULES.wording.counterpartOnly.replace("$counterpart", counterpartLabel(counterpart));
}

/**
 * An hours-and-rate basis, where "absent" and "zero" are different claims.
 *
 * RO 22116's carrier allows a flat $650.00 for Paint Supplies with no hours
 * and no rate printed. Rendering that as "AMERICAN FAMILY 0.0 @ $0.00/hr" tells
 * the shop the carrier pays nothing for materials and points the negotiation at
 * the wrong line.
 */
export function formatBasis(params: {
  label: string;
  hours: number | null | undefined;
  rate: number | null | undefined;
  amount: number | null | undefined;
}): string {
  const money = (value: number) =>
    `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const hasBasis = typeof params.hours === "number" && typeof params.rate === "number";
  if (hasBasis) {
    return `${params.label} ${params.hours!.toFixed(1)} @ ${money(params.rate!)}/hr`;
  }
  if (typeof params.amount === "number") {
    return `${params.label} flat ${money(params.amount)}, no hrs/rate shown`;
  }
  return `${params.label} no basis shown`;
}

/** Phrases the gate's R09 rejects, for callers that want to assert locally. */
export function findBannedPhrases(text: string): string[] {
  const found: string[] = [];
  for (const phrase of BANNED) {
    if (new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) found.push(phrase);
  }
  return found;
}
