/**
 * Group operations the two appraisers wrote under different names BEFORE
 * anything is called missing.
 *
 * The old summary counted "our lines with no match" line by line on
 * description text, so work the carrier wrote under another name was reported
 * as missing. RO 21995:
 *   Isolate / confirm high voltage, battery, gloves (2.8 h) <-> High voltage
 *     system deactivate/activate + D&R 12v (3.0 h)  [the carrier pays MORE]
 *   R&I susp crossmember + crossmember assy (5.8 h) <-> Susp subframe (5.5 h)
 *   Prep grounds + inspect & secure grounds (2.0 h) <-> Prep, inspect, and
 *     secure all grounds (2.0 h)
 * Only what is left after grouping is "no counterpart".
 *
 * The table is seeded from adjudicated pairs; every entry must be proven on a
 * real pair in a test. Tool names that appear here (a calibration rig, an OEM
 * diagnostic app) are recognition vocabulary, like a carrier-name list — no
 * rule branches on a vehicle make or a carrier.
 */
import type { MatcherPair } from "./argueItems";
import { endOfLine, INCLUDED_WITH_OVERHAUL, isBumperScopePair, OVERHAUL_PREMISE } from "./bumperOverhaul";
import { shopLineRate, shopRateFor } from "./gapLedger";
import { round2, type Estimate, type EstimateLine } from "./types";

export interface EquivGroup {
  key: string;
  label: string;
  shop: RegExp;
  carrier: RegExp;
  /** The group forms only when at least one carrier line matches this (a road test alone is not calibration). */
  carrierAnchor?: RegExp;
}

export const EQUIV_GROUPS: EquivGroup[] = [
  {
    key: "hv",
    label: "High-voltage disable / enable",
    shop: /(isolate|confirm)\s+high\s+voltage|high\s+voltage.*(isolat|deactivat)|test\s+high\s+voltage\s+gloves|access\s+ride\b|^battery$|d&r\s*12v/i,
    carrier: /high\s+voltage\s+system\s+deactivate|d&r\s*12v|isolate\s+high\s+voltage/i,
  },
  {
    key: "subframe",
    label: "Subframe / crossmember labor",
    shop: /susp(ension)?\s+crossmember|^crossmember\s+assy|^subframe$|susp\s+subframe$/i,
    carrier: /^susp(ension)?\s+subframe$|^crossmember\s+assy|^subframe$/i,
  },
  {
    key: "grounds",
    label: "Welder grounds prep / inspect",
    shop: /grounds?\b.*(clamp|secure)|inspect\s+&?\s*secure\s+all\s+g(r)?ou?nds/i,
    carrier: /grounds?\b.*(clamp|secure)/i,
  },
  {
    key: "frameSetup",
    label: "Frame bench set-up, fixtures, measure",
    shop: /frame\s+bench|set\s+up\s+fixture|measure-?\s*diagnostic/i,
    carrier: /frame\s+rack\s+set\s*up|additional\s+fixtures|measure\s+frame/i,
  },
  {
    key: "adas",
    label: "ADAS calibration & diagnostics",
    shop: /calibrat|driver\s+assist|trupoint|research\s+(up\s+to\s+date\s+)?adas|set\s+ride\s+height|service\s+mode|set\s+up\s+targets|blueprint|research\s+dtc|connect\s+vehicle|road\s+test|allpurpose|reset\s+vehicle|in-?proc/i,
    // "road test" on both sides: the shop pattern carries it, and leaving the
    // carrier's own road test out (RO 22279 L49, 0.5 hr) printed "theirs 0.0 hr".
    // But a road test is a test drive, not calibration: the carrier side
    // counts only when it writes real calibration or aiming, or a carrier
    // road test alone would absorb our calibration as "the same work".
    carrier: /aim\s+(camera|distance\s+sensor)|add\s+for\s+radar|calibrat|road\s+test/i,
    carrierAnchor: /aim\s+(camera|distance\s+sensor)|add\s+for\s+radar|calibrat/i,
  },
  {
    key: "scan",
    label: "Pre / post repair scans",
    shop: /^(pre|post)[\s-]repair\s+scan/i,
    carrier: /^(pre|post)[\s-]repair\s+scan/i,
  },
  {
    key: "dealerSublet",
    label: "OEM dealer sublet (power-up, fluids, service)",
    shop: /power\s+up|oil\s+service|hydraulic\s+service|drain\s+&\s+refill|drive\s+unit\s+oil|hv\s+coolant/i,
    carrier: /\b(dealer|oem)\s+service\b|^[a-z]+\s+service\s*\+\s*\d+%/i,
  },
  {
    key: "transport",
    label: "Transport to / from sublet",
    shop: /transport\s+(vehicle\s+)?(to|from)\s+sublet/i,
    carrier: /tow\s+(to|from)\s+sublet/i,
  },
  {
    // RO 21548: our "Finish sand & polish" (1.0 paint hr) against their
    // "Denib and Polish" (0.5 hr) AND "Color Sand and Buff" (1.0 hr + $12).
    // Paired line to line, ours read as 0.5 hr short; as the group it is,
    // theirs pays more.
    key: "finish",
    label: "Finish sand / denib / polish",
    shop: /finish\s+sand|sand\s*(&|and)?\s*(polish|buff)|color\s+sand|\bdenib\b/i,
    carrier: /finish\s+sand|sand\s*(&|and)?\s*(polish|buff)|color\s+sand|\bdenib\b/i,
  },
];

/** Carrier notes that explicitly EXCLUDE work — the strongest evidence the summary can cite. */
export const EXCLUSION_NOTE = /(does\s+not|doesn't)\s+include\s+([^.]+)/i;

export interface GroupDelta {
  key: string;
  label: string;
  shopLines: number[];
  carrierLines: number[];
  shopHours: number;
  carrierHours: number;
  /** Labor at the SHOP's category rates plus line prices. */
  shopValue: number;
  carrierValue: number;
  /** Carrier notes on the group's lines that say what the carrier's time excludes. */
  exclusions: string[];
  /** What makes the lines one comparison, when the label alone does not say (the overhaul premise). */
  premise?: string;
}

const matches = (re: RegExp, line: EstimateLine) => re.test(line.desc.trim());

export function groupEquivalents(shop: Estimate, carrier: Estimate, pairs: MatcherPair[] = []) {
  const usedShop = new Set<number>();
  const usedCarrier = new Set<number>();
  // A carrier line whose own note names the work it includes is already one
  // comparison with the lines of ours it covers (and with its lines whose
  // notes point back to it). A group taking part of it would split that
  // comparison, and the dispute report would then argue neither half
  // (RO 22084: the ADAS group took two of the Tool Box's lines).
  const reservedShop = new Set<number>();
  const reservedCarrier = new Set<number>();
  for (const pair of pairs) {
    if (!pair.coveredByCarrierNote || pair.carrierLine === undefined) continue;
    pair.shopLines.forEach((line) => reservedShop.add(line));
    [pair.carrierLine, ...(pair.coveredCarrierLines ?? [])].forEach((line) => reservedCarrier.add(line));
  }
  const groups: GroupDelta[] = [];
  // Paint hours count: one sheet can write the same finishing work as paint
  // and the other as body (RO 21548's finish sand & polish).
  const paintRate = shopRateFor(shop, "paint", 0);
  const value = (lines: EstimateLine[]) =>
    round2(lines.reduce((sum, l) => sum + (l.hours ?? 0) * shopLineRate(shop, l) + (l.paintHours ?? 0) * paintRate + (l.price ?? 0), 0));
  const hours = (lines: EstimateLine[]) => round2(lines.reduce((sum, l) => sum + (l.hours ?? 0) + (l.paintHours ?? 0), 0));
  // A line the matcher paired at equal value joins a group only with its
  // counterpart. Taking one side alone left the other reading as work only
  // that sheet wrote: RO 22084's ADAS group took our 'Remove vehicle from
  // "Service Mode"' (L147, 0.1 M) and left the carrier's same line (L101,
  // 0.1 M) "on this estimate only. Not on ours." A pair with a difference is
  // not held whole: correcting the matcher's cross-named pairs is what the
  // groups are for (RO 21995: it paired our subframe BOLT with their "Susp
  // subframe", and our in-process scan with their post-repair scan).
  const counterparts = pairs.filter(
    (pair) => pair.kind === "matched" && pair.carrierLine !== undefined && pair.shopLines.length > 0
  );
  const keepPairsWhole = (s: EstimateLine[], c: EstimateLine[]) => {
    for (;;) {
      const inShop = new Set(s.map((l) => l.line));
      const inCarrier = new Set(c.map((l) => l.line));
      const split = counterparts.filter((pair) => {
        const shopIn = pair.shopLines.filter((line) => inShop.has(line)).length;
        const carrierIn = inCarrier.has(pair.carrierLine!);
        return (shopIn > 0 || carrierIn) && !(carrierIn && shopIn === pair.shopLines.length);
      });
      if (!split.length) return { s, c };
      const dropShop = new Set(split.flatMap((pair) => pair.shopLines));
      const dropCarrier = new Set(split.map((pair) => pair.carrierLine!));
      s = s.filter((l) => !dropShop.has(l.line));
      c = c.filter((l) => !dropCarrier.has(l.line));
    }
  };
  for (const group of EQUIV_GROUPS) {
    const { s, c } = keepPairsWhole(
      shop.lines.filter((l) => !usedShop.has(l.line) && !reservedShop.has(l.line) && matches(group.shop, l)),
      carrier.lines.filter((l) => !usedCarrier.has(l.line) && !reservedCarrier.has(l.line) && matches(group.carrier, l))
    );
    // One-sided: leave it for the no-counterpart pass.
    if (!s.length || !c.length) continue;
    if (group.carrierAnchor && !c.some((l) => matches(group.carrierAnchor!, l))) continue;
    s.forEach((l) => usedShop.add(l.line));
    c.forEach((l) => usedCarrier.add(l.line));
    const exclusions = c
      .map((l) => l.note?.match(EXCLUSION_NOTE)?.[0]?.replace(/\s+/g, " ").trim())
      .filter((x): x is string => Boolean(x));
    groups.push({
      key: group.key,
      label: group.label,
      shopLines: s.map((l) => l.line),
      carrierLines: c.map((l) => l.line),
      shopHours: hours(s),
      carrierHours: hours(c),
      shopValue: value(s),
      carrierValue: value(c),
      exclusions,
    });
  }
  // A bumper overhaul on one sheet against the same end's bumper R&I on the
  // other (bumperOverhaul.ts) is one comparison, with the parts each sheet
  // shows inside its own operation: ours printed with no labor of their own
  // ("Incl.") beside our overhaul, and theirs whose note says the time is
  // included with an overhaul, or paired with one of those lines of ours.
  // Left as lines, RO 22120 argued our rear O/H 3.7 against their R&I cover
  // 1.7 ($180) while their upper cover 0.8 and air deflector 0.3 read as work
  // ours lacks or underpays; the one comparison is 3.7 against 2.8.
  const view = (l: EstimateLine) => ({ op: l.oper ?? "", desc: l.desc, end: endOfLine(l) });
  for (const overhaul of shop.lines.concat(carrier.lines)) {
    if ((overhaul.oper ?? "").toLowerCase() !== "o/h") continue;
    const ours = shop.lines.includes(overhaul);
    const [own, other] = ours ? [shop, carrier] : [carrier, shop];
    const [ownUsed, otherUsed] = ours ? [usedShop, usedCarrier] : [usedCarrier, usedShop];
    if (ownUsed.has(overhaul.line)) continue;
    const end = endOfLine(overhaul);
    const counterpart = other.lines.find(
      (l) => !otherUsed.has(l.line) && isBumperScopePair(view(overhaul), view(l)) && (l.oper ?? "").toLowerCase() === "r&i"
    );
    if (!end || !counterpart) continue;
    const atEnd = (l: EstimateLine) => l.line !== overhaul.line && l.line !== counterpart.line && endOfLine(l) === end;
    // The matcher pair a line of the overhaul's sheet sits in, when it has a
    // line on the other sheet.
    const pairedWith = (l: EstimateLine) =>
      pairs.find(
        (pair) => pair.carrierLine !== undefined && (ours ? pair.shopLines.includes(l.line) : pair.carrierLine === l.line)
      );
    // Parts inside the overhaul's own operation: printed in its section with
    // no labor of their own, and written on the other sheet too.
    const ownIncluded = own.lines.filter(
      (l) =>
        atEnd(l) &&
        l.section === overhaul.section &&
        !ownUsed.has(l.line) &&
        (l.hours ?? 0) === 0 &&
        (l.paintHours ?? 0) === 0 &&
        pairedWith(l)
    );
    const ownPartners = new Set(
      ownIncluded.flatMap((l) => {
        const pair = pairedWith(l)!;
        return ours ? [pair.carrierLine!] : pair.shopLines;
      })
    );
    const otherIncluded = other.lines.filter(
      (l) =>
        atEnd(l) &&
        !otherUsed.has(l.line) &&
        (ownPartners.has(l.line) || (l.section === counterpart.section && INCLUDED_WITH_OVERHAUL.test(l.note ?? "")))
    );
    // A pair is compared whole or not at all (keepPairsWhole).
    const { s, c } = keepPairsWhole(
      ours ? [overhaul, ...ownIncluded] : [counterpart, ...otherIncluded],
      ours ? [counterpart, ...otherIncluded] : [overhaul, ...ownIncluded]
    );
    if (!s.some((l) => l.line === (ours ? overhaul : counterpart).line)) continue;
    if (!c.some((l) => l.line === (ours ? counterpart : overhaul).line)) continue;
    s.forEach((l) => usedShop.add(l.line));
    c.forEach((l) => usedCarrier.add(l.line));
    groups.push({
      key: `bumperOverhaul:${end}`,
      label: `${end === "front" ? "Front" : "Rear"} bumper overhaul`,
      shopLines: s.map((l) => l.line),
      carrierLines: c.map((l) => l.line),
      shopHours: hours(s),
      carrierHours: hours(c),
      shopValue: value(s),
      carrierValue: value(c),
      exclusions: [],
      premise: `${ours ? "Ours" : "Theirs"} is an O/H; ${ours ? "theirs" : "ours"} an R&I of the same bumper. ${OVERHAUL_PREMISE}`,
    });
  }
  return { groups, usedShop, usedCarrier };
}
