/**
 * deltaPair — pairing + typed comparison for the delta engine.
 * Pass order (each pass consumes competing rows):
 *   1. PART-NUMBER-FIRST  — identical part number is an unconditional pair.
 *   2. AGG ROUTING        — keys where subject count > competing count skip 1:1
 *                           and compare as sums (qty shortfall), so a 3-line tape
 *                           group compares its total vs a single flat line.
 *   3. CONTEXT-PREFERRED  — same canonical key; exact context (same section,
 *                           same operation) first across all subjects, then
 *                           candidates ordered by (section, operation, side).
 *                           Tailgate clear-coat pairs with tailgate clear-coat,
 *                           never the bumper's; Rpr pairs with Rpr before R&I.
 *   4. PREFIX-CONTAINMENT — truncated/verbose description variants (>=12 chars).
 * Comparison is typed-cell-only: price<->price, labor<->labor, paint<->paint.
 * A finding's category text derives FROM the cell type — a paint delta can never
 * be reported as "less body labor".
 */
import type { EstimateRow } from "./rowCluster";

export type CellField = "price" | "labor" | "paint";

export interface CellDelta {
  field: CellField | "part#";
  subject: number | string;
  competing: number | string;
}

export type FindingKind = "VALUE_DELTA" | "QTY_SHORTFALL" | "MISSED";

export interface Finding {
  kind: FindingKind;
  subject: EstimateRow;
  competing: EstimateRow | null;
  deltas: CellDelta[];
  /** e.g. "reduced paint", "reduced mechanical labor", "price difference", "part number change" */
  category: string;
  /** All subject rows in an aggregated (QTY_SHORTFALL) group; [subject] otherwise. */
  subjects?: EstimateRow[];
  /** MISSED only: the comparison prices the OTHER side of this two-sided
   *  operation, so this is one side of a symmetric repair left unaddressed,
   *  never a duplicate (RO 21336 findings 23, 51, 55, 58). */
  otherSideOnCompeting?: "left" | "right";
  /** Pass 5 (near-variant): the pair was made on a close description with
   *  comparable values — a colour-variant part number, a "+25%" suffix. */
  nearVariant?: boolean;
}

/**
 * A CCC Supplement of Record prints, after the estimate body, a SUPPLEMENT
 * SUMMARY: the changed, deleted and added items of each supplement, with the
 * superseded amounts printed NEGATIVE. Those rows are history, never the
 * document's current state, and never a pairing basis. RO 21336 cited a
 * "-68.40" from that ledger as the carrier's figure for a rivet the main
 * estimate priced at $63.90, and reported a $132.30 gap.
 */
const CHANGELOG_SECTION = /supplement\s+summary|changed\s+items|deleted\s+items|added\s+items|changelog|supplement\s+history/i;
export function isChangelogRow(row: EstimateRow): boolean {
  return CHANGELOG_SECTION.test(row.sectionLabel ?? "") || CHANGELOG_SECTION.test(row.section ?? "");
}

/** The aggregation identity of a row: its operation AND its side. "RT R&I
 *  front seat" and "LT R&I front seat" are two sides of one repair, never
 *  two occurrences of one operation. */
function aggKeyOf(row: EstimateRow): string {
  return row.side ? `${row.key}|${row.side}` : row.key;
}

/** Operation codes and supplement tags print on every row: never content. */
const NON_CONTENT_WORD = /^(rpr|repl|subl|refn|blnd|algn|sect|add|incl|s\d{2})$/;

/** The operation code a row prints ("rpr", "repl", "r&i" …), or "". */
function operationOf(row: EstimateRow): string {
  return row.rawDesc.match(/(?:^|[\s#*])(R&I|Rpr|Repl|Subl|Refn|Blnd|O\/H|Algn)(?=\s|$)/i)?.[1].toLowerCase() ?? "";
}

/** Content words of a row's printed description, for the near-variant pass
 *  (the canonical key is a compact string with no word boundaries). The
 *  operation code is not one: counted as a shared word it paired RO 21548's
 *  "Rpr Set up & initiate camera" with the carrier's "Rpr Set Back Wiring"
 *  on {rpr, set}, and the shop's own set-back-wiring line then read as
 *  missing from the carrier. */
function descriptionWords(row: EstimateRow): string[] {
  return row.rawDesc
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !NON_CONTENT_WORD.test(word));
}

/**
 * Pass 5 evidence: a MISSED subject and a competing-only row that describe
 * the same item under a minor variant — a colour-coded part number ("Seat
 * belt bezel atmosphere" / "Seat belt bezel black"), a markup suffix
 * ("Suspension Alignment +25%") — with values in the same range. Two shared
 * content words at half or better of the shorter key, the same side (or
 * none), and comparable price or hours.
 */
function isNearVariant(a: EstimateRow, b: EstimateRow): boolean {
  if (a.side && b.side && a.side !== b.side) return false;
  const wordsA = descriptionWords(a);
  const wordsB = new Set(descriptionWords(b));
  const shared = wordsA.filter((word) => wordsB.has(word));
  // A one-word description is identified by that word, under the same
  // operation: "Rpr Battery" is the carrier's "Rpr D&R battery/Reset
  // Electronics" (RO 21548), where two shared words cannot exist.
  const oneWord =
    Math.min(wordsA.length, wordsB.size) === 1 &&
    shared.length === 1 &&
    shared[0].length >= 6 &&
    operationOf(a) !== "" &&
    operationOf(a) === operationOf(b);
  if (!oneWord && (shared.length < 2 || shared.length < Math.min(wordsA.length, wordsB.size) * 0.5)) return false;
  const price = (row: EstimateRow) => (row.price !== null && row.price > 0 ? row.price : null);
  const hours = (row: EstimateRow) => (row.labor ?? 0) + (row.paint ?? 0);
  const priceA = price(a);
  const priceB = price(b);
  if (priceA !== null && priceB !== null) {
    const ratio = Math.max(priceA, priceB) / Math.min(priceA, priceB);
    return ratio <= 2 || Math.abs(priceA - priceB) <= 50;
  }
  if (priceA === null && priceB === null) return Math.abs(hours(a) - hours(b)) <= 1;
  return false;
}

const EPS = 0.001;

/**
 * A DEDUCTION: a credit the estimate takes off its own total rather than work
 * it bills — overlap allowances, betterment, appearance allowances, discounts.
 * Recognized by SHAPE (any negative cell), never by wording.
 */
export function isDeduction(row: EstimateRow): boolean {
  return (row.labor ?? 0) < 0 || (row.paint ?? 0) < 0 || (row.price ?? 0) < 0;
}

function laborCategory(row: EstimateRow, field: CellField): string {
  if (field === "paint") return "paint";
  if (field === "price") return "price";
  switch (row.laborClass) {
    case "M":
      return "mechanical labor";
    case "1":
    case "2":
    case "3":
    case "4":
      return `user-defined labor ${row.laborClass}`;
    default:
      return "body labor";
  }
}

function compareTyped(subject: EstimateRow, competing: EstimateRow): CellDelta[] {
  const out: CellDelta[] = [];
  for (const field of ["price", "labor", "paint"] as CellField[]) {
    const a = subject[field] ?? 0;
    const b = competing[field] ?? 0;
    if (Math.abs(a - b) > EPS) out.push({ field, subject: a, competing: b });
  }
  if (subject.part && competing.part && subject.part !== competing.part && out.length === 0)
    out.push({ field: "part#", subject: subject.part, competing: competing.part });
  return out;
}

export interface PairResult {
  findings: Finding[];
  competingOnly: EstimateRow[];
  /** Every 1:1 pairing made (including equal-value pairs that produced no
   * finding) — the single source both renderers derive from. */
  pairs: Array<{ subject: EstimateRow; competing: EstimateRow }>;
}

export function pairAndCompare(subjectInput: EstimateRow[], competingInput: EstimateRow[]): PairResult {
  // History rows (a Supplement Summary's changed / deleted / added items) are
  // never the document's current state: out of both pools before any pass.
  const subject = subjectInput.filter((row) => !isChangelogRow(row));
  const competing = competingInput.filter((row) => !isChangelogRow(row));
  const used = new Set<number>();
  const paired = new Map<EstimateRow, number>();
  // A NEGATIVE competing row is a reversal or deduction, never the current
  // state of a positive subject operation — not a pairing basis for one.
  const usable = (s: EstimateRow, index: number) => !used.has(index) && !(isDeduction(competing[index]) && !isDeduction(s));

  // pass 1 — part-number-first
  const byPart = new Map<string, number[]>();
  competing.forEach((row, index) => {
    if (!row.part) return;
    const list = byPart.get(row.part);
    if (list) list.push(index);
    else byPart.set(row.part, [index]);
  });
  for (const s of subject) {
    if (!s.part) continue;
    for (const index of byPart.get(s.part) ?? []) {
      if (usable(s, index)) {
        used.add(index);
        paired.set(s, index);
        break;
      }
    }
  }

  // pass 2 — route subject-surplus keys to aggregation (by operation AND side)
  const count = (rows: EstimateRow[], include: (index: number) => boolean) => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (include(index)) map.set(aggKeyOf(row), (map.get(aggKeyOf(row)) ?? 0) + 1);
    });
    return map;
  };
  const subjectCount = count(subject, (index) => !paired.has(subject[index]));
  const competingCount = count(competing, (index) => !used.has(index) && !isDeduction(competing[index]));
  const aggKeys = new Set(
    [...subjectCount.keys()].filter(
      (key) => (competingCount.get(key) ?? 0) > 0 && subjectCount.get(key)! > competingCount.get(key)!
    )
  );

  // pass 3 — context-preferred 1:1
  const byKey = new Map<string, number[]>();
  competing.forEach((row, index) => {
    const list = byKey.get(row.key);
    if (list) list.push(index);
    else byKey.set(row.key, [index]);
  });
  // The key carries no operation code, so one panel's "R&I" and "Rpr" lines
  // share a key. Context cost, lexicographic: section, then operation, then
  // side. The operation is a preference, never a filter — a "Repl" here
  // against a "Rpr" there of the same part still pairs when nothing better
  // exists (that is an operation change, and it must be reported as one).
  const contextCost = (s: EstimateRow, index: number) =>
    (competing[index].section !== s.section ? 4 : 0) +
    (operationOf(competing[index]) !== operationOf(s) ? 2 : 0) +
    (competing[index].side !== s.side ? 1 : 0);
  const candidatesFor = (s: EstimateRow, exactContextOnly: boolean) =>
    (byKey.get(s.key) ?? [])
      .filter(
        // Never the OPPOSING side: "LT R&I front seat" is not "RT R&I front
        // seat" however the subject list is ordered.
        (index) => usable(s, index) && !(s.side && competing[index].side && competing[index].side !== s.side)
      )
      .filter((index) => !exactContextOnly || contextCost(s, index) < 2)
      .sort((a, b) => contextCost(s, a) - contextCost(s, b));
  // Stage 1 — same key, same section, same operation, across ALL subjects
  // before any cross-operation pairing, so an earlier subject cannot take the
  // row a later subject matches exactly. On a CCC print the R&I line of a
  // panel usually precedes its repair line: a document-order greedy loop paid
  // the shop's "Rpr LT Upper cover 3.0 + 1.8" against the carrier's "R&I LT
  // Upper cover 0.8" while the carrier's identical "Rpr" line read as
  // carrier-only.
  // Stage 2 — what remains, ranked by the full context cost.
  // Pairs are recorded in subject order, as a single document-order pass did.
  const contextPairs = new Map<EstimateRow, number>();
  for (const exactContextOnly of [true, false]) {
    for (const s of subject) {
      if (paired.has(s) || contextPairs.has(s) || aggKeys.has(aggKeyOf(s))) continue;
      const candidates = candidatesFor(s, exactContextOnly);
      if (candidates.length) {
        used.add(candidates[0]);
        contextPairs.set(s, candidates[0]);
      }
    }
  }
  for (const s of subject) if (contextPairs.has(s)) paired.set(s, contextPairs.get(s)!);

  // pass 4 — prefix containment for truncated/verbose variants
  for (const s of subject) {
    if (paired.has(s) || aggKeys.has(aggKeyOf(s))) continue;
    for (let index = 0; index < competing.length; index += 1) {
      if (!usable(s, index)) continue;
      if (s.side && competing[index].side && competing[index].side !== s.side) continue;
      const a = s.key;
      const b = competing[index].key;
      if (a.length >= 12 && b.length >= 12 && (a.startsWith(b) || b.startsWith(a))) {
        used.add(index);
        paired.set(s, index);
        break;
      }
    }
  }

  // pass 5 — near-variant: what is left unpaired on BOTH sides, where a
  // subject and a competing row describe one item under a minor variant. One
  // "priced / part differently" finding, never a MISSED here AND a
  // competing-only line there for the same bezel (RO 21336: seat belt bezel
  // atmosphere / black, $10.38 / $10.95; suspension alignment $268 / $250).
  const nearVariants = new Set<EstimateRow>();
  for (const s of subject) {
    if (paired.has(s) || aggKeys.has(aggKeyOf(s)) || isDeduction(s)) continue;
    for (let index = 0; index < competing.length; index += 1) {
      if (!usable(s, index) || paired.has(competing[index])) continue;
      if (!isNearVariant(s, competing[index])) continue;
      used.add(index);
      paired.set(s, index);
      nearVariants.add(s);
      break;
    }
  }

  // emit — 1:1 deltas, MISSED, then aggregated qty shortfalls
  const findings: Finding[] = [];
  const aggSubjects = new Map<string, EstimateRow[]>();
  const pairedSubjects = [...paired.keys()];
  for (const s of subject) {
    if (aggKeys.has(aggKeyOf(s))) {
      const list = aggSubjects.get(aggKeyOf(s));
      if (list) list.push(s);
      else aggSubjects.set(aggKeyOf(s), [s]);
      continue;
    }
    const index = paired.get(s);
    if (index === undefined) {
      // P0-3: a DEDUCTION is a credit this estimate takes off its own total —
      // an overlap allowance, betterment, an appearance allowance — and it
      // modifies the operation above it. Reporting it as missing from the
      // comparison asks the other side to pay LESS, which is the opposite of
      // what the document is for (RO 22185 stamped two "Overlap Major
      // Non-Adj. Panel -0.2" lines "MISSED on ERIE").
      if (isDeduction(s)) continue;
      // The other side of this two-sided operation IS priced on the
      // comparison: this is one side of a symmetric repair left unaddressed.
      const otherSide = s.side
        ? pairedSubjects.find((t) => t !== s && t.key === s.key && t.side && t.side !== s.side)?.side
        : undefined;
      findings.push({
        kind: "MISSED",
        subject: s,
        competing: null,
        deltas: [],
        category: otherSide
          ? `${s.side} side not on the comparison estimate (it prices the ${otherSide} side only)`
          : "missing on competing",
        ...(otherSide ? { otherSideOnCompeting: otherSide as "left" | "right" } : {}),
      });
      continue;
    }
    const deltas = compareTyped(s, competing[index]);
    if (deltas.length)
      findings.push({
        kind: "VALUE_DELTA",
        subject: s,
        competing: competing[index],
        deltas,
        category:
          deltas[0].field === "part#"
            ? "part number change"
            : `reduced ${laborCategory(s, deltas[0].field as CellField)}`,
        ...(nearVariants.has(s) ? { nearVariant: true } : {}),
      });
  }
  for (const [key, subjects] of aggSubjects) {
    const matched: EstimateRow[] = [];
    competing.forEach((row, index) => {
      if (aggKeyOf(row) === key && !used.has(index) && !isDeduction(row)) {
        used.add(index);
        matched.push(row);
      }
    });
    const sum = (rows: EstimateRow[], field: CellField) => rows.reduce((total, row) => total + (row[field] ?? 0), 0);
    const deltas: CellDelta[] = [];
    for (const field of ["price", "labor", "paint"] as CellField[]) {
      const a = sum(subjects, field);
      const b = sum(matched, field);
      if (Math.abs(a - b) > EPS) deltas.push({ field, subject: a, competing: b });
    }
    if (deltas.length)
      findings.push({
        kind: "QTY_SHORTFALL",
        subject: subjects[0],
        competing: matched[0] ?? null,
        deltas,
        // "2x vs 0x" is a count, not a statement. When the comparison pays the
        // operation ZERO times it is not short on quantity — it does not
        // carry the operation at all, and the callout must say so.
        category:
          matched.length === 0
            ? `not on the comparison estimate (billed ${subjects.length}x here)`
            : `quantity shortfall (${subjects.length}x here vs ${matched.length}x paid)`,
        subjects,
      });
  }
  const competingOnly = competing.filter((_, index) => !used.has(index));
  const pairs = [...paired.entries()].map(([subjectRow, index]) => ({
    subject: subjectRow,
    competing: competing[index],
  }));
  return { findings, competingOnly, pairs };
}

/** Totals pass: iterate the UNION of category rows; hours, rate, and amount each compared. */
export interface TotalsRow {
  category: string;
  hours: number | null;
  rate: number | null;
  amount: number;
}

export interface TotalsDelta {
  category: string;
  field: "hours" | "rate" | "amount";
  subject: number;
  competing: number;
}

export function compareTotals(
  subject: TotalsRow[],
  competing: TotalsRow[],
  canon: (name: string) => string,
  options?: {
    /** Last-resort category match after concept resolution failed (U-2 step d). */
    fuzzyMatch?: (a: string, b: string) => boolean;
    /** Called for every category that resolves on one estimate only — the
     * vocabulary gap must be VISIBLE (unmapped_category), never silent. */
    onUnmapped?: (category: string, presentOn: "subject" | "competing") => void;
  }
): TotalsDelta[] {
  const competingMap = new Map(competing.map((row) => [canon(row.category), row]));
  const out: TotalsDelta[] = [];
  const seen = new Set<string>();
  const seenCompeting = new Set<TotalsRow>();
  for (const s of subject) {
    const key = canon(s.category);
    seen.add(key);
    let u = competingMap.get(key);
    if (!u && options?.fuzzyMatch) {
      u = competing.find((row) => !seenCompeting.has(row) && options.fuzzyMatch!(s.category, row.category));
    }
    if (!u) {
      options?.onUnmapped?.(s.category, "subject");
      out.push({ category: s.category, field: "amount", subject: s.amount, competing: 0 });
      continue;
    }
    seenCompeting.add(u);
    seen.add(canon(u.category));
    // AN UNREAD BASIS IS NOT A ZERO BASIS (R10), IN CLASSIFICATION AND NOT ONLY
    // IN RENDERING.
    //
    // `?? 0` here was the fabrication: a category whose hours or rate could not
    // be read became a category billed at zero, and every downstream consumer
    // then had a real number to compare, stamp and narrate. On the first
    // image-only comparison it produced "$0.00/hr" on every totals stamp and
    // the sentence "at the same $0.00/hr rate" on every hours-delta finding —
    // while the two documents in fact agreed on every rate to the cent
    // ($61 body, $61 refinish, $100 mechanical, $70 frame, $42 materials).
    // "There is no rate dispute" is the single most useful sentence available
    // on that claim, and it was replaced by an invented one.
    //
    // Amount keeps its coalesce: parseTotalsFromWords already resolves a
    // missing amount to 0 by construction, and the category reconciliation
    // (Σ deltas + tax = grand total) is summed over amounts.
    for (const field of ["hours", "rate"] as const) {
      const a = s[field];
      const b = u[field];
      if (a === null || b === null) continue; // unknown — assert nothing
      if (Math.abs(a - b) > EPS) out.push({ category: s.category, field, subject: a, competing: b });
    }
    {
      const a = s.amount ?? 0;
      const b = u.amount ?? 0;
      if (Math.abs(a - b) > EPS) out.push({ category: s.category, field: "amount", subject: a, competing: b });
    }
  }
  for (const u of competing) {
    if (!seen.has(canon(u.category)) && !seenCompeting.has(u)) {
      options?.onUnmapped?.(u.category, "competing");
      out.push({ category: u.category, field: "amount", subject: 0, competing: u.amount });
    }
  }
  return out;
}
