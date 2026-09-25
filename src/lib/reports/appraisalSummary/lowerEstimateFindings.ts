/**
 * Findings for the Delta Citation Density copy of the LOWER estimate.
 *
 * The citation document marks up the carrier's own estimate, because that is
 * the document the supplement answers: each of its values we wrote
 * differently is highlighted with our value stamped beside it, and a numbered
 * badge on the line points to the findings index.
 *
 * The findings are the same units the Appraisal Dispute Report's gross view
 * is built from (every line on both sheets, valued at our rates), so the two
 * documents cannot disagree. One finding per carrier line: every unit, flag
 * and stamp that lands on that line shares its badge. A unit with no carrier
 * line (work only we wrote) sits on the carrier line its nearest paired
 * neighbour on our sheet maps to, which is where the reader looks for it.
 */
import type { PlainSummaryModel } from "../plainLanguageSummary";
import type { ArgueItem, MatcherPair } from "./argueItems";
import { assignUnits, type ShortPayUnit } from "./shortPayView";
import type { EstimateLine, LaborCat } from "./types";
import { round2 } from "./types";

export type StampField = "labor" | "paint" | "price";

export interface LowerStamp {
  field: StampField;
  /** Our value, as it would print in that column. */
  value: string;
}

export interface LowerEntry {
  kind: "short" | "over" | "check";
  text: string;
  /** Ours minus theirs at our rates; absent on a check. */
  amount?: number;
}

export interface LowerFinding {
  /** Badge number in carrier-line order; 0 = a smaller difference, stamped but not badged. */
  number: number;
  carrierLine: number;
  entries: LowerEntry[];
  stamps: LowerStamp[];
}

export interface LowerFindingSet {
  findings: LowerFinding[];
  /** Units with no line on either side to sit on (paint materials, an open rate gap). */
  unanchored: LowerEntry[];
}

/** Smallest difference on one carrier line that earns a numbered badge. */
export const BADGE_MIN = 50;

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const CAT_SHORT: Record<LaborCat, string> = { body: "", paint: "", mechanical: " M", frame: " F", structural: " S", aluminum: " Alum", other: "" };

export function buildLowerEstimateFindings(model: PlainSummaryModel, pairs: MatcherPair[]): LowerFindingSet {
  const { shop, carrier } = model;
  const { units, shopToCarrier } = assignUnits({
    shop,
    carrier,
    ledger: model.ledger,
    groups: model.groups,
    pairs,
  });
  const shopBy = new Map(shop.lines.map((l) => [l.line, l]));
  const carrierBy = new Map(carrier.lines.map((l) => [l.line, l]));
  const paired = [...shopToCarrier.keys()].sort((a, b) => a - b);

  // Nearest paired neighbour on our sheet, preceding first: the carrier line a
  // reader of their estimate would be looking at for this work.
  const neighbourAnchor = (shopLine: number): number | null => {
    let before: number | null = null;
    let after: number | null = null;
    for (const line of paired) {
      if (line <= shopLine) before = line;
      else if (after === null) after = line;
    }
    const pick =
      before === null ? after : after === null ? before : shopLine - before <= after - shopLine ? before : after;
    return pick === null ? null : shopToCarrier.get(pick) ?? null;
  };

  const byLine = new Map<number, LowerFinding>();
  const unanchored: LowerEntry[] = [];
  const findingAt = (line: number) => {
    let finding = byLine.get(line);
    if (!finding) {
      finding = { number: 0, carrierLine: line, entries: [], stamps: [] };
      byLine.set(line, finding);
    }
    return finding;
  };

  for (const unit of units) {
    const entry: LowerEntry = { kind: unit.diff > 0 ? "short" : "over", text: describeUnit(unit, shopBy, carrierBy, model.items), amount: unit.diff };
    const anchor = unit.carrierLines.length
      ? Math.min(...unit.carrierLines)
      : unit.shopLines.length
        ? neighbourAnchor(Math.min(...unit.shopLines))
        : null;
    if (anchor === null) {
      unanchored.push(entry);
      continue;
    }
    const finding = findingAt(anchor);
    finding.entries.push(entry);
    finding.stamps.push(...stampsFor(unit, shopBy, carrierBy));
  }

  // Checks the carrier must answer, on the line they concern.
  const checks = [...model.facts.checkFirst, ...model.facts.askCarrier];
  for (const flag of checks) {
    const line = flag.lines.carrier?.[0];
    if (line === undefined || !carrierBy.has(line)) continue;
    findingAt(line).entries.unshift({ kind: "check", text: flag.text });
  }

  const findings = [...byLine.values()].sort((a, b) => a.carrierLine - b.carrierLine);
  let next = 1;
  for (const finding of findings) {
    // Largest money first within a line; checks lead.
    finding.entries.sort(
      (a, b) => (a.kind === "check" ? -1 : 0) - (b.kind === "check" ? -1 : 0) || Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0)
    );
    // A badge is for something worth raising: a check the carrier must answer,
    // or differences on the line worth at least BADGE_MIN at our rates. The rest
    // is still highlighted and stamped, and listed in the index without a number.
    const weight = finding.entries.reduce((sum, e) => sum + Math.abs(e.amount ?? 0), 0);
    finding.number = finding.entries.some((e) => e.kind === "check") || weight >= BADGE_MIN ? next++ : 0;
  }
  return { findings, unanchored };
}

function sideText(lines: EstimateLine[]): string {
  const hours = round2(lines.reduce((sum, l) => sum + (l.hours ?? 0), 0));
  const paint = round2(lines.reduce((sum, l) => sum + (l.paintHours ?? 0), 0));
  const price = round2(lines.reduce((sum, l) => sum + (l.price ?? 0), 0));
  const parts = [
    hours ? `${hours.toFixed(1)} hr${lines.length === 1 && lines[0].laborCat ? CAT_SHORT[lines[0].laborCat] : ""}` : "",
    paint ? `${paint.toFixed(1)} paint` : "",
    price ? money(price) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no hours or price";
}

function describeUnit(
  unit: ShortPayUnit,
  shopBy: Map<number, EstimateLine>,
  carrierBy: Map<number, EstimateLine>,
  items: ArgueItem[]
): string {
  const ours = unit.shopLines.map((n) => shopBy.get(n)).filter((l): l is EstimateLine => Boolean(l));
  const theirs = unit.carrierLines.map((n) => carrierBy.get(n)).filter((l): l is EstimateLine => Boolean(l));
  const refs = (lines: number[]) => lines.map((n) => `L${n}`).join(", ");
  // The ranked item that covers these lines supplies its strength and the proof it needs.
  const item = items.find((i) => i.shopLines.some((n) => unit.shopLines.includes(n)));
  const strength = item ? ` [${item.strength.toUpperCase()}]` : "";
  if (!ours.length && !theirs.length) return `${unit.label}: ${money(Math.abs(unit.diff))} ${unit.diff > 0 ? "short" : "over"}.`;
  if (!theirs.length) {
    return `Ours ${refs(unit.shopLines)} ${unit.label} (${sideText(ours)}): not on this estimate, ${money(unit.diff)} at our rates.${strength}`;
  }
  if (!ours.length) {
    return `${unit.label} (${sideText(theirs)}): on this estimate only, ${money(-unit.diff)}. Not on ours.`;
  }
  return `${unit.label}: ours ${sideText(ours)} (${refs(unit.shopLines)}) vs this estimate's ${sideText(theirs)}; ${
    unit.diff > 0 ? `short ${money(unit.diff)}` : `this estimate is higher by ${money(-unit.diff)}`
  }.${strength}`;
}

/** Our value in each column that differs, for a one-line-to-one-line unit. */
function stampsFor(unit: ShortPayUnit, shopBy: Map<number, EstimateLine>, carrierBy: Map<number, EstimateLine>): LowerStamp[] {
  if (unit.shopLines.length !== 1 || unit.carrierLines.length !== 1) return [];
  const s = shopBy.get(unit.shopLines[0]);
  const c = carrierBy.get(unit.carrierLines[0]);
  if (!s || !c) return [];
  const stamps: LowerStamp[] = [];
  const sh = s.hours ?? 0;
  const ch = c.hours ?? 0;
  if (sh !== ch || (sh && s.laborCat !== c.laborCat)) {
    stamps.push({ field: "labor", value: `${sh.toFixed(1)}${s.laborCat ? CAT_SHORT[s.laborCat] || (s.laborCat !== c.laborCat ? " Body" : "") : ""}` });
  }
  if ((s.paintHours ?? 0) !== (c.paintHours ?? 0)) stamps.push({ field: "paint", value: (s.paintHours ?? 0).toFixed(1) });
  if ((s.price ?? 0) !== (c.price ?? 0)) {
    stamps.push({ field: "price", value: (s.price ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
  }
  return stamps;
}
