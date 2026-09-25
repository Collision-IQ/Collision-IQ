/**
 * Things a shop manager must resolve BEFORE arguing — none of which the old
 * summary surfaced. Each check returns a plain-language flag; the summary
 * prints them under "Check this first", "Clean up our own sheet" and "Ask the
 * carrier".
 *
 * Every flag names the line numbers it rests on, so it can be checked against
 * the two documents in seconds. A flag is a prompt to verify, never a finding
 * of error: the wording says "confirm", not "wrong".
 */
import type { MatcherPair } from "./argueItems";
import { shopRateFor } from "./gapLedger";
import { classifyNonLabor } from "./nonLaborBuckets";
import { round2, type Estimate, type EstimateLine, type LaborCat } from "./types";

export type FlagKind =
  | "carrierOnlyHighDollar"
  | "trimConflictPartNumber"
  | "partNumberVariant"
  | "duplicatePartNumber"
  | "partWithoutLabor"
  | "reuseMismatch"
  | "laborCategoryMismatch"
  | "duplicateOperation"
  | "zeroPricedCarrierLine";

export interface Flag {
  kind: FlagKind;
  side: "shop" | "carrier" | "both";
  lines: { shop?: number[]; carrier?: number[] };
  dollars?: number;
  text: string;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const normalizePartNumber = (s?: string) => (s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
/** Side-less, op-less stem for matching the SAME component across the two sheets. */
const stem = (s: string) =>
  s.toLowerCase().replace(/\b(rt|lt|repl|r&i|assy|w\/o?|opt|oem)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** First two stem words, with drivetrain/suspension qualifiers removed, so
 *  "RT Axle assy quad-motor" and "RT Axle assy dual/tri motor" meet. */
const baseStem = (s: string) =>
  stem(s)
    .replace(/\b(dual|tri|quad|motor|susp|suspension|external)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 2)
    .join(" ");
/** The full component name with drivetrain/suspension qualifiers removed: the
 *  cross-sheet identity for part-number and reuse checks. (baseStem's first two
 *  words are too coarse there — "air guide clip" and "air guide" would meet.) */
export const qualifierStem = (s: string) =>
  stem(s).replace(/\b(dual|tri|quad|motor|susp|suspension|external)\b/g, "").replace(/\s+/g, " ").trim();
/** Same-sheet repeat key. Keeps the side and the operation (RT and LT wheels,
 *  or Rpr and R&I battery, are two operations), folds "lug"/"wheel" and the
 *  post-repair / safety qualifiers so two torque checks meet. */
const repeatKey = (l: EstimateLine) =>
  `${(l.oper ?? "").toLowerCase()}|${l.desc
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\blug\b/g, "wheel")
    .replace(/\b(post|safety|test|drive|repair)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()}`;

const LABOR_RANK: Record<LaborCat, number> = { body: 1, paint: 1, other: 1, frame: 2, structural: 2, aluminum: 2, mechanical: 3 };

export function integrityChecks(
  shop: Estimate,
  carrier: Estimate,
  opts: { highDollar?: number; pairs?: MatcherPair[] } = {}
): Flag[] {
  const flags: Flag[] = [];
  const highDollar = opts.highDollar ?? 500;
  const shopPartNumbers = new Set(shop.lines.map((l) => normalizePartNumber(l.partNumber)).filter(Boolean));

  // 1. High-dollar carrier lines with no counterpart on our sheet.
  for (const c of carrier.lines) {
    if ((c.price ?? 0) < highDollar) continue;
    const kind = classifyNonLabor(c);
    // Sublet and the rate adjustment are handled by the ledger and the equivalence groups.
    if (kind !== "part" && kind !== "shopSupply") continue;
    const hasPartNumber = Boolean(c.partNumber) && shopPartNumbers.has(normalizePartNumber(c.partNumber));
    const hasDescription = shop.lines.some((s) => baseStem(s.desc) === baseStem(c.desc));
    if (hasPartNumber || hasDescription) continue;
    const samePrice = shop.lines.find((s) => s.price === c.price);
    const samePriceOnCarrier = carrier.lines.find((x) => x !== c && x.price === c.price);
    flags.push({
      kind: "carrierOnlyHighDollar",
      side: "carrier",
      lines: { carrier: [c.line], shop: samePrice ? [samePrice.line] : [] },
      dollars: c.price,
      text:
        `Carrier L${c.line} "${c.desc}" (${money(c.price!)}) is not on our sheet.` +
        (samePrice
          ? ` It carries the same price as our L${samePrice.line} "${samePrice.desc}"` +
            (samePriceOnCarrier ? ` and their own L${samePriceOnCarrier.line} "${samePriceOnCarrier.desc}"` : "") +
            ". Confirm whether it is a separate part or the same part written twice."
          : " Either we are missing it or it was written in error; confirm which before arguing anything else."),
    });
  }

  // 2. Matched components whose part numbers differ; escalate when the carrier's
  //    part contradicts the drivetrain the vehicle line prints.
  const trimMotor = /dual\s+motor/i.test(carrier.vehicle)
    ? "dual"
    : /quad\s+motor/i.test(carrier.vehicle)
      ? "quad"
      : /tri\s+motor/i.test(carrier.vehicle)
        ? "tri"
        : undefined;
  // The same component is the same full name, or a pair the delta matcher made
  // whose names share a stem ("RT Lower molding clip type 1" ↔ "type 2").
  const matcherPartner = new Map<number, number>();
  for (const pair of opts.pairs ?? []) {
    if (pair.carrierLine !== undefined && pair.shopLines.length === 1) matcherPartner.set(pair.carrierLine, pair.shopLines[0]);
  }
  // A variant only when NEITHER number appears anywhere on the other sheet: a
  // part both sheets carry on some line is not a disagreement about the part.
  const carrierPartNumbers = new Set(carrier.lines.map((l) => normalizePartNumber(l.partNumber)).filter(Boolean));
  const variantShopLines = new Set<number>();
  for (const c of carrier.lines) {
    if (!c.partNumber || shopPartNumbers.has(normalizePartNumber(c.partNumber))) continue;
    const differs = (x: EstimateLine) =>
      Boolean(x.partNumber) &&
      normalizePartNumber(x.partNumber) !== normalizePartNumber(c.partNumber) &&
      !carrierPartNumbers.has(normalizePartNumber(x.partNumber));
    const partner = shop.lines.find((x) => x.line === matcherPartner.get(c.line));
    const s =
      shop.lines.find((x) => !variantShopLines.has(x.line) && differs(x) && qualifierStem(x.desc) === qualifierStem(c.desc)) ??
      (partner && differs(partner) && !variantShopLines.has(partner.line) && baseStem(partner.desc) === baseStem(c.desc)
        ? partner
        : undefined);
    if (!s) continue;
    variantShopLines.add(s.line);
    const contradicts =
      trimMotor !== undefined && /(quad|tri|dual)[- ]?motor/i.test(c.desc) && !new RegExp(trimMotor, "i").test(c.desc);
    flags.push({
      kind: contradicts ? "trimConflictPartNumber" : "partNumberVariant",
      side: "both",
      lines: { shop: [s.line], carrier: [c.line] },
      dollars: round2((s.price ?? 0) - (c.price ?? 0)),
      text: contradicts
        ? `Carrier L${c.line} "${c.desc}" (${c.partNumber}) does not match the vehicle line (${trimMotor} motor). We wrote ${s.partNumber} on L${s.line}. Confirm by VIN before anything is ordered.`
        : `Part number differs on "${s.desc}": ours ${s.partNumber} (L${s.line}), theirs ${c.partNumber} (L${c.line}). Confirm the right one by VIN.`,
    });
  }

  // 3. One part number, same quantity and price, on several lines of one sheet
  //    under different descriptions. A shared fastener written for two
  //    positions at different quantities is ordinary and is not flagged.
  for (const e of [shop, carrier]) {
    const byPartNumber = new Map<string, EstimateLine[]>();
    for (const l of e.lines) {
      const partNumber = normalizePartNumber(l.partNumber);
      if (!partNumber) continue;
      const key = `${partNumber}|${l.qty ?? ""}|${l.price ?? ""}`;
      byPartNumber.set(key, [...(byPartNumber.get(key) ?? []), l]);
    }
    for (const [key, lines] of byPartNumber) {
      const partNumber = key.split("|")[0];
      if (lines.length < 2 || new Set(lines.map((l) => stem(l.desc))).size < 2) continue;
      flags.push({
        kind: "duplicatePartNumber",
        side: e.role,
        lines: { [e.role]: lines.map((l) => l.line) },
        dollars: round2(lines.slice(1).reduce((sum, l) => sum + (l.price ?? 0), 0)),
        text: `${e.role === "shop" ? "Our" : "Their"} sheet lists part ${partNumber} on ${lines.length} lines (${lines
          .map((l) => `L${l.line}`)
          .join(", ")}). Confirm each line is a separate location, not the same part written twice.`,
      });
    }
  }

  // 4. The carrier pays the part but no labor, where we wrote labor to install it.
  for (const c of carrier.lines) {
    if (!c.partNumber || (c.hours ?? 0) > 0) continue;
    const s = shop.lines.find(
      (x) => normalizePartNumber(x.partNumber) === normalizePartNumber(c.partNumber) && (x.hours ?? 0) > 0
    );
    if (s) {
      flags.push({
        kind: "partWithoutLabor",
        side: "carrier",
        lines: { shop: [s.line], carrier: [c.line] },
        text: `Carrier pays the ${c.desc} (L${c.line}) with no labor to install it; we wrote ${(s.hours ?? 0).toFixed(1)} hr (L${s.line}).`,
      });
    }
  }

  // 5. The carrier replaces a part its own note says cannot be reused, where we only R&I'd it.
  for (const c of carrier.lines) {
    if (c.oper !== "Repl" || !/cannot be reused/i.test(c.note ?? "")) continue;
    const s = shop.lines.find((x) => x.oper === "R&I" && qualifierStem(x.desc) === qualifierStem(c.desc));
    if (s) {
      flags.push({
        kind: "reuseMismatch",
        side: "shop",
        lines: { shop: [s.line], carrier: [c.line] },
        dollars: -(c.price ?? 0),
        text: `The carrier replaces the ${c.desc} (${money(c.price ?? 0)}, L${c.line}; its note says the part cannot be reused); we wrote R&I on L${s.line}. Add the part.`,
      });
    }
  }

  // 6. Same operation, same hours, different labor category.
  for (const s of shop.lines) {
    if (!s.hours || !s.laborCat) continue;
    const c = carrier.lines.find((x) => x.hours === s.hours && x.laborCat && stem(x.desc) === stem(s.desc));
    if (!c?.laborCat || LABOR_RANK[c.laborCat] === LABOR_RANK[s.laborCat]) continue;
    const weUnderWrite = LABOR_RANK[c.laborCat] > LABOR_RANK[s.laborCat];
    flags.push({
      kind: "laborCategoryMismatch",
      side: weUnderWrite ? "shop" : "carrier",
      lines: { shop: [s.line], carrier: [c.line] },
      // What the coding is worth at OUR rates (their category minus ours).
      dollars: round2(s.hours * (shopRateFor(shop, c.laborCat, 0) - shopRateFor(shop, s.laborCat, 0))),
      text: `${s.desc} (${s.hours.toFixed(1)} hr): ours is coded ${s.laborCat}, theirs ${c.laborCat}${
        weUnderWrite ? "; the carrier's coding pays more for this line" : ""
      }.`,
    });
  }

  // 7. The same operation written more than once on our own sheet.
  const repeats = new Map<string, EstimateLine[]>();
  for (const l of shop.lines) {
    if ((l.hours ?? 0) <= 0) continue;
    const key = repeatKey(l);
    repeats.set(key, [...(repeats.get(key) ?? []), l]);
  }
  for (const [key, lines] of repeats) {
    if (lines.length < 2 || key.length < 5) continue;
    flags.push({
      kind: "duplicateOperation",
      side: "shop",
      lines: { shop: lines.map((l) => l.line) },
      text: `"${lines[0].desc}" is written ${lines.length} times on our sheet (${lines
        .map((l) => `L${l.line}`)
        .join(", ")}). Keep one, or note on each line why it is needed.`,
    });
  }

  // 8. The carrier wrote a manual line with no price where ours carries one.
  for (const c of carrier.lines) {
    if (!((c.qty ?? 0) > 0) || c.price || c.hours || c.paintHours || !c.manual) continue;
    const s = shop.lines.find((x) => stem(x.desc) === stem(c.desc) && (x.price ?? 0) > 0);
    if (s) {
      flags.push({
        kind: "zeroPricedCarrierLine",
        side: "carrier",
        lines: { shop: [s.line], carrier: [c.line] },
        dollars: s.price,
        text: `The carrier wrote "${c.desc}" (L${c.line}) with no price; ours is ${money(s.price!)} (L${s.line}). Ask them to price it.`,
      });
    }
  }
  return flags;
}
