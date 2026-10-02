/**
 * "Items worth arguing": the hours and parts differences left after the
 * equivalence groups, ranked by what they are worth at OUR rates and labelled
 * by how strong the proof on the page already is.
 *
 *   Strong      — the carrier's own document supports our side: an exclusion
 *                 note on its line, a part it pays with no labor to install it,
 *                 or a parent part it pays whose child it left off (wheels
 *                 paid, tires not).
 *   Needs proof — an operation with no counterpart, or fewer hours on the
 *                 paired line; it needs a P-page, an invoice or an OEM
 *                 procedure before it is argued.
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
import { shopRateFor } from "./gapLedger";
import type { Flag } from "./integrityChecks";
import type { GroupDelta } from "./operationEquivalence";
import { round2, type Estimate, type EstimateLine } from "./types";

export type Strength = "Strong" | "Needs proof" | "Weak";

/** A difference the delta matcher found, by line number. */
export interface MatcherPair {
  kind: "missing" | "reduced";
  shopLines: number[];
  carrierLine?: number;
}

export interface ArgueItem {
  strength: Strength;
  title: string;
  detail: string;
  hours: number;
  /** Labor at our category rates plus any part price we wrote and they did not. */
  value: number;
  shopLines: number[];
  carrierLines: number[];
}

/** A child part the carrier leaves off while paying its parent. */
const PARENT_PARTS: Array<{ child: RegExp; exclude: RegExp; parent: RegExp; companion: RegExp; label: string }> = [
  {
    child: /\b(tires?|pirelli|michelin|goodyear|continental|bridgestone)\b/i,
    exclude: /disposal|balance|mount/i,
    parent: /\bwheel\b/i,
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
  // With part of their sheet unread, "no price" and "no counterpart" are what
  // this read found, not what their sheet says.
  const incomplete = params.carrierLinesIncomplete === true;
  const shopLine = new Map(shop.lines.map((l) => [l.line, l]));
  const carrierLine = new Map(carrier.lines.map((l) => [l.line, l]));
  const paintRate = shopRateFor(shop, "paint", 0);
  const laborValue = (l: EstimateLine | undefined) =>
    l ? (l.hours ?? 0) * shopRateFor(shop, l.laborCat ?? "body", 0) + (l.paintHours ?? 0) * paintRate : 0;
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

  // Part of their sheet's prices unread (a price cell not read, a row not
  // read at all, or a sublet that prints blank by design — the ledger cannot
  // tell which): no item may rest on a carrier price. Groups are valued on
  // hours; parent-part items and our priced lines with no counterpart are
  // not listed.
  const hoursValue = (lines: number[], byLine: Map<number, EstimateLine>) =>
    round2(lines.reduce((sum, line) => { const l = byLine.get(line); return sum + (l ? (l.hours ?? 0) * shopRateFor(shop, l.laborCat ?? "body", 0) : 0); }, 0));

  // Strong — the carrier's own exclusion note on an equivalence group.
  for (const group of groups) {
    const diff = incomplete
      ? round2(hoursValue(group.shopLines, shopLine) - hoursValue(group.carrierLines, carrierLine))
      : round2(group.shopValue - group.carrierValue);
    if (diff <= 0) continue;
    const excluded = group.exclusions.length > 0;
    const sides = `Ours ${group.shopHours.toFixed(1)} hr, theirs ${group.carrierHours.toFixed(1)} hr`;
    const detail = incomplete
      ? `${sides}${excluded ? `. Their own line says the time ${group.exclusions[0].toLowerCase()}` : ""}. Part of their sheet's prices was not read, so the priced lines are not compared; Worth counts the hours only.`
      : excluded
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
    // Netted against their companion prices, so not stated on a partial read.
    if (incomplete) continue;
    const children = shop.lines.filter((l) => rule.child.test(l.desc) && !rule.exclude.test(l.desc) && (l.price ?? 0) > 0);
    const carrierHasChild = carrier.lines.some((l) => rule.child.test(l.desc) && !rule.exclude.test(l.desc));
    const parents = carrier.lines.filter((l) => rule.parent.test(l.desc) && l.oper === "Repl" && (l.price ?? 0) > 0);
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
    const lines = pair.shopLines.map((n) => shopLine.get(n)).filter((l): l is EstimateLine => Boolean(l));
    if (!lines.length || lines.some((l) => claimed.has(l.line))) continue;
    const theirs = pair.carrierLine !== undefined ? carrierLine.get(pair.carrierLine) : undefined;
    if (theirs && usedShopCarrierLine(groups, theirs.line)) continue;
    // A priced line of ours with "no counterpart" on a partial read may have
    // one among their unread priced rows. Unread DOLLARS cannot hide a
    // labor-only counterpart, so a labor-only line stands as on a full read.
    if (incomplete && !theirs && lines.some((l) => (l.price ?? 0) > 0)) continue;
    const ourHours = round2(lines.reduce((sum, l) => sum + hoursOf(l), 0));
    const hours = round2(ourHours - hoursOf(theirs));
    const partValue = theirs ? 0 : lines.reduce((sum, l) => sum + (l.price ?? 0), 0);
    const value = round2(lines.reduce((sum, l) => sum + laborValue(l), 0) - laborValue(theirs) + partValue);
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
    items.push({
      strength: "Needs proof",
      title: `${head.oper ? `${head.oper} ` : ""}${head.desc}`,
      detail: pPage
        ? `Not paid (${lineRefs}, ${ourHours.toFixed(1)} hr). Whether it is included in ${pPage.label} is a CCC/MOTOR P-page question; attach the page before arguing it.`
        : theirs
          ? `Ours ${ourHours.toFixed(1)} hr (${lineRefs}), theirs ${hoursOf(theirs).toFixed(1)} hr (L${theirs.line}${theirs.oper ? ` ${theirs.oper}` : ""}).`
          : `No counterpart on their sheet (${lineRefs}, ${ourHours.toFixed(1)} hr${partValue > 0 ? `, ${money(partValue)} part` : ""}).`,
      hours,
      value,
      shopLines: lines.map((l) => l.line),
      carrierLines: theirs ? [theirs.line] : [],
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
