/**
 * "Items worth arguing": the hours and parts differences left after the
 * equivalence groups, ranked by what they are worth at OUR rates and labelled
 * by how strong the proof on the page already is.
 *
 *   Strong      — the carrier's own document supports our side: an exclusion
 *                 note on its line, a part it pays with no labor to install it,
 *                 or a parent part it pays whose child it left off (wheels
 *                 paid, tires not).
 *   Needs proof — an operation with no counterpart, or fewer hours (or a
 *                 lower price) on the paired line; it needs a P-page, an
 *                 invoice or an OEM procedure before it is argued.
 *   Weak        — reserved for an operation a retrieved P-page shows is
 *                 included in a database operation the carrier wrote.
 *
 * An operation that MAY be included in the carrier's operation on the same
 * assembly (caliper R&I under a hub replacement or a suspension overhaul) is
 * "Needs proof" with the P-page named: neither "included" nor "not included"
 * is printed until the guide text is retrieved.
 *
 * The pairing is the delta matcher's (passed in as `pairs`); this module never
 * re-pairs lines. It only removes what the equivalence groups already
 * explained and what the integrity pass sends to "clean up our own sheet".
 */
import { shopLineRate, shopRateFor } from "./gapLedger";
import type { Flag } from "./integrityChecks";
import type { GroupDelta } from "./operationEquivalence";
import { round2, type Estimate, type EstimateLine } from "./types";

export type Strength = "Strong" | "Needs proof" | "Weak";

/** A difference the delta matcher found, by line number. */
export interface MatcherPair {
  /** "matched": paired at equal values — it locates a line, it is never argued. */
  kind: "missing" | "reduced" | "matched";
  shopLines: number[];
  carrierLine?: number;
  /** The carrier line's own note says it includes the work on these shop lines. */
  coveredByCarrierNote?: boolean;
  /** Other carrier lines whose own note says they are included in `carrierLine`. */
  coveredCarrierLines?: number[];
  /** Covered shop lines the note's words do not name: counted with it by inference. */
  inferredShopLines?: number[];
}

/**
 * What a carrier line's inclusion note establishes, and what it does not, in
 * one wording for every report: the lines whose own notes point back to it,
 * which of our lines the note's words name and which are counted with it by
 * inference only, and that the note neither divides its hours among those
 * steps nor says each one is paid.
 */
export function noteCoverScope(params: {
  /** The note-bearing carrier line's hours. */
  hours: number;
  /** Carrier lines whose own note says they are included in it. */
  crossRefs: Array<{ line: number; hours: number; note: string }>;
  named: number[];
  inferred: number[];
  /** How their lines and ours are introduced: "Their" / "our ", "Its" / "". */
  theirs: string;
  ours: string;
  /**
   * How a line on THEIR sheet is cited, in the citing document's own
   * notation: "L" by default; the lower-estimate citation copy marks up their
   * sheet and cites its lines as "Ln " (its legend keeps "L" for ours).
   */
  theirLinePrefix?: string;
}): string {
  const refs = (lines: number[]) => lines.map((line) => `L${line}`).join(", ");
  const theirLine = (line: number) => `${params.theirLinePrefix ?? "L"}${line}`;
  const sentences: string[] = [];
  const { crossRefs } = params;
  if (crossRefs.length) {
    const many = crossRefs.length > 1;
    const hours = new Set(crossRefs.map((ref) => ref.hours.toFixed(1)));
    const notes = new Set(crossRefs.map((ref) => ref.note));
    sentences.push(
      hours.size === 1 && notes.size === 1
        ? `${params.theirs} ${crossRefs.map((ref) => theirLine(ref.line)).join(", ")} ${many ? "print" : "prints"} ${crossRefs[0].hours.toFixed(1)} hr, ${many ? "each " : ""}noted "${crossRefs[0].note}".`
        : `${params.theirs} ${crossRefs.map((ref) => `${theirLine(ref.line)} prints ${ref.hours.toFixed(1)} hr, noted "${ref.note}"`).join("; ")}.`
    );
  }
  const inferred = params.inferred.length ? `${params.ours}${refs(params.inferred)}` : "";
  const one = params.inferred.length === 1;
  if (params.named.length) {
    sentences.push(
      `The note's words name the work on ${params.ours}${refs(params.named)}` +
        (inferred ? `; ${inferred} ${one ? "is" : "are"} counted with it by inference only, which the note does not state.` : ".")
    );
  } else if (inferred) {
    sentences.push(`The note's words do not name ${inferred}; ${one ? "it is" : "they are"} counted with it by inference only.`);
  }
  sentences.push(`The note does not say how its ${params.hours.toFixed(1)} hr divides among these steps or that each step is paid.`);
  return sentences.join(" ");
}

export interface ArgueItem {
  strength: Strength;
  title: string;
  detail: string;
  hours: number;
  /** Labor at our category rates plus the price difference: a part we wrote and they did not, or our price over theirs on a paired line. */
  value: number;
  shopLines: number[];
  carrierLines: number[];
}

/** A child part the carrier leaves off while paying its parent. */
const PARENT_PARTS: Array<{ child: RegExp; exclude: RegExp; parent: RegExp; parentExclude: RegExp; companion: RegExp; label: string }> = [
  {
    // A tire line names the tire, a brand, or only the tire size: RO 21548's
    // carrier wrote "Rt Frnt Westlake SA07 Sport 255/45r19 100v +25%", with
    // no word "tire" and a brand off the list, and the report told the shop
    // they pay no tire.
    child: /\b(tires?|tyres?|pirelli|michelin|goodyear|continental|bridgestone)\b|\bP?\d{3}\/\d{2}\s*Z?R\s*\d{2}\b/i,
    exclude: /disposal|balance|mount/i,
    parent: /\bwheel\b/i,
    // Parts named after the wheel that no tire mounts on. RO 21548 cited the
    // carrier's wheel opening moldings and wheel cover as "the parts the
    // tires mount on".
    parentExclude: /\b(opng|opening|mldgs?|moldings?|mouldings?|flares?|liners?|covers?|caps?|arch|well|housing|alignment|align|locks?|lugs?|nuts?|bolts?|studs?|sensors?|bearings?|hubs?|speed|weights?)\b/i,
    // Work that exists only because the child part is replaced: it rides with
    // the child, net of whatever the carrier already pays for it.
    companion: /\b(balance|tire\s+disposal)\b/i,
    label: "tires",
  },
];

/** A component operation that database time on a parent operation usually includes. */
const INCLUDED_UNDER: Array<{ component: RegExp; parent: RegExp; label: string }> = [
  { component: /\bcaliper\b/i, parent: /\bo\/h\b.*\bsusp|\bhub\s+assy\b/i, label: "the carrier's suspension overhaul / hub replacement" },
];

const STRENGTH_ORDER: Record<Strength, number> = { Strong: 0, "Needs proof": 1, Weak: 2 };

export function argueItems(params: {
  shop: Estimate;
  carrier: Estimate;
  groups: GroupDelta[];
  usedShop: Set<number>;
  flags: Flag[];
  pairs: MatcherPair[];
  /** Some of the carrier's printed dollars sit on lines whose price was not read. */
  carrierLinesIncomplete?: boolean;
}): ArgueItem[] {
  const { shop, carrier, groups, usedShop, flags, pairs } = params;
  // Part of their sheet unread — a price cell not read, or a whole row not
  // read, which the ledger cannot tell apart: any line of ours may have its
  // counterpart on a line that was not read, and any group may be missing one
  // of theirs. No item is argued; the ledger still closes on printed totals.
  if (params.carrierLinesIncomplete === true) return [];
  const shopLine = new Map(shop.lines.map((l) => [l.line, l]));
  const carrierLine = new Map(carrier.lines.map((l) => [l.line, l]));
  const paintRate = shopRateFor(shop, "paint", 0);
  const laborValue = (l: EstimateLine | undefined) =>
    l ? (l.hours ?? 0) * shopLineRate(shop, l) + (l.paintHours ?? 0) * paintRate : 0;
  const hoursOf = (l: EstimateLine | undefined) => (l ? (l.hours ?? 0) + (l.paintHours ?? 0) : 0);

  const items: ArgueItem[] = [];
  const claimed = new Set<number>(usedShop);

  // Lines the integrity pass sends to "clean up our own sheet": every repeat
  // after the first is ours to fix, not theirs to pay.
  for (const flag of flags) {
    if (flag.kind === "duplicateOperation") (flag.lines.shop ?? []).slice(1).forEach((line) => claimed.add(line));
  }

  // Equal hours with a dollar difference is priced lines (sublet, parts), not
  // labor coding: RO 22335's ADAS group was 0.5 hr each side and $764.45 apart.
  const priceOf = (lines: number[], byLine: Map<number, EstimateLine>) =>
    round2(lines.reduce((sum, line) => sum + (byLine.get(line)?.price ?? 0), 0));
  const pricedDetail = (group: GroupDelta): string | null => {
    const ours = priceOf(group.shopLines, shopLine);
    const theirs = priceOf(group.carrierLines, carrierLine);
    if (ours === theirs) return null;
    return `Ours ${group.shopHours.toFixed(1)} hr, theirs ${group.carrierHours.toFixed(1)} hr: the same hours. The difference is in the priced lines: ours ${money(ours)}, theirs ${theirs > 0 ? money(theirs) : "none priced"}.`;
  };

  // Strong — the carrier's own exclusion note on an equivalence group.
  for (const group of groups) {
    const diff = round2(group.shopValue - group.carrierValue);
    if (diff <= 0) continue;
    const excluded = group.exclusions.length > 0;
    const sides = `Ours ${group.shopHours.toFixed(1)} hr, theirs ${group.carrierHours.toFixed(1)} hr`;
    const detail = excluded
      ? `${sides}. Their own line says the time ${group.exclusions[0].toLowerCase()}.`
      : group.shopHours === 0 && group.carrierHours === 0
        ? group.carrierValue === 0 && group.carrierLines.length > 0
          ? // Written but not priced ("Subl Pre-repair scan 1 m", RO 22335):
            // open for invoice, which is not a $0.00 allowance.
            `Ours ${money(group.shopValue)}; theirs lists the same sublet with no price (${group.carrierLines.map((line) => `L${line}`).join(", ")}), left open for invoice. The invoices settle it.`
          : `Ours ${money(group.shopValue)}, theirs ${money(group.carrierValue)} for the same sublet; the invoices settle it.`
        : group.shopHours === group.carrierHours
          ? pricedDetail(group) ?? `${sides}: the same hours, coded to a different labor category on each sheet.`
          : `${sides} for the same work written under different names.`;
    items.push({
      strength: excluded ? "Strong" : "Needs proof",
      title: group.label,
      detail,
      hours: round2(group.shopHours - group.carrierHours),
      value: diff,
      shopLines: group.shopLines,
      carrierLines: group.carrierLines,
    });
  }

  // Strong — the carrier pays the part with no labor to install it.
  for (const flag of flags) {
    if (flag.kind !== "partWithoutLabor") continue;
    const s = shopLine.get(flag.lines.shop?.[0] ?? -1);
    if (!s || claimed.has(s.line)) continue;
    claimed.add(s.line);
    items.push({
      strength: "Strong",
      title: `${s.desc}: install labor`,
      detail: `They pay the part (L${flag.lines.carrier?.[0]}) with no labor to install it; we wrote ${(s.hours ?? 0).toFixed(1)} hr.`,
      hours: s.hours ?? 0,
      value: round2(laborValue({ ...s, paintHours: 0 })),
      shopLines: [s.line],
      carrierLines: flag.lines.carrier ?? [],
    });
  }

  // Strong — the carrier pays the parent part and leaves the child off.
  for (const rule of PARENT_PARTS) {
    const children = shop.lines.filter((l) => rule.child.test(l.desc) && !rule.exclude.test(l.desc) && (l.price ?? 0) > 0);
    const carrierHasChild = carrier.lines.some((l) => rule.child.test(l.desc) && !rule.exclude.test(l.desc));
    const parents = carrier.lines.filter(
      (l) => rule.parent.test(l.desc) && !rule.parentExclude.test(l.desc) && l.oper === "Repl" && (l.price ?? 0) > 0
    );
    if (!children.length || carrierHasChild || !parents.length) continue;
    const ourCompanions = shop.lines.filter((l) => rule.companion.test(l.desc) && !claimed.has(l.line) && (l.price ?? 0) > 0);
    const theirCompanions = carrier.lines.filter((l) => rule.companion.test(l.desc) && (l.price ?? 0) > 0);
    [...children, ...ourCompanions].forEach((l) => claimed.add(l.line));
    const price = round2(children.reduce((sum, l) => sum + (l.price ?? 0), 0));
    const companionNet = round2(
      ourCompanions.reduce((sum, l) => sum + (l.price ?? 0), 0) - theirCompanions.reduce((sum, l) => sum + (l.price ?? 0), 0)
    );
    items.push({
      strength: "Strong",
      title: `${rule.label[0].toUpperCase()}${rule.label.slice(1)}${ourCompanions.length ? ", with balance and disposal" : ""}`,
      detail: `They pay the ${parents.length === 1 ? "part" : "parts"} the ${rule.label} mount on (${parents
        .map((l) => `L${l.line}`)
        .join(", ")}) but no ${rule.label}; ours ${children.map((l) => `L${l.line}`).join(", ")} (${money(price)})${
        ourCompanions.length
          ? `, plus ${ourCompanions.map((l) => `L${l.line}`).join(", ")}${theirCompanions.length ? ` less their ${theirCompanions.map((l) => `L${l.line}`).join(", ")}` : ""} (${money(companionNet)})`
          : ""
      }.`,
      hours: 0,
      value: round2(price + (ourCompanions.length ? companionNet : 0)),
      shopLines: [...children, ...ourCompanions].map((l) => l.line),
      carrierLines: [...parents, ...theirCompanions].map((l) => l.line),
    });
  }

  // Needs proof / Weak — the matcher's own differences, minus everything above.
  for (const pair of pairs) {
    if (pair.kind === "matched") continue;
    const lines = pair.shopLines.map((n) => shopLine.get(n)).filter((l): l is EstimateLine => Boolean(l));
    if (!lines.length || lines.some((l) => claimed.has(l.line))) continue;
    const theirs = pair.carrierLine !== undefined ? carrierLine.get(pair.carrierLine) : undefined;
    if (theirs && usedShopCarrierLine(groups, theirs.line)) continue;
    // Their lines whose own note says they are included in this one ("Included
    // in Tesla tool Box" on a 0.0 hr pre-repair scan) are part of the same item.
    const crossRefs =
      pair.coveredByCarrierNote && theirs
        ? (pair.coveredCarrierLines ?? []).map((n) => carrierLine.get(n)).filter((l): l is EstimateLine => Boolean(l))
        : [];
    if (crossRefs.some((l) => usedShopCarrierLine(groups, l.line))) continue;
    const ourHours = round2(lines.reduce((sum, l) => sum + hoursOf(l), 0));
    const hours = round2(ourHours - hoursOf(theirs) - crossRefs.reduce((sum, l) => sum + hoursOf(l), 0));
    // A paired line is worth its price difference too, as the gross view and
    // the citation copy value it: RO 22120's wheel, replaced at $700.00 on
    // ours against a $189.99 sublet repair on theirs, is not a 0.3 hr item.
    const ourPrice = round2(lines.reduce((sum, l) => sum + (l.price ?? 0), 0));
    const theirPrice = theirs ? round2([theirs, ...crossRefs].reduce((sum, l) => sum + (l.price ?? 0), 0)) : 0;
    const partValue = theirs ? round2(ourPrice - theirPrice) : ourPrice;
    const pricesDiffer = Boolean(theirs) && ourPrice !== theirPrice;
    const sideText = (sideHours: number, price: number) => `${sideHours.toFixed(1)} hr${pricesDiffer ? `, ${money(price)}` : ""}`;
    const value = round2(
      lines.reduce((sum, l) => sum + laborValue(l), 0) - laborValue(theirs) - crossRefs.reduce((sum, l) => sum + laborValue(l), 0) + partValue
    );
    if (value <= 0 || hours < 0) continue;
    lines.forEach((l) => claimed.add(l.line));
    const head = lines[0];
    const pPage = !theirs
      ? INCLUDED_UNDER.find(
          (rule) =>
            rule.component.test(head.desc) &&
            carrier.lines.some((c) => rule.parent.test(`${c.oper ?? ""} ${c.desc}`) && sameAssemblySide(head, c))
        )
      : undefined;
    const lineRefs = lines.map((l) => `L${l.line}`).join(", ");
    // Their one line covers several of ours by its own note: the item is THEIR
    // line, and the note is quoted (RO 21548: one diagnostic line "includes pre
    // and post and 1 Calibration and Service Mode" against eight of ours).
    const coveredNote = pair.coveredByCarrierNote && theirs ? theirs.note?.replace(/^[(\s]+|[)\s]+$/g, "") : undefined;
    items.push({
      strength: "Needs proof",
      // The title is read on its own: the lines are compared with their line,
      // and the detail says which ones the note's words name.
      title: coveredNote && theirs ? `${theirs.desc} and the lines compared with it` : `${head.oper ? `${head.oper} ` : ""}${head.desc}`,
      detail: pPage
        ? `Not paid (${lineRefs}, ${ourHours.toFixed(1)} hr). Whether it is included in ${pPage.label} is a CCC/MOTOR P-page question; attach the page before arguing it.`
        : coveredNote && theirs
          ? `Ours ${sideText(ourHours, ourPrice)} (${lineRefs}), theirs ${sideText(hoursOf(theirs), theirPrice)} (L${theirs.line}), whose note reads "${coveredNote}". ` +
            noteCoverScope({
              hours: hoursOf(theirs),
              crossRefs: crossRefs.map((l) => ({ line: l.line, hours: hoursOf(l), note: l.note?.trim() ?? "" })),
              named: lines.map((l) => l.line).filter((n) => !(pair.inferredShopLines ?? []).includes(n)),
              inferred: lines.map((l) => l.line).filter((n) => (pair.inferredShopLines ?? []).includes(n)),
              theirs: "Their",
              ours: "our ",
            })
          : theirs
          ? `Ours ${sideText(ourHours, ourPrice)} (${lineRefs}), theirs ${sideText(hoursOf(theirs), theirPrice)} (L${theirs.line}${theirs.oper ? ` ${theirs.oper}` : ""}).`
          : `No counterpart on their sheet (${lineRefs}, ${ourHours.toFixed(1)} hr${partValue > 0 ? `, ${money(partValue)} part` : ""}).`,
      hours,
      value,
      shopLines: lines.map((l) => l.line),
      carrierLines: theirs ? [theirs.line, ...crossRefs.map((l) => l.line)] : [],
    });
  }

  return items.sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength] || b.value - a.value);
}

function usedShopCarrierLine(groups: GroupDelta[], carrierLine: number): boolean {
  return groups.some((group) => group.carrierLines.includes(carrierLine));
}

/** Both lines name the same side (or neither names one). */
function sameAssemblySide(a: EstimateLine, b: EstimateLine): boolean {
  const side = (l: EstimateLine) => {
    const text = `${l.desc}`.toLowerCase();
    const rt = /\brt\b/.test(text);
    const lt = /\blt\b/.test(text);
    return rt && lt ? "both" : rt ? "rt" : lt ? "lt" : "any";
  };
  const sa = side(a);
  const sb = side(b);
  return sa === "any" || sb === "any" || sa === "both" || sb === "both" || sa === sb;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
