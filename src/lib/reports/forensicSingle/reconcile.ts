import type { NormalizedEstimate, Reconciliation, ReconciliationRow } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Rebuild every printed total from the line grid. Closure standard is
 * $0.00 unexplained; anything else becomes a RECONCILIATION finding.
 *
 * Column-band ambiguity (CCC prints manual misc lines whose hours can land in
 * the paint band) is resolved by trying the ambiguous lines in the other
 * column and keeping the assignment that closes both labor subtotals.
 */
export function reconcile(est: NormalizedEstimate): Reconciliation {
  const notes: string[] = [];
  const t = est.totals;

  const bodyPrinted = t.labor.find(l => l.category === "BODY")?.hours ?? 0;
  const refPrinted = t.labor.find(l => l.category === "REFINISH")?.hours ?? 0;
  const mechPrinted = t.labor.find(l => l.category === "MECH")?.hours ?? 0;

  let body = 0, ref = 0, mech = 0;
  const ambiguous: { idx: number; hrs: number }[] = [];
  est.lines.forEach((ln, idx) => {
    if (ln.laborHrs != null) {
      if (ln.laborType === "MECH") mech += ln.laborHrs;
      else if (ln.laborType === "REFINISH") ref += ln.laborHrs;
      else body += ln.laborHrs;
    }
    if (ln.paintHrs != null) {
      ref += ln.paintHrs;
      if (ln.manual && ln.laborHrs == null && ln.section.toUpperCase().includes("MISC")) {
        ambiguous.push({ idx, hrs: ln.paintHrs });
      }
    }
  });

  // No printed mechanical category: M-flagged hours were billed at the body rate.
  if (!t.labor.some(l => l.category === "MECH") && mech > 0) {
    body += mech; mech = 0;
    notes.push("Mechanical-flagged hours are billed within Body Labor (no separate mechanical category printed).");
  }

  // Try flipping ambiguous misc lines paint->body if that closes both columns.
  if (r1(body) !== r1(bodyPrinted) || r1(ref) !== r1(refPrinted)) {
    for (const a of ambiguous) {
      if (r1(body + a.hrs) === r1(bodyPrinted) && r1(ref - a.hrs) === r1(refPrinted)) {
        body += a.hrs; ref -= a.hrs;
        const ln = est.lines[a.idx];
        notes.push(`Line ${ln.lineNo ?? "?"} (${ln.desc}, ${a.hrs.toFixed(1)}) prints in the refinish band but books as body labor for the printed subtotals to close.`);
        ln.laborHrs = a.hrs; ln.paintHrs = null; ln.laborType = "BODY";
      }
    }
  }

  // Dollars
  let partsUntaxedMisc = 0, taxedMisc = 0, other = 0;
  for (const ln of est.lines) {
    if (ln.price == null) continue;
    const sec = ln.section.toUpperCase();
    if (sec.includes("OTHER CHARGES")) other += ln.price;
    else if (ln.taxed) taxedMisc += ln.price;
    else partsUntaxedMisc += ln.price;
  }

  const bodyRate = t.labor.find(l => l.category === "BODY")?.rate ?? 0;
  const refRate = t.labor.find(l => l.category === "REFINISH")?.rate ?? 0;
  const mechRate = t.labor.find(l => l.category === "MECH")?.rate ?? bodyRate;
  const supRate = t.paintSupplies?.rate ?? 0;

  const rows: ReconciliationRow[] = [];
  const push = (category: string, rebuiltFrom: string, rebuilt: number, printed: number) =>
    rows.push({ category, rebuiltFrom, rebuilt: r2(rebuilt), printed: r2(printed), variance: r2(rebuilt - printed) });

  push("Body labor (hrs)", "sum of body-column hours", r1(body), bodyPrinted);
  push("Refinish labor (hrs)", "sum of paint-column hours incl. clear coat, overlap, tint", r1(ref), refPrinted);
  if (mechPrinted || mech) push("Mechanical labor (hrs)", "sum of M-flagged hours", r1(mech), mechPrinted);
  // The taxed-charge marker and the OTHER CHARGES section are how CCC splits
  // priced lines across Parts / Miscellaneous / Other. A document (or an
  // extraction) that carries neither cannot be split the same way; compare
  // the priced lines as one pool so a missing marker never reads as a
  // reconciliation failure it is not.
  const hasTaxMarkers = est.lines.some(ln => ln.taxed);
  const hasOtherSection = est.lines.some(ln => ln.section.toUpperCase().includes("OTHER CHARGES"));
  if (hasTaxMarkers && hasOtherSection) {
    push("Parts + untaxed misc ($)", "priced lines without T flag, outside OTHER CHARGES", partsUntaxedMisc, t.parts);
    push("Taxed misc ($)", "priced lines with T flag", taxedMisc, t.misc);
    push("Other charges ($)", "OTHER CHARGES section", other, t.other);
  } else if (hasTaxMarkers) {
    push("Parts + untaxed misc + other ($)", "priced lines without T flag", partsUntaxedMisc + other, t.parts + t.other);
    push("Taxed misc ($)", "priced lines with T flag", taxedMisc, t.misc);
    if (t.other) notes.push("No OTHER CHARGES section was read; other charges are pooled with parts for the closure test.");
  } else {
    push("Parts + misc + other ($)", "all priced lines (no taxed-charge markers read)", partsUntaxedMisc + taxedMisc + other, t.parts + t.misc + t.other);
    if (t.misc || t.other) notes.push("No taxed-charge markers were read; parts, miscellaneous and other charges are pooled for the closure test.");
  }

  const laborCost = r2(body * bodyRate + ref * refRate + mech * mechRate);
  const printedLabor = r2(t.labor.reduce((s, l) => s + l.cost, 0));
  push("Labor dollars ($)", "hours x printed rates", laborCost, printedLabor);

  if (t.paintSupplies) {
    push("Paint supplies ($)", `${t.paintSupplies.hours} hrs x $${supRate}`, t.paintSupplies.hours * supRate, t.paintSupplies.cost);
  }

  const subtotal = r2(t.parts + printedLabor + (t.paintSupplies?.cost ?? 0) + t.misc + t.other);
  push("Subtotal ($)", "parts + labor + supplies + misc + other", subtotal, t.subtotal);

  if (t.salesTax) {
    push("Sales tax ($)", `${t.salesTax.ratePct}% x $${t.salesTax.basis.toFixed(2)}`, t.salesTax.basis * t.salesTax.ratePct / 100, t.salesTax.amount);
  }
  push("Grand total ($)", "subtotal + tax", t.subtotal + (t.salesTax?.amount ?? 0), t.grandTotal);
  if (t.deductible != null && t.netCost != null) {
    push("Net cost ($)", "grand total - deductible", t.grandTotal - t.deductible, t.netCost);
  }

  const unexplained = r2(rows.reduce((s, r) => s + Math.abs(r.variance), 0));
  return { rows, unexplained, notes, clearCoatCheck: clearCoatCheck(est) };
}

/**
 * CCC clear-coat convention: first major panel 40% of refinish time, each
 * additional panel 20%, computed after overlap netting, rounded to 0.1.
 */
export function clearCoatCheck(est: NormalizedEstimate): string[] {
  const out: string[] = [];
  const panels = panelRefinishGroups(est);
  panels.forEach((p, i) => {
    if (p.clearCoat == null) return;
    const net = r1(p.base + p.overlap);
    const pct = i === 0 ? 0.4 : 0.2;
    const expect = r1(net * pct);
    const ok = Math.abs(expect - p.clearCoat) <= 0.1;
    out.push(`${p.section}: (${p.base}${p.overlap ? ` ${p.overlap}` : ""}) x ${pct * 100}% = ${expect.toFixed(1)}, written ${p.clearCoat.toFixed(1)} (${ok ? "correct" : "CHECK"})`);
  });
  return out;
}

export interface PanelGroup { section: string; base: number; overlap: number; clearCoat: number | null; repairHrs: number | null; oper: string; }

export function panelRefinishGroups(est: NormalizedEstimate): PanelGroup[] {
  const groups: PanelGroup[] = [];
  let cur: PanelGroup | null = null;
  for (const ln of est.lines) {
    const d = ln.desc.toLowerCase();
    if ((ln.oper === "RPR" || ln.oper === "REPL" || ln.oper === "REFN") && ln.paintHrs != null && !d.includes("clear coat")) {
      cur = { section: ln.section, base: ln.paintHrs, overlap: 0, clearCoat: null, repairHrs: ln.oper === "RPR" ? ln.laborHrs : null, oper: ln.oper };
      groups.push(cur);
      continue;
    }
    if (!cur || ln.section !== cur.section) continue;
    if (d.includes("overlap") && ln.paintHrs != null) cur.overlap += ln.paintHrs;
    if (d.includes("clear coat") && ln.paintHrs != null && cur.clearCoat == null) cur.clearCoat = ln.paintHrs;
  }
  return groups;
}
