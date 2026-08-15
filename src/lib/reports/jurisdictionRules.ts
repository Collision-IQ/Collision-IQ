import type { EstimateTotalsSummary } from "./estimateDeltaMatcher";

/**
 * Jurisdiction rules for the paint & materials (P&M) cap check.
 *
 * Universality directive §1: per-state DATA table with a _DEFAULT +
 * JURISDICTION_UNVERIFIED hold — never hardcoded single-state logic. Every
 * state entry must answer: (1) does any authority permit an arbitrary cap,
 * (2) what must the appraisal include, (3) what must be paid. An unresolved
 * or unresearched state gets the generic indemnity block and the report is
 * flagged JURISDICTION_UNVERIFIED — PA citations are never borrowed for
 * another state.
 */
export const PM_CAP_JURISDICTION_RULES: Record<string, string> = {
  // U7 (Test 99 item 7): the general regulatory framework only. A SPECIFIC
  // enforcement action (previously: a named market-conduct examination of a
  // named carrier) may not appear in finding prose unless that document was
  // actually retrieved for the run — naming an unretrieved authority is the
  // exact failure R15/U7 exist to stop, and the named text also carried a
  // carrier name past the redaction layer.
  PA:
    "PENNSYLVANIA — arbitrary P&M caps unsupported. No Pennsylvania statute or " +
    "regulation authorizes an insurer to arbitrarily cap paint-and-materials " +
    "reimbursement. 31 Pa. Code Ch. 62 (Motor Vehicle Physical Damage " +
    "Appraisers) requires the appraisal to include all necessary " +
    "painting/refinishing and all work necessary to restore the vehicle to " +
    "pre-loss condition; 31 Pa. Code Ch. 146 (Unfair Claims Settlement " +
    "Practices) requires payment of the reasonable cost of repair. " +
    "Demand: (1) the calculation behind the cap, " +
    "(2) the policy language authorizing it, (3) proof the capped amount pays " +
    "the reasonable cost, (4) paint-manufacturer/OEM documentation of " +
    "required materials.",
  _DEFAULT:
    "GENERIC INDEMNITY BLOCK — the insurer owes the reasonable cost to " +
    "restore the vehicle to pre-loss condition; an arbitrary materials cap " +
    "requires the insurer to produce the calculation behind the cap, the " +
    "policy language authorizing it, and proof the capped amount pays the " +
    "reasonable cost. JURISDICTION_UNVERIFIED: state-specific appraisal and " +
    "unfair-claims authority not yet researched for this state — hold the " +
    "citation for legal research before relying on it.",
};

export const US_STATES = new Set(
  ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS " +
    "MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV " +
    "WI WY DC").split(" ")
);

/**
 * Repair-facility state from document text. The subject (shop) header carries
 * the governing state; the comparison document's first zip is often the
 * insurer's HQ and is only consulted as a last resort. Candidates are
 * validated against real state codes — "RO 21896" must never parse as
 * state "RO".
 */
export function detectRepairFacilityState(
  subjectText: string | null | undefined,
  comparisonText?: string | null
): string | null {
  const find = (text: string | null | undefined): string | null => {
    if (!text) return null;
    for (const match of text.matchAll(/\b([A-Z]{2})[,.]?\s+\d{5}(?:-\d{4})?\b/g)) {
      if (US_STATES.has(match[1])) return match[1];
    }
    return null;
  };
  return find(subjectText) ?? find(comparisonText);
}

export interface PmCapFlag {
  type: "PM_CAP_FLAG";
  /** Category name as printed on the capped (lower) estimate. */
  category: string;
  /** The flat capped amount. */
  cap: number;
  /** The subject's computed basis ("26.2 hrs @ $60.00/hr = $1,572.00"), if present. */
  subjectBasis: string | null;
  /** cap ÷ capped estimate's paint-labor hours, when derivable. */
  impliedRate: number | null;
  jurisdiction: string;
  /** True when the state has a researched entry in the rules table. */
  verified: boolean;
  citation: string;
}

/**
 * Detect an arbitrary materials cap: the lower estimate pays a materials
 * category (Paint Supplies et al.) as a FLAT figure with no hrs @ rate basis
 * while the higher estimate computes it from a basis. A blank basis is the
 * trigger — a category the lower estimate also computes (any hours printed)
 * is a rate/hours difference, not a cap. Pure data comparison: no carrier,
 * RO, or state logic here.
 */
export function buildPmCapFlag(params: {
  higher: EstimateTotalsSummary | null;
  lower: EstimateTotalsSummary | null;
  state: string | null;
}): PmCapFlag | null {
  const { higher, lower, state } = params;
  if (!higher || !lower) return null;
  const isMaterials = (name: string) => /suppl|material/i.test(name);
  const higherComputed = higher.categories.find(
    (c) => isMaterials(c.category) && c.hours !== null && c.rate !== null
  );
  const lowerFlat = lower.categories.find(
    (c) => isMaterials(c.category) && c.cost !== null && c.hours === null && c.rate === null
  );
  if (!higherComputed || !lowerFlat || lowerFlat.cost === null) return null;

  const lowerPaintHours =
    lower.categories.find((c) => /paint labor/i.test(c.category))?.hours ?? null;
  const impliedRate =
    lowerPaintHours && lowerPaintHours > 0
      ? Math.round((lowerFlat.cost / lowerPaintHours) * 100) / 100
      : null;
  const subjectBasis =
    higherComputed.hours !== null && higherComputed.rate !== null
      ? `${higherComputed.hours} hrs @ $${higherComputed.rate.toFixed(2)}/hr` +
        (higherComputed.cost !== null ? ` = $${higherComputed.cost.toFixed(2)}` : "")
      : null;
  const jurisdiction = state ?? "UNKNOWN";
  const verified = state !== null && state in PM_CAP_JURISDICTION_RULES;
  return {
    type: "PM_CAP_FLAG",
    category: lowerFlat.category,
    cap: lowerFlat.cost,
    subjectBasis,
    impliedRate,
    jurisdiction,
    verified,
    citation: verified
      ? PM_CAP_JURISDICTION_RULES[jurisdiction]
      : PM_CAP_JURISDICTION_RULES._DEFAULT,
  };
}

/** Materials wording whose MISSED line findings become cap evidence. */
export const PM_CAP_MATERIAL_WORDS =
  /clear coat|primer|mask|urethane|adhesive|seam sealer|wax|acid brush|nozzle|abrasive|flex additive|tint/i;
