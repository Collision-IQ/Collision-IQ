/**
 * deltaPair — pairing + typed comparison for the delta engine.
 * Pass order (each pass consumes competing rows):
 *   1. PART-NUMBER-FIRST  — identical part number is an unconditional pair.
 *   2. AGG ROUTING        — keys where subject count > competing count skip 1:1
 *                           and compare as sums (qty shortfall), so a 3-line tape
 *                           group compares its total vs a single flat line.
 *   3. CONTEXT-PREFERRED  — same canonical key; candidates ordered by
 *                           (same section, same side). Tailgate clear-coat pairs
 *                           with tailgate clear-coat, never the bumper's.
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

export function pairAndCompare(subject: EstimateRow[], competing: EstimateRow[]): PairResult {
  const used = new Set<number>();
  const paired = new Map<EstimateRow, number>();

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
      if (!used.has(index)) {
        used.add(index);
        paired.set(s, index);
        break;
      }
    }
  }

  // pass 2 — route subject-surplus keys to aggregation
  const count = (rows: { key: string }[], include: (index: number) => boolean) => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (include(index)) map.set(row.key, (map.get(row.key) ?? 0) + 1);
    });
    return map;
  };
  const subjectCount = count(subject, (index) => !paired.has(subject[index]));
  const competingCount = count(competing, (index) => !used.has(index));
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
  for (const s of subject) {
    if (paired.has(s) || aggKeys.has(s.key)) continue;
    const candidates = (byKey.get(s.key) ?? []).filter((index) => !used.has(index));
    candidates.sort((a, b) => {
      const costA = (competing[a].section !== s.section ? 2 : 0) + (competing[a].side !== s.side ? 1 : 0);
      const costB = (competing[b].section !== s.section ? 2 : 0) + (competing[b].side !== s.side ? 1 : 0);
      return costA - costB;
    });
    if (candidates.length) {
      used.add(candidates[0]);
      paired.set(s, candidates[0]);
    }
  }

  // pass 4 — prefix containment for truncated/verbose variants
  for (const s of subject) {
    if (paired.has(s) || aggKeys.has(s.key)) continue;
    for (let index = 0; index < competing.length; index += 1) {
      if (used.has(index)) continue;
      const a = s.key;
      const b = competing[index].key;
      if (a.length >= 12 && b.length >= 12 && (a.startsWith(b) || b.startsWith(a))) {
        used.add(index);
        paired.set(s, index);
        break;
      }
    }
  }

  // emit — 1:1 deltas, MISSED, then aggregated qty shortfalls
  const findings: Finding[] = [];
  const aggSubjects = new Map<string, EstimateRow[]>();
  for (const s of subject) {
    if (aggKeys.has(s.key)) {
      const list = aggSubjects.get(s.key);
      if (list) list.push(s);
      else aggSubjects.set(s.key, [s]);
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
      findings.push({ kind: "MISSED", subject: s, competing: null, deltas: [], category: "missing on competing" });
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
      });
  }
  for (const [key, subjects] of aggSubjects) {
    const matched: EstimateRow[] = [];
    competing.forEach((row, index) => {
      if (row.key === key && !used.has(index)) {
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
