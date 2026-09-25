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
import { shopRateFor } from "./gapLedger";
import { round2, type Estimate, type EstimateLine } from "./types";

export interface EquivGroup {
  key: string;
  label: string;
  shop: RegExp;
  carrier: RegExp;
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
    carrier: /aim\s+(camera|distance\s+sensor)|add\s+for\s+radar|calibrat/i,
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
}

const matches = (re: RegExp, line: EstimateLine) => re.test(line.desc.trim());

export function groupEquivalents(shop: Estimate, carrier: Estimate) {
  const usedShop = new Set<number>();
  const usedCarrier = new Set<number>();
  const groups: GroupDelta[] = [];
  const value = (lines: EstimateLine[]) =>
    round2(lines.reduce((sum, l) => sum + (l.hours ?? 0) * shopRateFor(shop, l.laborCat ?? "body", 0) + (l.price ?? 0), 0));
  const hours = (lines: EstimateLine[]) => round2(lines.reduce((sum, l) => sum + (l.hours ?? 0), 0));
  for (const group of EQUIV_GROUPS) {
    const s = shop.lines.filter((l) => !usedShop.has(l.line) && matches(group.shop, l));
    const c = carrier.lines.filter((l) => !usedCarrier.has(l.line) && matches(group.carrier, l));
    // One-sided: leave it for the no-counterpart pass.
    if (!s.length || !c.length) continue;
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
  return { groups, usedShop, usedCarrier };
}
