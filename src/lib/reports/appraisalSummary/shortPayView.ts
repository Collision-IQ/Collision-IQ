/**
 * The gross view behind the net gap: what the carrier short-pays on our lines,
 * and what its sheet carries that ours does not.
 *
 * On RO 21995 the printed gap is $2,712.80, but that is a net: the carrier
 * short-pays several thousand dollars of our lines while its own sheet carries
 * lines ours does not (a $1,980 "Damper Module Assembly", mechanical coding of
 * cooling work, water shields). Two large items cancel inside the net, and a
 * reader who sees only the net never asks about either.
 *
 * Every line on both sheets is assigned to exactly one unit — an equivalence
 * group, a matcher pair, a same-part / same-component pair, or a one-sided
 * line — and each unit is valued at OUR rates on both sides. Paint materials
 * and any open labor-rate gap are their own units. The view is returned only
 * when the units plus tax reproduce the printed gap within $0.01; otherwise it
 * is null and nothing is printed.
 */
import { shopLineRate, shopRateFor, unreconciledShopRead, type GapLedger } from "./gapLedger";
import { normalizePartNumber, qualifierStem, separateLocations } from "./integrityChecks";
import { classifyNonLabor } from "./nonLaborBuckets";
import type { MatcherPair } from "./argueItems";
import type { GroupDelta } from "./operationEquivalence";
import { round2, type Estimate, type EstimateLine } from "./types";

export interface ShortPayUnit {
  label: string;
  shopLines: number[];
  carrierLines: number[];
  /** Ours minus theirs, at our rates. Positive = short-paid; negative = carrier-only / carrier pays more. */
  diff: number;
  /** The carrier line the unit is about, when it is not simply the first: the line whose note covers the rest. */
  anchorLine?: number;
}

export interface UnitAssignment {
  /** Every nonzero unit, including paint materials and any open rate gap. */
  units: ShortPayUnit[];
  /** Each one-to-one paired shop line and its carrier line (zero-difference pairs included). */
  shopToCarrier: Map<number, number>;
}

export interface ShortPayView {
  /** Σ positive units. */
  shortPaid: number;
  /** Σ negative units, as a positive figure. */
  carrierOver: number;
  tax: number;
  gap: number;
  over: ShortPayUnit[];
  short: ShortPayUnit[];
}

export function buildShortPayView(params: {
  shop: Estimate;
  carrier: Estimate;
  ledger: GapLedger;
  groups: GroupDelta[];
  pairs: MatcherPair[];
}): ShortPayView | null {
  const { ledger } = params;
  // "Lines ours does not have" needs every line of ours read.
  if (unreconciledShopRead(ledger)) return null;
  const { units } = assignUnits(params);
  const total = round2(units.reduce((sum, u) => sum + u.diff, 0) + ledger.tax);
  // The line read must account for every printed hour and dollar, or the
  // gross figures would be describing a different estimate.
  if (Math.abs(total - ledger.gap) > 0.01) return null;
  const short = units.filter((u) => u.diff > 0).sort((a, b) => b.diff - a.diff);
  const over = units.filter((u) => u.diff < 0).sort((a, b) => a.diff - b.diff);
  return {
    shortPaid: round2(short.reduce((sum, u) => sum + u.diff, 0)),
    carrierOver: round2(-over.reduce((sum, u) => sum + u.diff, 0)),
    tax: ledger.tax,
    gap: ledger.gap,
    over,
    short,
  };
}

/** Assign every line on both sheets to one unit, valued at our rates. */
export function assignUnits(params: {
  shop: Estimate;
  carrier: Estimate;
  ledger: GapLedger;
  groups: GroupDelta[];
  pairs: MatcherPair[];
}): UnitAssignment {
  const { shop, carrier, ledger, groups, pairs } = params;
  const shopToCarrier = new Map<number, number>();
  const paintRate = shopRateFor(shop, "paint", 0);
  const value = (l: EstimateLine) =>
    (l.hours ?? 0) * shopLineRate(shop, l) +
    (l.paintHours ?? 0) * paintRate +
    (classifyNonLabor(l) === "rateAdjustment" ? 0 : l.price ?? 0);
  const shopBy = new Map(shop.lines.map((l) => [l.line, l]));
  const carrierBy = new Map(carrier.lines.map((l) => [l.line, l]));
  const usedShop = new Set<number>();
  const usedCarrier = new Set<number>();
  const units: ShortPayUnit[] = [];
  const add = (label: string, s: EstimateLine[], c: EstimateLine[], anchorLine?: number) => {
    s.forEach((l) => usedShop.add(l.line));
    c.forEach((l) => usedCarrier.add(l.line));
    // Only a one-to-one pair locates a line: a group spans many lines on both
    // sheets, and a neighbour inside it says nothing about where on the other
    // sheet the next line sits.
    if (c.length === 1 && s.length === 1) shopToCarrier.set(s[0].line, c[0].line);
    const diff = round2(s.reduce((sum, l) => sum + value(l), 0) - c.reduce((sum, l) => sum + value(l), 0));
    // A negative line on our sheet alone (an overlap deduction) lowers ours; it
    // is not something the carrier wrote, and the label says so.
    const ownDeduction = !c.length && diff < 0;
    if (diff !== 0) {
      units.push({
        label: ownDeduction ? `${label} (a deduction on our sheet)` : label,
        shopLines: s.map((l) => l.line),
        carrierLines: c.map((l) => l.line),
        diff,
        ...(anchorLine !== undefined ? { anchorLine } : {}),
      });
    }
  };

  for (const group of groups) {
    add(
      group.label,
      group.shopLines.map((n) => shopBy.get(n)!).filter(Boolean),
      group.carrierLines.map((n) => carrierBy.get(n)!).filter(Boolean)
    );
  }
  for (const pair of pairs) {
    if (pair.carrierLine === undefined || usedCarrier.has(pair.carrierLine)) continue;
    const s = pair.shopLines.filter((n) => !usedShop.has(n)).map((n) => shopBy.get(n)).filter((l): l is EstimateLine => Boolean(l));
    const c = carrierBy.get(pair.carrierLine);
    if (!s.length || !c) continue;
    // Their lines whose own note says they are included in this one are part
    // of the same unit. Left loose, a 0.0 hr "Pre-repair scan" would pair by
    // its words with our "In-Proc repair scan" further down.
    const also = pair.coveredByCarrierNote
      ? (pair.coveredCarrierLines ?? [])
          .filter((n) => n !== c.line && !usedCarrier.has(n))
          .map((n) => carrierBy.get(n))
          .filter((l): l is EstimateLine => Boolean(l))
      : [];
    // Their one line whose note covers several of ours is named for itself,
    // and the unit sits on that line, where the note is printed. The label is
    // read on its own, so it says only that our lines are compared with it:
    // the entry says which of them the note's words name.
    const covering = pair.coveredByCarrierNote && (s.length > 1 || also.length > 0);
    add(covering ? `${c.desc} and the lines compared with it` : s[0].desc, s, [c, ...also], covering ? c.line : undefined);
  }
  // What the matcher did not report as a difference pairs here by part number,
  // then by full component name and operation; the rest is one-sided. No pass
  // pairs across printed positions: the same name on the RT and the LT wheel,
  // or on the upper and the lower cover, is two lines, not one priced twice.
  const restShop = () => shop.lines.filter((l) => !usedShop.has(l.line));
  for (const s of restShop()) {
    const key = normalizePartNumber(s.partNumber);
    if (!key) continue;
    const c = carrier.lines.find(
      (x) => !usedCarrier.has(x.line) && normalizePartNumber(x.partNumber) === key && !separateLocations(s, x)
    );
    if (c) add(s.desc, [s], [c]);
  }
  for (const s of restShop()) {
    const name = qualifierStem(s.desc);
    if (!name) continue;
    const c = carrier.lines.find(
      (x) =>
        !usedCarrier.has(x.line) &&
        (x.oper ?? "") === (s.oper ?? "") &&
        qualifierStem(x.desc) === name &&
        !separateLocations(s, x)
    );
    if (c) add(s.desc, [s], [c]);
  }
  // Same work in different words ("Set back wiring" / "Set back wiring/modules
  // for frame set up", "Four wheel suspension alignment" / "Align
  // suspension"): at least two shared significant words, most of the shorter
  // description, and never across printed positions.
  // Best matches first across the whole sheet (highest word overlap, then the
  // closest value), so a 0.3 hr "Set back, secure wiring" never takes the
  // 4.0 hr set-back line that a 4.0 hr "Set back wiring" matches exactly.
  const candidates: Array<{ s: EstimateLine; c: EstimateLine; score: number; gapAbs: number }> = [];
  for (const s of restShop()) {
    const a = words(s.desc);
    if (a.size < 2) continue;
    for (const c of carrier.lines) {
      if (usedCarrier.has(c.line) || separateLocations(s, c)) continue;
      const b = words(c.desc);
      const shared = [...a].filter((w) => b.has(w)).length;
      const score = shared / Math.min(a.size, b.size);
      if (shared >= 2 && score >= 0.6) candidates.push({ s, c, score, gapAbs: Math.abs(value(s) - value(c)) });
    }
  }
  candidates.sort((x, y) => y.score - x.score || x.gapAbs - y.gapAbs);
  for (const { s, c } of candidates) {
    if (usedShop.has(s.line) || usedCarrier.has(c.line)) continue;
    add(s.desc, [s], [c]);
  }
  // A one-sided line keeps its printed operation. "LT Upper cover" alone,
  // beside our Rpr of the same cover, read as if our sheet had no line for it
  // (RO 22120: their R&I upper cover; our O/H bumper assy read "bumper assy").
  for (const s of restShop()) add(withOperation(s), [s], []);
  for (const c of carrier.lines.filter((l) => !usedCarrier.has(l.line))) add(withOperation(c), [], [c]);
  if (ledger.paintMaterials !== 0) units.push({ label: "Paint materials", shopLines: [], carrierLines: [], diff: ledger.paintMaterials });
  if (ledger.otherMaterials !== 0) units.push({ label: "Other materials", shopLines: [], carrierLines: [], diff: ledger.otherMaterials });
  if ((ledger.totalsAdjustments ?? 0) !== 0) units.push({ label: "Totals-block adjustments", shopLines: [], carrierLines: [], diff: ledger.totalsAdjustments });
  if (ledger.laborRate !== 0) units.push({ label: "Labor rate", shopLines: [], carrierLines: [], diff: ledger.laborRate });
  return { units, shopToCarrier };
}

/** The line as printed: its operation, then its description ("R&I LT Upper cover"). */
function withOperation(l: EstimateLine): string {
  const oper = (l.oper ?? "").trim();
  return oper && !l.desc.toLowerCase().startsWith(`${oper.toLowerCase()} `) ? `${oper} ${l.desc}` : l.desc;
}

const STOP = new Set(["for", "and", "the", "of", "to", "into", "per", "on", "with", "from", "plus", "rt", "lt", "assy", "repl", "rpr"]);
/** Significant words, stemmed to five letters so "alignment" meets "align". */
function words(desc: string): Set<string> {
  return new Set(
    desc
      .toLowerCase()
      .replace(/[^a-z]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.slice(0, 5))
  );
}
