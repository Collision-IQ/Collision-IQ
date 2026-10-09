/**
 * LABOR RATIONALE — why one estimate carries an operation (or more time for
 * it) than the other, stated as an opinion an estimator can defend.
 *
 * The comparison engines already say WHAT differs ("ours 2.0 hr, theirs
 * none"). That is the evidence, not the argument. This module supplies the
 * argument: the repair logic that makes the operation necessary, what the
 * estimating guide's premise says about whether the database time already
 * covers it, which OEM document governs it, and what — on either sheet —
 * already concedes the point (their own repair line on the panel, their own
 * scans around a calibration, their blend of the same panel at half the time).
 *
 * Rules of the house (CLAUDE.md "Evidence Hierarchy" and the estimating
 * reference library):
 *  - Nothing here quotes a P-page, an OEM procedure or a position statement.
 *    Authorities are NAMED as the thing that settles the point, with what to
 *    attach; their text is only ever quoted by the retrieval lanes.
 *  - The guide is matched to the platform that printed the estimate
 *    (estimatingGuides.ts); an unknown platform names both.
 *  - An OEM position statement is named for a make only where that maker is
 *    known to publish one on the subject; otherwise the sentence says "where
 *    the maker publishes one".
 *  - The opinion cuts both ways. Where the numbers on OUR sheet are the weak
 *    side (a blend at the panel's full refinish time), it says so.
 *  - Line references and figures come only from the lines passed in.
 *
 * Pure and deterministic: no I/O, no model call. Used by the Appraisal Dispute
 * Report (argueItems) and the Forensic Estimate Analysis (delta findings).
 */
import { selectEstimatingGuides, type EstimatingPlatform } from "@/lib/ai/estimatingGuides";

/** One printed estimate line, in the shape both pipelines can supply. */
export interface RationaleLine {
  line: number | null;
  /** "Repl" | "R&I" | "Rpr" | "Blnd" | "Refn" | "Subl" | "O/H" | "Algn" | "" */
  oper: string | null;
  desc: string;
  hours: number;
  paintHours: number;
  price: number;
  /** A manual ("#") line: estimator judgment, not a database time. */
  manual?: boolean;
  section?: string | null;
  note?: string | null;
}

export type RationaleVoice = "dispute" | "forensic";

export interface RationaleContext {
  /** The line(s) on the higher estimate being argued. */
  higher: RationaleLine[];
  /** The paired line on the lower estimate, when the matcher paired one. */
  lower: RationaleLine | null;
  /** Every line on each sheet, for cross-references. */
  higherSheet: RationaleLine[];
  lowerSheet: RationaleLine[];
  /** The platform each estimate was printed on ("ccc", "mitchell", …). */
  higherPlatform?: string | null;
  lowerPlatform?: string | null;
  /** Vehicle text as the estimate prints it, and the VIN when read. */
  vehicle?: string | null;
  make?: string | null;
  /** "dispute": ours / theirs. "forensic": the higher / comparison estimate. */
  voice: RationaleVoice;
  /**
   * The case file's other documents (an ADAS report, OEM procedures, scan
   * reports), never the two estimates. A requirement printed in one of them
   * is quoted verbatim as the authority that settles the item: uploaded case
   * evidence is tier 1 on the evidence ladder.
   */
  caseDocuments?: CaseDocument[];
}

/** One uploaded case document, by the name the reader knows it by. */
export interface CaseDocument {
  name: string;
  text: string;
}

export type RationaleKey =
  | "sublet_price"
  | "scan"
  | "adas_research"
  | "calibration"
  | "initialization"
  | "blend"
  | "feather_prime_block"
  | "masking"
  | "finish_sand_polish"
  | "refinish_add"
  | "corrosion_protection"
  | "adhesive_material"
  | "cleanup"
  | "electrical_isolation"
  | "access_r_and_i"
  | "emblem"
  | "striker_alignment"
  | "test_fit"
  | "road_test"
  | "overlap"
  | "structural_setup"
  | "damage_scope"
  | "judgment_time"
  | "database_time";

export interface LaborRationale {
  key: RationaleKey;
  /** The argument: why the higher sheet carries this operation or time. */
  why: string;
  /** What settles it: the authority to attach, and the completion proof. */
  settledBy: string;
  /** The requirement as a case document prints it, quoted verbatim. */
  caseEvidence?: { document: string; quote: string };
  /** Lines on the lower estimate that trigger the requirement or concede the point. */
  concededBy?: number[];
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

interface Voice {
  /** "our sheet" / "the higher estimate" */
  hiSheet: string;
  /** "their sheet" / "the comparison estimate" */
  loSheet: string;
  /** "Ours" / "The higher estimate" (sentence start) */
  Hi: string;
  /** "theirs" / "the comparison estimate" (mid sentence) */
  lo: string;
  /** "our L12" / "L12 on the higher estimate" */
  hiRef: (lines: Array<number | null>) => string;
  loRef: (lines: Array<number | null>) => string;
}

const refs = (lines: Array<number | null>) =>
  lines
    .filter((n): n is number => typeof n === "number")
    .map((n) => `L${n}`)
    .join(", ");

function voiceFor(voice: RationaleVoice): Voice {
  if (voice === "dispute") {
    return {
      hiSheet: "our sheet",
      loSheet: "their sheet",
      Hi: "Ours",
      lo: "theirs",
      hiRef: (lines) => (refs(lines) ? `our ${refs(lines)}` : "our line"),
      loRef: (lines) => (refs(lines) ? `their ${refs(lines)}` : "their line"),
    };
  }
  return {
    hiSheet: "the higher estimate",
    loSheet: "the comparison estimate",
    Hi: "The higher estimate",
    lo: "the comparison estimate",
    hiRef: (lines) => (refs(lines) ? `${refs(lines)} on the higher estimate` : "the higher estimate's line"),
    loRef: (lines) => (refs(lines) ? `${refs(lines)} on the comparison estimate` : "the comparison estimate's line"),
  };
}

// ---------------------------------------------------------------------------
// Authorities — named, never quoted
// ---------------------------------------------------------------------------

function platformOf(value: string | null | undefined): EstimatingPlatform | null {
  const v = (value ?? "").toLowerCase();
  if (/mitchell/.test(v)) return "mitchell";
  if (/ccc|motor/.test(v)) return "ccc";
  return null;
}

/** "the CCC/MOTOR Guide to Estimating (GTE)", or the both-guides sentence (which carries its own article). */
function theGuide(platform: string | null | undefined): string {
  return platformOf(platform) ? `the ${guideName(platform)}` : guideName(platform);
}

/** The estimating guide that governs a line printed on this platform. */
export function guideName(platform: string | null | undefined): string {
  const resolved = platformOf(platform);
  if (!resolved) return "the estimating guide for the platform each sheet was written on (CCC/MOTOR GTE for CCC ONE, Mitchell CEG P-pages for Mitchell)";
  return selectEstimatingGuides({ platform: resolved })[0].label;
}

/** Makes known to publish a position statement on pre- and post-repair scanning. */
const SCAN_STATEMENT_MAKES = new Map<string, string>([
  ["toyota", "Toyota"],
  ["lexus", "Lexus"],
  ["honda", "Honda"],
  ["acura", "Acura"],
  ["nissan", "Nissan"],
  ["infiniti", "Infiniti"],
  ["ford", "Ford"],
  ["lincoln", "Lincoln"],
  ["chevrolet", "General Motors"],
  ["gmc", "General Motors"],
  ["buick", "General Motors"],
  ["cadillac", "General Motors"],
  ["chrysler", "FCA/Stellantis"],
  ["dodge", "FCA/Stellantis"],
  ["jeep", "FCA/Stellantis"],
  ["ram", "FCA/Stellantis"],
  ["hyundai", "Hyundai"],
  ["kia", "Kia"],
  ["subaru", "Subaru"],
  ["mazda", "Mazda"],
  ["volkswagen", "Volkswagen"],
  ["audi", "Audi"],
  ["tesla", "Tesla"],
]);

/** Brand words and CCC's four-letter abbreviations as estimates print them. */
const MAKE_WORDS: Array<[RegExp, string]> = [
  [/\b(toyota|toyo)\b/i, "toyota"],
  [/\b(lexus|lexs)\b/i, "lexus"],
  [/\bhonda\b/i, "honda"],
  [/\b(acura|acur)\b/i, "acura"],
  [/\b(nissan|niss)\b/i, "nissan"],
  [/\b(infiniti|infi)\b/i, "infiniti"],
  [/\bford\b/i, "ford"],
  [/\b(lincoln|linc)\b/i, "lincoln"],
  [/\b(chevrolet|chevy|chev)\b/i, "chevrolet"],
  [/\bgmc\b/i, "gmc"],
  [/\b(buick|buic)\b/i, "buick"],
  [/\b(cadillac|cadi)\b/i, "cadillac"],
  [/\b(chrysler|chry)\b/i, "chrysler"],
  [/\b(dodge|dodg)\b/i, "dodge"],
  [/\bjeep\b/i, "jeep"],
  [/\bram\b/i, "ram"],
  [/\b(hyundai|hyun)\b/i, "hyundai"],
  [/\bkia\b/i, "kia"],
  [/\b(subaru|suba)\b/i, "subaru"],
  [/\b(mazda|mazd)\b/i, "mazda"],
  [/\b(volkswagen|volk|vw)\b/i, "volkswagen"],
  [/\baudi\b/i, "audi"],
  [/\b(tesla|tesl)\b/i, "tesla"],
];

/** The make a vehicle description names, lower-cased; null when none is recognised. */
export function makeFromVehicleText(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [pattern, make] of MAKE_WORDS) if (pattern.test(text)) return make;
  return null;
}

function scanStatement(make: string | null): string {
  const maker = make ? SCAN_STATEMENT_MAKES.get(make) : undefined;
  return maker
    ? `${maker}'s position statement on pre- and post-repair scanning (attach the current version)`
    : "the vehicle maker's position statement on pre- and post-repair scanning, where it publishes one";
}

const OEM_MANUAL = "the OEM repair manual for this VIN";

// ---------------------------------------------------------------------------
// Line reading helpers
// ---------------------------------------------------------------------------

const cap = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hr = (n: number) => `${n.toFixed(1)} hr`;
const totalHours = (l: RationaleLine | null | undefined) => (l ? l.hours + l.paintHours : 0);
const op = (l: RationaleLine) => (l.oper ?? "").trim().toLowerCase();

function sideOf(desc: string): "rt" | "lt" | null {
  const m = desc.toLowerCase().match(/\b(rt|right|lt|left)\b/);
  if (!m) return null;
  return m[1] === "rt" || m[1] === "right" ? "rt" : "lt";
}

function sameSide(a: string, b: string): boolean {
  const sa = sideOf(a);
  const sb = sideOf(b);
  return sa === null || sb === null || sa === sb;
}

/** "(0.3 Hours and $3.00 per panel)", "(0.5 Refinish per panel)": the per-unit hours a line declares. */
function perPanelHours(desc: string): number | null {
  const m = desc.match(/\(?\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|refinish|labor)?[^)]*per\s+panel/i);
  return m ? Number(m[1]) : null;
}

/** "+34%" on a sublet line. */
function markupOf(desc: string): number | null {
  const m = desc.match(/\+\s*(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

const withoutMarkup = (desc: string) => desc.replace(/\s*\+\s*\d+(?:\.\d+)?\s*%/, "").trim();

/** The panel a repair line names, for "their sheet repairs the same panel". */
/**
 * The words that name the part itself: the description cut before its
 * qualifiers ("w/", "w/o", "from", a parenthesis), with side, position and
 * operation words dropped. English compounds put the part last, so "door
 * w'strip" is a weatherstrip and "fender liner grommet" a grommet.
 */
const NAME_DROP = new Set([
  "rt", "lt", "right", "left", "frt", "front", "rear", "rr", "upr", "lwr", "upper", "lower", "inner",
  "rpr", "repl", "r&i", "ri", "blnd", "refn", "o/h", "subl", "algn", "add", "a", "m", "am", "oem",
  "double", "cab", "crew", "access", "toyota", "chrome", "black", "dark", "assy", "assembly",
]);
function partName(desc: string): string[] {
  const head = withoutMarkup(desc)
    .toLowerCase()
    .split(/\s(?:w\/o?|w\/|from|for|with)\b|\(|\bw\/o?/)[0];
  return head
    .replace(/[^a-z0-9& ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !NAME_DROP.has(w) && !/^\d+$/.test(w));
}

/** The same part on both sheets: same side, the same last word, and one name inside the other. */
function sharesPanel(a: RationaleLine, b: RationaleLine): boolean {
  if (!sameSide(a.desc, b.desc)) return false;
  const na = partName(a.desc);
  const nb = partName(b.desc);
  if (!na.length || !nb.length || na[na.length - 1] !== nb[nb.length - 1]) return false;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  const set = new Set(long);
  return short.every((w) => set.has(w));
}

/** The repair line a refinish-prep line sits under on its own sheet. */
function repairAbove(line: RationaleLine, sheet: RationaleLine[]): RationaleLine | null {
  if (line.line === null) return null;
  const candidates = sheet
    .filter(
      (l) =>
        l.line !== null &&
        l.line < line.line! &&
        line.line! - l.line <= 25 &&
        op(l) === "rpr" &&
        l.hours > 0 &&
        (!line.section || !l.section || sameSection(line.section, l.section))
    )
    .sort((a, b) => b.line! - a.line!);
  return candidates[0] ?? null;
}

const sectionKey = (section: string) => section.toLowerCase().replace(/[^a-z]+/g, " ").trim();
function sameSection(a: string, b: string): boolean {
  return sectionKey(a) === sectionKey(b);
}

/** Operation weight when choosing which of their lines an R&I serves: the panel's repair before its blend. */
const WORK_ORDER: Record<string, number> = { rpr: 0, repl: 1, refn: 2, blnd: 3 };

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const RE = {
  preScan: /\bpre[\s-]*(repair|diag\w*)?\s*scan|\bpre[\s-]*scan|\bpre[\s-]*repair\s+scan/i,
  postScan: /\bpost[\s-]*(repair|diag\w*)?\s*scan|\bpost[\s-]*scan/i,
  inProcScan: /\bin[\s-]*proc\w*\b.*\bscan|\bintermediate\s+scan|\bmid[\s-]*repair\s+scan/i,
  scan: /\bscan\b|\bdiagnos/i,
  adasReport: /\badas\s*(report|research|review|analysis)|\brevv\s*adas|\bcalibration\s+(report|research)/i,
  radar: /\b(radar|millimeter\s*wave|acc\s+sensor|distance\s+sensor)\b/i,
  camera: /\b(camera|lka|lane\s*(keep|departure)|fcw)\b/i,
  blindSpot: /\b(blind\s*spot|bsm|bsd|side\s+radar|rear\s+radar)\b/i,
  sas: /\bsteering\s+angle\b|\bsas\b/i,
  occupant: /\b(seat\s+weight|occupant\s+(class\w*|detection|sens\w*)|ocs|odss?)\b/i,
  calibrate: /\bcalibrat|\baim(ing)?\b|\bzero\s*point\b/i,
  windowInit: /\b(power\s+)?window\b.*\b(initiali[sz]\w*|reset|relearn)|\b(initiali[sz]\w*|relearn)\b.*\bwindow/i,
  initialize: /\binitiali[sz]\w*|\brelearn\b/i,
  battery: /\bbattery\b|\b12\s*v\b/i,
  presets: /\b(reset|restore)\s+(operator|driver|customer)?\s*(preferences|presets|memory|radio|clock)|\boperator\s+preferences/i,
  fpb: /\bfeather\w*\b.*\bprime\b|\bprime\b.*\bblock\b|\bfeather\s*edge/i,
  finishSand: /\bfinish\s+sand|\bcolor\s+sand|\bdenib|\bsand\s*(&|and)\s*(polish|buff)|\bbuff\b/i,
  maskJambs: /\bmask\w*\b.*\b(jambs?|openings?|door\s+openings?)\b|\bback[\s-]*tap\w*/i,
  maskPrimer: /\bmask\w*\b.*\bprimer\b/i,
  maskRefinish: /\bmask\w*\b.*\b(refinish\w*|paint)\b|\bcover\s+(car|vehicle)\b.*\boverspray|\boverspray\b/i,
  clearCoat: /\badd\s+for\s+clear\s*coat|\bclear\s*coat\b/i,
  refinishAdd: /^\s*add\s+for\b|\badd\s+for\b|\btint\w*\b|\bflex\s+additive/i,
  corrosion: /\bcavity\s+wax|\bcorrosion\s+(protection|treatment)|\banti[\s-]*corrosion|\bseam\s+seal/i,
  urethane: /\burethane\b|\bbetaseal\b|\badhesive\s+kit/i,
  cleanAdhesive: /\bclean\s+adhesive|\badhesive\s+(removal|clean\w*)|\bremove\s+adhesive/i,
  preWash: /\bpre[\s-]*wash/i,
  debris: /\bdebris\b|\bcompound\s+residue|\bglass\s+clean\s*up|\bvacuum\b/i,
  roadTest: /\broad\s+test|\btest\s+drive/i,
  testFit: /\btest\s+fit|\btrial\s+fit|\bmock[\s-]*up/i,
  striker: /\bstriker\b/i,
  emblem: /\b(nameplate|emblem|badge|ornament|decal|stripe)\b/i,
  headliner: /\bheadliner\b|\bheadlining\b/i,
  pillarTrim: /\b(pillar|roof\s+side|rocker|kick|scuff|cowl\s+side)\b.*\b(trim|garnish|cover|plate)\b|\b(trim|garnish)\b.*\bpillar\b/i,
  belt: /\bbelt\b|\bweather\s*strip\b|\bwindow\s+(mldg|molding)/i,
  door: /\bdoor\b/i,
  handle: /\bhandle\b/i,
  srsSensor: /\b(impact|crash|collision|side\s+air\s*bag|sab|curtain)\s+sens\w*|\bsrs\s+sens\w*/i,
  liner: /\b(liner|splash\s+shield|wheelhouse|fender\s+seal|protector|mud\s*guard|splash\s+guard)\b/i,
  moulding: /\b(mldg|molding|moulding|flare|garnish|cladding|applique)\b/i,
};

const RIM = /\b(r&i|r\/i|remove\s*&\s*install|algn)\b/i;

type Build = (ctx: RationaleContext, v: Voice) => LaborRationale | null;

/** "Their L35 (RT Side panel) is refinished too" — the panel work on their sheet an R&I serves. */
function theirPanelWork(ctx: RationaleContext, panel: RegExp): RationaleLine | null {
  const head = ctx.higher[0];
  const isWork = (l: RationaleLine) => ["rpr", "repl", "refn", "blnd"].includes(op(l)) || l.paintHours > 0;
  const byOrder = (a: RationaleLine, b: RationaleLine) => (WORK_ORDER[op(a)] ?? 4) - (WORK_ORDER[op(b)] ?? 4);
  // The section both sheets print the line under is the strongest tie.
  if (head.section) {
    const inSection = ctx.lowerSheet
      .filter((l) => l.section && sameSection(l.section, head.section!) && isWork(l) && totalHours(l) >= 0.5 && sameSide(head.desc, l.desc))
      .sort(byOrder);
    if (inSection.length) return inSection[0];
  }
  return ctx.lowerSheet.filter((l) => panel.test(l.desc) && sameSide(head.desc, l.desc) && isWork(l) && totalHours(l) >= 0.5).sort(byOrder)[0] ?? null;
}

/** Panels a blend on this one sits beside. */
const ADJACENT: Array<[RegExp, RegExp]> = [
  [/\bfender\b/i, /\b(front\s+door|frt\s+door|hood|bumper|fascia|a[\s-]*pillar|hinge\s+pillar)\b/i],
  [/\b(tail\s*gate|tailgate)\b/i, /\b(bedside|box\s+side|pick\s*up\s+box|bed|outer\s+panel|bumper)\b/i],
  [/\b(pillar|rocker)\b/i, /\b(door|side\s+panel|quarter|fender|roof)\b/i],
  [/\bdoor\b/i, /\b(door|fender|quarter|pillar|rocker|side\s+panel)\b/i],
  [/\b(quarter|bedside|outer\s+panel)\b/i, /\b(door|tail\s*gate|tailgate|bumper|deck\s*lid|trunk|lift\s*gate|cab|side\s+panel)\b/i],
  [/\bhood\b/i, /\b(fender|bumper|cowl)\b/i],
  [/\broof\b/i, /\b(pillar|rail|side\s+panel|quarter)\b/i],
];

/** Their refinished panels beside the one we blend. */
function theirAdjacentRefinish(ctx: RationaleContext): RationaleLine[] {
  const head = ctx.higher[0];
  const rule = ADJACENT.find(([panel]) => panel.test(head.desc));
  if (!rule) return [];
  // A printed section names the panel family a generic line belongs to:
  // "RT Outer panel" under FRONT DOOR is a door, not a bedside.
  const family = (l: RationaleLine) => (l.section ? l.section : l.desc);
  return ctx.lowerSheet.filter(
    (l) =>
      rule[1].test(family(l)) &&
      isPanel(l) &&
      sameSide(head.desc, l.desc) &&
      l.paintHours > 0 &&
      ["rpr", "repl", "refn"].includes(op(l)) &&
      !rule[0].test(family(l))
  );
}

/** A line whose part is a body panel (its name ends in a panel word), not a molding, clip or add-on. */
const PANEL_WORDS = new Set([
  "panel", "side", "bedside", "fender", "door", "shell", "skin", "quarter", "gate", "tailgate", "liftgate", "hood",
  "roof", "pillar", "plr", "rocker", "bumper", "cover", "fascia", "box", "decklid", "lid", "rail",
]);
function isPanel(l: RationaleLine): boolean {
  const name = partName(l.desc);
  return name.length > 0 && PANEL_WORDS.has(name[name.length - 1]);
}

const SUBLET_PRICE: Build = (ctx, v) => {
  const head = ctx.higher[0];
  const lo = ctx.lower;
  if (!lo || ctx.higher.length !== 1) return null;
  if (Math.abs(totalHours(head) - totalHours(lo)) > 0.05) return null;
  if (!(head.price > 0 && lo.price > 0) || Math.abs(head.price - lo.price) < 0.01) return null;
  const mh = markupOf(head.desc);
  const ml = markupOf(lo.desc);
  if (mh === null && ml === null) return null;
  const base = (price: number, markup: number | null) => (markup === null ? price : price / (1 + markup / 100));
  const bh = base(head.price, mh);
  const bl = base(lo.price, ml);
  const markupClause =
    mh !== null && ml !== null
      ? mh === ml
        ? `Both carry +${mh}%, so the whole difference is the underlying invoice`
        : `The markups differ (+${mh}% against +${ml}%)`
      : mh !== null
        ? `Only ${v.hiSheet} prints a markup (+${mh}%)`
        : `Only ${v.loSheet} prints a markup (+${ml}%)`;
  const baseClause =
    Math.abs(bh - bl) < 0.01
      ? `and the base charge is the same (${money(bh)}), so the markup is the entire difference.`
      : bh < bl
        ? `and before markup ${v.hiSheet === "our sheet" ? "ours" : "the higher estimate's"} is ${money(bh)}, below ${ctx.voice === "dispute" ? "their" : "the comparison estimate's"} ${money(bl)}: the dispute is the markup alone.`
        : `and the base charge differs too: ${money(bh)} against ${money(bl)} before markup.`;
  return {
    key: "sublet_price",
    why: `The same sublet, priced differently: ${money(head.price)} against ${money(lo.price)} for "${withoutMarkup(head.desc)}". ${markupClause}, ${baseClause} Neither difference is a disagreement about whether the work is done.`,
    settledBy:
      "The vendor's invoice settles the base charge. The markup is the shop's posted sublet handling charge (sourcing, scheduling, transport and responsibility for the vendor's work); ask the carrier for the basis of the markup it applies if it is lower.",
  };
};

const SCAN: Build = (ctx, v) => {
  const head = ctx.higher[0];
  const text = head.desc;
  if (!RE.scan.test(text) || RE.calibrate.test(text) || RE.adasReport.test(text)) return null;
  const statement = scanStatement(ctx.make ?? makeFromVehicleText(ctx.vehicle));
  const theirCalibrations = ctx.lowerSheet.filter((l) => RE.calibrate.test(l.desc) || RE.initialize.test(l.desc));
  const theirScans = ctx.lowerSheet.filter((l) => RE.scan.test(l.desc) && !RE.calibrate.test(l.desc));
  let what: string;
  if (RE.inProcScan.test(text)) {
    what =
      "The in-process scan runs after the repairs and before calibration: a calibration will not run, or will not hold, with active codes, and codes set while modules were unplugged during the repair have to be read, cleared and confirmed first.";
    if (theirCalibrations.length) {
      what += ` ${v.loSheet[0].toUpperCase()}${v.loSheet.slice(1)} pays the calibrations (${refs(theirCalibrations.map((l) => l.line))}) this scan exists to prepare for${
        theirScans.length ? `, and its own pre- and post-repair scans (${refs(theirScans.map((l) => l.line))}) bracket the repair but not the calibration step` : ""
      }.`;
    }
  } else if (RE.preScan.test(text)) {
    what =
      "The pre-repair scan records which modules the collision set codes in before anything is taken apart, so damage the eye cannot see (sensors, modules, wiring) is in the repair plan at the start instead of being found at delivery.";
  } else if (RE.postScan.test(text)) {
    what =
      "The post-repair scan proves the vehicle leaves with no active codes and that every system the repair disturbed is back online; it is the only record that the electrical side of the repair was finished.";
  } else {
    what =
      "Diagnostic time is the work of reading, researching and resolving the codes the collision and the repair set; it is not part of any body, refinish or R&I time.";
  }
  return {
    key: "scan",
    why: `${what} No body, refinish or R&I labor time includes a scan; it is a separate diagnostic operation.`,
    settledBy: `${statement[0].toUpperCase()}${statement.slice(1)}; the scan reports themselves (with date, mileage and codes found) are the completion proof.`,
  };
};

const ADAS_RESEARCH: Build = (ctx) => {
  const head = ctx.higher[0];
  if (!RE.adasReport.test(head.desc)) return null;
  return {
    key: "adas_research",
    why:
      "Deciding which driver-assistance systems the repair disturbs is research: every operation on the repair plan is checked, by VIN, against the maker's calibration triggers (bumper or grille R&I for the front radar, glass or bracket work for the camera, wheel alignment for the steering angle sensor). That research is what tells both sheets which calibrations to write; it is not inside any calibration price or labor time.",
    settledBy:
      "The ADAS report itself (it lists each trigger and the repair line that set it off) and the maker's calibration-requirements document for this VIN.",
  };
};

const CALIBRATION: Build = (ctx, v) => {
  const head = ctx.higher[0];
  const text = head.desc;
  if (!RE.calibrate.test(text)) return null;
  const subject = RE.radar.test(text)
    ? {
        re: RE.radar,
        what: "The front radar aims through the bumper cover or grille emblem. Removing or replacing the bumper, grille, emblem or radar bracket, or changing the thrust angle with a wheel alignment, changes where it points; a static calibration re-aims it against a target at set distances on a level floor. An out-of-aim radar misjudges distance for adaptive cruise and pre-collision braking.",
      }
    : RE.blindSpot.test(text)
      ? {
          re: RE.blindSpot,
          what: "The blind-spot radars sit behind the rear bumper cover. Bumper or bracket R&I, refinish film thickness over the sensor, or a bracket shift changes what they see; the maker's procedure re-aims or verifies them after that work.",
        }
      : RE.camera.test(text)
        ? {
            re: RE.camera,
            what: "The forward camera reads lanes and objects through the windshield. Glass R&I or replacement, bracket work, or a change in ride height or alignment moves its view; the maker's procedure re-aims it.",
          }
        : RE.sas.test(text)
          ? {
              re: RE.sas,
              what: "The steering angle sensor tells stability control and lane-keeping where the wheels point. It is zeroed after a wheel alignment or steering and suspension work, and on many vehicles after the battery is disconnected; an un-zeroed sensor sets codes or disables those systems.",
            }
          : RE.occupant.test(text)
            ? {
                re: RE.occupant,
                what: "The front-passenger occupant classification sensor decides whether the passenger airbag deploys. The maker's procedure calls for a zero-point calibration under the conditions it lists (seat or sensor removal, seat-frame work, a collision affecting the SRS); without it the system can misclassify an occupant.",
              }
            : null;
  if (!subject) {
    return {
      key: "calibration",
      why: "A calibration exists because a repair operation on the plan disturbs a sensor's mounting, view or reference point; it is not part of the R&I or replacement time of the part around the sensor.",
      settledBy: `The calibration requirement in ${OEM_MANUAL}, tied to the repair line that triggers it, and the calibration report (pre- and post-aim values) as completion proof.`,
    };
  }
  // The same calibration written in other words on their sheet.
  const twin = ctx.lower
    ? null
    : ctx.lowerSheet.find((l) => subject.re.test(l.desc) && (RE.calibrate.test(l.desc) || /\baim\b/i.test(l.desc)));
  const twinClause = twin
    ? ` ${cap(v.loRef([twin.line]))} ("${withoutMarkup(twin.desc)}"${twin.price > 0 ? `, ${money(twin.price)}` : ""}) is the same calibration written in other words, so the two sheets agree it is needed; the difference is ${
        twin.price > 0 && head.price > 0 ? `price (${money(head.price)} against ${money(twin.price)}), not scope` : "how it is priced, not whether it is done"
      }.`
    : "";
  return {
    key: "calibration",
    concededBy: twin && twin.line !== null ? [twin.line] : undefined,
    why: `${subject.what}${twinClause}`,
    settledBy: `The calibration requirement in ${OEM_MANUAL}, tied to the repair line that triggers it, and the calibration report (pre- and post-aim values) as completion proof.`,
  };
};

/** Work that unplugs or removes the window motor: the door itself, its glass, regulator, motor or trim panel. */
const WINDOW_TRIGGER = /\bdoor\s+(assy|assembly|glass|trim|panel)\b|\b(window\s+)?(regulator|motor)\b|\brun\s+channel\b|\bglass\s+run\b|\br&i\s+door\b|\bdoor\s*$/i;

/** A line that IS a window initialization, however it is worded ("Power Window Reset", RO 22319 SOR L139). */
const WINDOW_INIT_LINE = /\bwindow\b.*\b(reset|initiali[sz]\w*|relearn)\b|\b(reset|initiali[sz]\w*|relearn)\b.*\bwindow\b/i;

const INITIALIZATION: Build = (ctx, v) => {
  const head = ctx.higher[0];
  if (!RE.windowInit.test(head.desc) && !(RE.initialize.test(head.desc) && !RE.calibrate.test(head.desc))) return null;
  // They pay it too, under their own wording or method: the requirement is
  // agreed and the difference is how it is billed. RO 22319 shipped this as
  // STRONG "no counterpart" while their L139 paid "Rpr Power Window Reset"
  // at 0.3 hr in-house against our $90.45 sublet.
  const theirs = ctx.lower && WINDOW_INIT_LINE.test(ctx.lower.desc) ? ctx.lower : ctx.lowerSheet.find((l) => WINDOW_INIT_LINE.test(l.desc));
  if (theirs && WINDOW_INIT_LINE.test(head.desc)) {
    const how = (l: RationaleLine) =>
      l.price > 0 && totalHours(l) === 0
        ? `a ${money(l.price)} sublet`
        : l.price > 0
          ? `${money(l.price)} plus ${hr(totalHours(l))}`
          : `${hr(totalHours(l))} of in-house labor`;
    return {
      key: "initialization",
      why: `Both sheets pay the window initialization, so the requirement is not in dispute. ${v.Hi} bills it as ${how(head)}; ${v.loRef([theirs.line])} ("${withoutMarkup(theirs.desc)}") bills it as ${how(theirs)}. The difference is who performs it and at what charge.`,
      settledBy:
        "The vendor's invoice if it is sublet, or the time the procedure takes in-house; the initialization procedure in the OEM repair manual says what is performed (each window, by its own switch).",
    };
  }
  const triggers = ctx.higherSheet.filter(
    (l) => RE.battery.test(l.desc) || (WINDOW_TRIGGER.test(l.desc) && ["r&i", "repl"].includes(op(l)))
  );
  const theirTriggers = ctx.lowerSheet.filter((l) => RE.battery.test(l.desc) || (WINDOW_TRIGGER.test(l.desc) && ["r&i", "repl"].includes(op(l))));
  const isWindow = RE.windowInit.test(head.desc) || /\bwindow\b/i.test(head.desc);
  const what = isWindow
    ? "Disconnecting the battery or the window motor clears the window's learned limits: auto up/down stops working and, more importantly, the jam (pinch) protection that reverses the glass on an obstruction is not active until the window is initialized."
    : "Disconnecting the battery or a module clears its learned values; the maker's procedure re-learns them before delivery so the system works as built.";
  const tie = triggers.length
    ? ` The trigger is on ${v.hiSheet}: ${v.hiRef(triggers.slice(0, 3).map((l) => l.line))} (${triggers
        .slice(0, 3)
        .map((l) => withoutMarkup(l.desc))
        .join("; ")}).`
    : "";
  const theirTie = theirTriggers.length
    ? ` ${cap(v.loSheet)} writes the same trigger (${refs(theirTriggers.slice(0, 3).map((l) => l.line))}: ${theirTriggers
        .slice(0, 3)
        .map((l) => `${l.oper ? `${l.oper} ` : ""}${withoutMarkup(l.desc)}`)
        .join("; ")}) without the step that follows it.`
    : "";
  // Their own glass, run-channel or regulator R&I triggers the requirement;
  // a battery disconnect alone is a weaker, maker-specific trigger.
  // Door work only: a sliding back glass has its own regulator and its own procedure.
  const theirWindowWork = theirTriggers.filter(
    (l) => WINDOW_TRIGGER.test(l.desc) && !RE.battery.test(l.desc) && /\bdoor\b|\brun\s+channel\b|\bglass\s+run\b/i.test(`${l.section ?? ""} ${l.desc}`)
  );
  return {
    key: "initialization",
    concededBy: isWindow ? theirWindowWork.map((l) => l.line).filter((n): n is number => n !== null) : undefined,
    why: `${what}${tie}${theirTie}`,
    settledBy: `The initialization procedure in ${OEM_MANUAL} (it states when initialization is required), and a note on the repair order that it was performed and tested.`,
  };
};

const BLEND: Build = (ctx, v) => {
  const head = ctx.higher[0];
  if (op(head) !== "blnd" && !/\bblend\b/i.test(head.desc)) return null;
  const guide = guideName(ctx.higherPlatform);
  const premise = `Blend is not part of the refinish time of the panel being painted, and no guide publishes a separate blend time; a blend is valued as a share of the blended panel's full refinish time (see the refinish section of ${theGuide(ctx.higherPlatform)}).`;
  // Their blend of the same panel the matcher left unpaired ("Blnd RT Fender
  // w/wheel opening molding…" against "Blnd RT Fender w/o wheel opening
  // molding", RO 22319) is the counterpart.
  const lo =
    ctx.lower ??
    (ctx.higher.length === 1 ? ctx.lowerSheet.find((l) => op(l) === "blnd" && sharesPanel(head, l)) ?? null : null);
  // Their sheet paints the whole panel: more than a blend, so not a gap.
  const theirFull = lo
    ? null
    : ctx.lowerSheet.find((l) => op(l) !== "blnd" && l.paintHours > 0 && sharesPanel({ ...head, desc: head.desc }, l));
  if (theirFull) {
    return {
      key: "blend",
      why: `${cap(v.loRef([theirFull.line]))} (${theirFull.oper ? `${theirFull.oper} ` : ""}${theirFull.desc}, ${hr(theirFull.paintHours)} refinish) paints this panel in full, which covers more than a blend. The two lines are likely the same panel at a different scope, not a blend left out; the question is whether the panel needs full refinish (damage on it) or a blend (color match only).`,
      settledBy: "Photos of the panel showing whether it carries damage; if it does not, a blend is the right scope and the full refinish on the other sheet is the higher allowance.",
    };
  }
  if (!lo) {
    return {
      key: "blend",
      why: `Factory paint varies from panel to panel and a color mixed to formula never matches it exactly, so a refinished panel set next to an untouched one shows a color step under daylight. Blending tapers the new color into the adjacent panel so the eye finds no edge. ${premise}${(() => {
        const beside = theirAdjacentRefinish(ctx);
        return beside.length
          ? ` ${cap(v.loRef(beside.slice(0, 3).map((l) => l.line)))} refinish${beside.length === 1 ? "es" : ""} ${[
              ...new Set(beside.slice(0, 3).map((l) => `${withoutMarkup(l.desc)}${l.section ? ` (${l.section.toLowerCase()})` : ""}`)),
            ].join(", ")} beside this panel and blend${beside.length === 1 ? "s" : ""} nothing into it.`
          : "";
      })()}`,
      settledBy:
        "A sprayed-out color test card against this panel (photographed in daylight) shows whether a blend is needed; the paint maker's blend procedure for the color, and the maker's refinish guidance where it addresses blending, support it.",
    };
  }
  const ours = totalHours(head);
  const theirs = totalHours(lo);
  const ratio = ours > 0 ? theirs / ours : 0;
  const halfOfOurs = Math.abs(ratio - 0.5) < 0.06;
  return {
    key: "blend",
    why: halfOfOurs
      ? `Both sheets blend this panel, so there is no disagreement that it needs one. ${v.loSheet[0].toUpperCase()}${v.loSheet.slice(1)} pays exactly half of ${v.Hi === "Ours" ? "ours" : "the higher estimate's"} (${hr(theirs)} against ${hr(ours)}): the two sheets apply a different share of the panel's refinish time, not a different scope. ${premise} If ${v.hiSheet} values the blend at the panel's full refinish time, expect that to be challenged; argue it on the size of the blend area instead (on a long, contoured panel the blend can run its full length).`
      : `Both sheets blend this panel; ${v.Hi === "Ours" ? "ours" : "the higher estimate"} carries ${hr(ours)} against ${hr(theirs)}. ${premise} The difference is the share each sheet applies or the extent of the panel blended.`,
    settledBy:
      "The blend share each sheet applies (it is visible on the line when compared with the panel's full refinish time), and photos of the blend area; the paint maker's blend procedure for the color.",
  };
};

const FEATHER_PRIME_BLOCK: Build = (ctx, v) => {
  const head = ctx.higher[0];
  if (!RE.fpb.test(head.desc)) return null;
  const guide = guideName(ctx.higherPlatform);
  const repair = repairAbove(head, ctx.higherSheet);
  const theirRepair = repair ? ctx.lowerSheet.find((l) => op(l) === "rpr" && sharesPanel(repair, l)) : null;
  const tie = repair
    ? ` It follows from ${v.hiRef([repair.line])} (${repair.oper ? `${repair.oper} ` : ""}${repair.desc}, ${hr(repair.hours)}).${
        theirRepair
          ? ` ${v.loRef([theirRepair.line])} repairs the same panel (${hr(theirRepair.hours)}), so the two sheets agree the panel takes body work; what ${v.loSheet} leaves out is the step between that body work and paint.`
          : ""
      }`
    : "";
  return {
    key: "feather_prime_block",
    why: `A panel repaired with filler or taken to bare metal cannot go to paint as it is: the repair edges are featheredged, the area is primed with a high-build surfacer, and the primer is block sanded flat so the repair does not show through the color. Body repair time ends at the filler, and refinish time starts from a surface that is ready to paint; featheredge, prime and block sits between them and is listed outside refinish time in ${guide}.${tie}`,
    settledBy: `${guide}, the refinish section's list of operations not included in refinish time; repair-area photos showing filler or bare metal.`,
  };
};

const MASKING: Build = (ctx, v) => {
  const head = ctx.higher[0];
  const guide = guideName(ctx.higherPlatform);
  const perPanel = perPanelHours(head.desc);
  const panels = perPanel && perPanel > 0 ? Math.round(totalHours(head) / perPanel) : null;
  const countClause =
    ctx.lower && perPanel && panels && panels > 1
      ? ` ${v.Hi} is ${hr(perPanel)} per panel across ${panels} panels (${hr(totalHours(head))}); ${v.lo} pays ${hr(totalHours(ctx.lower))}, which covers ${
          Math.max(1, Math.round(totalHours(ctx.lower) / perPanel))
        } at that rate. Count the refinished panels that have an opening or jamb on both sheets.`
      : "";
  if (RE.maskJambs.test(head.desc)) {
    return {
      key: "masking",
      why: `Refinish time is for the panel's exterior surface. Masking the door openings and jambs (back-taping), so overspray stays off the interior, trim and weatherstrips while the panel's edges are painted, is a separate operation.${countClause}`,
      settledBy: `${guide}, refinish section (what refinish masking includes and excludes); photos of the masked openings.`,
    };
  }
  if (RE.maskPrimer.test(head.desc)) {
    return {
      key: "masking",
      why: "Priming a repair area is its own spray step before color, and it is masked for that step separately; because featheredge, prime and block sits outside refinish time, the masking for it is not inside refinish time either.",
      settledBy: `${guide}, refinish section (operations not included in refinish time); repair-area photos.`,
    };
  }
  if (RE.maskRefinish.test(head.desc)) {
    return {
      key: "masking",
      why: `Covering the rest of the vehicle against overspray is part of preparing it for the booth. Whether ${v.loSheet} includes it in its refinish time is a guide question for the platform it was written on; ${v.hiSheet} writes it as a separate operation.${countClause}`,
      settledBy: `${guide}, refinish section (what refinish masking includes).`,
    };
  }
  return null;
};

const FINISH_SAND: Build = (ctx, v) => {
  const head = ctx.higher[0];
  if (!RE.finishSand.test(head.desc)) return null;
  const perPanel = perPanelHours(head.desc);
  const panels = perPanel && perPanel > 0 ? Math.round(totalHours(head) / perPanel) : null;
  return {
    key: "finish_sand_polish",
    why: `New clear coat cures with dust nibs and a texture that differs from the factory finish beside it; finish sanding and polishing removes the nibs and matches the texture so the repaired panels cannot be told from the original ones. It is done after refinish and is not part of refinish time.${
      perPanel && panels ? ` ${v.Hi} writes it at ${hr(perPanel)} per refinished panel across ${panels} panels.` : ""
    }`,
    settledBy: `${guideName(ctx.higherPlatform)}, refinish section (operations not included in refinish time); the paint maker's technical data sheet for the clear.`,
  };
};

const REFINISH_ADD: Build = (ctx) => {
  const head = ctx.higher[0];
  if (RE.clearCoat.test(head.desc)) {
    return {
      key: "refinish_add",
      why: "Two-stage paint is a base color plus a clear coat; the clear coat is an addition to the base refinish time the guide publishes, calculated on the panels refinished.",
      settledBy: `${guideName(ctx.higherPlatform)}, refinish section (two-stage / clear coat calculation).`,
    };
  }
  if (!RE.refinishAdd.test(head.desc)) return null;
  return {
    key: "refinish_add",
    why: /\btint/i.test(head.desc)
      ? "Tinting is adjusting the mixed color to match this vehicle's actual color before it is sprayed; it is not part of refinish time."
      : /\bflex/i.test(head.desc)
        ? "A flexible part needs flex additive in its primer and color so the paint does not crack when the part flexes."
        : "An add-on refinish operation covers a surface the panel's base refinish time does not (an edge, jamb or adjacent area painted with the panel).",
    settledBy: `${guideName(ctx.higherPlatform)}, refinish section.`,
  };
};

const CORROSION: Build = (ctx) => {
  const head = ctx.higher[0];
  if (!RE.corrosion.test(head.desc)) return null;
  return {
    key: "corrosion_protection",
    why: "Repairing, welding, drilling or straightening a panel burns off or breaks the factory corrosion protection inside it. The maker's body repair procedures call for restoring it (cavity wax, seam sealer, anti-corrosion compound) before the vehicle is returned; the material and its application are not inside the repair time.",
    settledBy: `The corrosion-protection section of ${OEM_MANUAL} (it names the areas and the product type); photos of the application.`,
  };
};

const ADHESIVE: Build = (ctx) => {
  const head = ctx.higher[0];
  if (!RE.urethane.test(head.desc)) return null;
  return {
    key: "adhesive_material",
    why: "Bonded glass is set in a urethane that meets the maker's strength and cure-time requirement; the urethane and primer kit is a material the glass labor time does not include.",
    settledBy: `The glass replacement procedure in ${OEM_MANUAL} (urethane specification) and the product invoice.`,
  };
};

const CLEANUP: Build = (ctx) => {
  const head = ctx.higher[0];
  if (RE.cleanAdhesive.test(head.desc)) {
    return {
      key: "cleanup",
      why: "A taped or bonded part leaves its adhesive on the panel when it comes off. The residue is removed before the panel is refinished or the part is reinstalled, or the new adhesive will not bond and the paint will not lay flat; R&I time removes the part, not its adhesive.",
      settledBy: `${guideName(ctx.higherPlatform)} (operations not included in R&I and refinish times); one line per bonded part removed, each tied to the part.`,
    };
  }
  if (RE.preWash.test(head.desc)) {
    return {
      key: "cleanup",
      why: "The vehicle is washed before it is disassembled so road film and debris do not end up in the repair area, the booth or the new paint.",
      settledBy: `${guideName(ctx.higherPlatform)} (operations not included); a check-in photo of the vehicle's condition.`,
    };
  }
  if (RE.debris.test(head.desc)) {
    return {
      key: "cleanup",
      why: "Collision debris (glass, plastic, sealer) and the compound residue from repair work are cleaned out of the interior, cargo area and body openings; it is not part of any part's R&I or replacement time.",
      settledBy: `${guideName(ctx.higherPlatform)} (operations not included); before-and-after photos.`,
    };
  }
  return null;
};

const ELECTRICAL: Build = (ctx) => {
  const head = ctx.higher[0];
  if (RE.presets.test(head.desc)) {
    return {
      key: "electrical_isolation",
      why: "Disconnecting the battery erases the owner's stored settings (radio presets, seat and mirror memory, clock, display preferences). Restoring them is part of returning the vehicle as it came in; no other line includes it.",
      settledBy: "The battery disconnect line it follows from, and the owner's settings recorded at check-in.",
    };
  }
  if (RE.battery.test(head.desc) && (op(head) === "rpr" || /disconnect|isolat/i.test(head.desc))) {
    return {
      key: "electrical_isolation",
      why: "The battery is disconnected to protect the vehicle's modules from welding current and to make airbag and electrical work safe; reconnecting it then sets off the resets and initializations that follow it on the sheet.",
      settledBy: `The battery disconnect requirement in ${OEM_MANUAL} for welding and SRS work.`,
    };
  }
  return null;
};

const ROAD_TEST: Build = (ctx) => {
  const head = ctx.higher[0];
  if (!RE.roadTest.test(head.desc)) return null;
  return {
    key: "road_test",
    why: "A road test is how the repair is verified under load: steering centered after the alignment, no codes returning once the systems wake up, and, for several calibrations, the drive cycle the maker's procedure requires to complete them. No repair operation includes it.",
    settledBy: `The calibration and post-repair verification steps in ${OEM_MANUAL} that call for a drive cycle; the road-test record on the repair order.`,
  };
};

const TEST_FIT: Build = (ctx, v) => {
  const head = ctx.higher[0];
  if (!RE.testFit.test(head.desc)) return null;
  return {
    key: "test_fit",
    why: `A replacement part is fitted to the vehicle before it is painted so gaps, flushness and mounting points are confirmed while they can still be corrected. Finding a fit problem after paint means painting twice. Replacement time assumes the part is installed once, finished; it does not include fitting it, removing it for paint and installing it again.${(() => {
      const part = { ...head, desc: head.desc.replace(RE.testFit, "").replace(/^[\s-]+/, "") };
      const replaced = ctx.lowerSheet.find((l) => op(l) === "repl" && sharesPanel(part, l));
      return replaced && !ctx.lower
        ? ` ${cap(v.loRef([replaced.line]))} replaces the ${withoutMarkup(replaced.desc)} without it.`
        : "";
    })()}`,
    settledBy: `${guideName(ctx.higherPlatform)} (what a replacement time includes); photos of the part test-fitted.`,
  };
};

const STRIKER: Build = (ctx) => {
  const head = ctx.higher[0];
  if (!RE.striker.test(head.desc)) return null;
  return {
    key: "striker_alignment",
    why: "When a door is removed, repaired or its pillar is worked, the striker is set again so the door latches flush with the body and seals; door R&I time hangs the door, it does not adjust the striker.",
    settledBy: `${guideName(ctx.higherPlatform)} (what door R&I includes); a photo of the door gap and flushness after the repair.`,
  };
};

const EMBLEM: Build = (ctx, v) => {
  const head = ctx.higher[0];
  if (!RE.emblem.test(head.desc)) return null;
  const panel = theirPanelWork(ctx, /\b(tail\s*gate|tailgate|fender|door|bedside|box|side\s+panel|quarter|outer\s+panel|liftgate|trunk)\b/i);
  return {
    key: "emblem",
    why: `An emblem on a panel being refinished comes off so the paint covers the panel without a tape line around it. Most are held by adhesive tape and are not reinstalled once removed; a new one goes on after paint.${
      panel
        ? ` ${cap(v.loRef([panel.line]))} (${panel.oper ? `${panel.oper} ` : ""}${panel.desc}) ${head.section ? "refinishes the panel it sits on" : "puts paint on that side; confirm it is the panel the emblem sits on"}.`
        : ""
    }`,
    settledBy: `The maker's part or procedure note on reuse of the emblem in ${OEM_MANUAL}; a photo of the emblem on the refinished panel.`,
  };
};

const ACCESS: Build = (ctx, v) => {
  const head = ctx.higher[0];
  const text = `${head.oper ?? ""} ${head.desc}`;
  if (!RIM.test(text) && op(head) !== "r&i") return null;
  const guide = guideName(ctx.higherPlatform);
  type Access = { reason: string; panel: RegExp };
  const access: Access | null = RE.headliner.test(head.desc)
    ? {
        reason: "The headliner is lowered or removed to reach the inside of the roof rail and pillars for straightening, heat or welding, and to keep that heat and the refinish off the fabric.",
        panel: /\b(roof|rail|pillar|side\s+panel|cab)\b/i,
      }
    : RE.srsSensor.test(head.desc)
      ? {
          reason: "An airbag sensor mounted on or near the area being repaired comes off before the panel is worked, so hammer force or heat at its mount cannot damage it or set it off, and it goes back torqued to specification.",
          panel: /\b(pillar|door|side\s+panel|rocker|cab)\b/i,
        }
      : RE.pillarTrim.test(head.desc)
        ? {
            reason: "Interior pillar and rocker trim comes off to reach the back side of the panel being repaired (to push, heat or check it) and so the trim is not damaged by that work.",
            panel: /\b(pillar|rocker|side\s+panel|cab|roof\s+rail)\b/i,
          }
        : RE.belt.test(head.desc)
          ? {
              reason: "The belt molding and weatherstrip come off a door being refinished so the color reaches the glass edge; painting around them leaves a tape line at the top of the door.",
              panel: /\bdoor\b/i,
            }
          : RE.handle.test(head.desc)
            ? {
                reason: "The handle comes off a panel being refinished so the paint covers the handle pocket and leaves no tape line.",
                panel: /\b(door|tail\s*gate|tailgate)\b/i,
              }
            : RE.door.test(head.desc)
              ? {
                  reason: "The door comes off its hinges so the door and the hinge area (hinge edge, hem flange, hinge pillar) can be repaired and refinished completely, without masking lines at the hinges.",
                  panel: /\b(hinge\s+pillar|pillar|side\s+panel|rocker|cab)\b/i,
                }
              : RE.liner.test(head.desc) || RE.moulding.test(head.desc)
                ? {
                    reason: "A liner, molding or protector mounted to a panel being repaired or refinished comes off for access and so the paint covers the panel underneath.",
                    panel: /\b(fender|side\s+panel|bedside|box|outer\s+panel|quarter|bumper|wheel\s*house|wheel\s+opng|door)\b/i,
                  }
                : null;
  const rule = `A repair or refinish time includes no R&I; only a database replacement time includes R&I, and then only the parts the guide lists as included (${guide}).`;
  // A part this table does not know (a caliper, a module) is not argued as
  // body-panel access: what it comes off for is the estimate's own question.
  if (!access) return null;
  const panel = theirPanelWork(ctx, access.panel);
  const concession = panel
    ? ` ${cap(v.loRef([panel.line]))} (${panel.oper ? `${panel.oper} ` : ""}${panel.desc}${totalHours(panel) > 0 ? `, ${hr(totalHours(panel))}` : ""}) pays the work this R&I gives access to.${
        op(panel) === "repl"
          ? ` Whether that replacement time already includes this R&I is a question for the included-operations list in ${theGuide(ctx.higherPlatform)}; check it before arguing.`
          : ` ${rule}`
      }`
    : ` ${rule}`;
  return {
    key: "access_r_and_i",
    why: `${access.reason}${concession}`,
    settledBy: `${guide} (included operations for the panel's operation); photos with the part removed and the repair area exposed.`,
  };
};

const OVERLAP: Build = (ctx, v) => {
  const head = ctx.higher[0];
  if (!/\boverlap\b|\bdeduct\b/i.test(head.desc)) return null;
  const ours = Math.abs(totalHours(head));
  const theirs = ctx.lower ? Math.abs(totalHours(ctx.lower)) : 0;
  const compare = ctx.lower
    ? ` ${cap(v.lo)} deducts ${hr(theirs)} where ${v.Hi === "Ours" ? "ours deducts" : "the higher estimate deducts"} ${hr(ours)}.`
    : "";
  return {
    key: "overlap",
    why: `Overlap is time two operations share when adjacent parts are worked together, deducted so it is not paid twice.${compare} Overlap follows the guide's rules for specific pairs of parts (which pair, and major or minor), not judgment; a larger deduction means one sheet deducted for a pair the other did not, or applied the rule differently.`,
    settledBy: `${guideName(ctx.lowerPlatform ?? ctx.higherPlatform)}, overlap section; list the part pairs each sheet deducts for and check each against it.`,
  };
};

const STRUCTURAL_SETUP: Build = (ctx) => {
  const head = ctx.higher[0];
  const text = head.desc;
  if (/\bride\s+height\b/i.test(text)) {
    return {
      key: "structural_setup",
      why: "Ride height is measured to confirm the suspension and structure sit where the maker specifies after the repair; it is also checked before a wheel alignment and before calibrations that depend on the vehicle's stance. No repair or alignment time includes it.",
      settledBy: `The ride-height specification and measuring points in ${OEM_MANUAL}, and the recorded measurements.`,
    };
  }
  if (!/\b(frame|bench|fixtures?|jig|anchor\w*|set[\s-]*up|measur\w*)\b/i.test(text) || /\b(mldg|molding|trim|assy)\b/i.test(text) || totalHours(head) <= 0) return null;
  return {
    key: "structural_setup",
    why: "Before structural work the vehicle is mounted, anchored and measured, and it is measured again after the pulls to prove the structure is back within the maker's dimensions. Set-up and measuring are separate from the time to repair or replace any structural part; the hours follow the bench, fixtures and number of measuring points the repair calls for.",
    settledBy: `The body dimension chart in ${OEM_MANUAL}, and the pre- and post-repair measuring printouts.`,
  };
};

const DAMAGE_SCOPE: Build = (ctx, v) => {
  const head = ctx.higher[0];
  if (ctx.lower || (op(head) !== "rpr" && op(head) !== "repl")) return null;
  // The same panel under another name: one repair line per side in the same
  // printed section ("RT Door shell" and "RT Outer panel", both under FRONT
  // DOOR). That is not missing work; it is the matcher's naming gap.
  if (head.section) {
    const twins = ctx.lowerSheet.filter(
      (l) =>
        op(l) === op(head) &&
        // A replaced part is identified by its name; a repaired panel by its place.
        (op(head) === "rpr" ? isPanel(l) && isPanel(head) : sharesPanel(head, l)) &&
        l.section &&
        sameSection(l.section, head.section!) &&
        sameSide(head.desc, l.desc) &&
        totalHours(l) >= 1
    );
    const twin = twins.length === 1 ? twins[0] : null;
    if (twin) {
      const same = Math.abs(twin.hours - head.hours) < 0.05 && Math.abs(twin.paintHours - head.paintHours) < 0.05;
      const ours = `${hr(head.hours)} body, ${hr(head.paintHours)} refinish`;
      const theirs = `${hr(twin.hours)} body, ${hr(twin.paintHours)} refinish`;
      return {
        key: "damage_scope",
        why: `This line is not missing from ${v.loSheet}. ${cap(v.loRef([twin.line]))} (${twin.oper} ${twin.desc}) is the only ${twin.oper} line on that side under ${head.section}: the same panel written in other words ("${head.desc}" against "${twin.desc}"). ${
          same
            ? `Both sheets write ${ours}; there is no difference to argue on this panel.`
            : twin.hours + twin.paintHours > head.hours + head.paintHours
              ? `${cap(v.lo)} writes more (${theirs} against ${ours}); this panel is not one to argue.`
              : `${v.Hi} writes ${ours} against ${theirs}; the difference is repair time on one panel, not a missing repair.`
        }`,
        settledBy: `Read the two lines side by side under ${head.section}; if the time differs, photos of the panel's damage with its size and depth marked.`,
      };
    }
  }
  if (op(head) === "rpr" ? totalHours(head) < 1 : totalHours(head) < 1 && head.price < 100) return null;
  return {
    key: "damage_scope",
    why: `This is not a time disagreement: no line on ${v.loSheet} ${op(head) === "rpr" ? "repairs" : "replaces"} the ${head.desc} under that name${(() => {
      const near = ctx.lowerSheet.filter((l) => ["rpr", "repl"].includes(op(l)) && sharesPanel(head, l));
      return near.length
        ? `, unless ${near
            .slice(0, 2)
            .map((l) => `${v.loRef([l.line])} (${l.oper} ${l.desc})`)
            .join(" or ")} is the same panel written differently; check that first`
        : "";
    })()}. ${
      op(head) === "rpr"
        ? "A repair time is the appraiser's judgment of the damage on the panel; the panel either needs the work or it does not, and that is decided by looking at it."
        : "Replacement is decided by the damage and by the maker's repair-versus-replace guidance for the part."
    }`,
    settledBy: `Photos of the panel in raking light with the damage marked and measured, and a reinspection with both appraisers present${
      op(head) === "repl" ? "; the maker's repair-versus-replace guidance where it addresses the part" : ""
    }.`,
  };
};

const PAIRED_TIME: Build = (ctx, v) => {
  const head = ctx.higher[0];
  const lo = ctx.lower;
  if (!lo) return null;
  const ours = totalHours(head);
  const theirs = totalHours(lo);
  if (ours <= theirs || ours <= 0 || theirs < 0) return null;
  const guide = guideName(ctx.lowerPlatform ?? ctx.higherPlatform);
  if (op(head) === "rpr" || op(lo) === "rpr" || head.manual || lo.manual) {
    return {
      key: "judgment_time",
      why: `Same operation, more time on ${v.hiSheet}: ${hr(ours)} against ${hr(theirs)}. ${
        op(head) === "rpr" || op(lo) === "rpr"
          ? "Repair time is not a database time; it is each appraiser's judgment of how long the damage takes to fix, so the difference is a difference in what each one saw."
          : "A manual line is estimator judgment, not a database time, so each side has to show the basis for its number."
      }`,
      settledBy:
        "Photos of the damage with its size and depth marked, the repair method (pull, heat, fill), and a reinspection with the panel exposed; a documented time study if it remains open.",
    };
  }
  if (op(head) !== op(lo) && op(head) && op(lo)) {
    return {
      key: "database_time",
      why: `The two sheets write different operations on the same part (${head.oper} against ${lo.oper}), and the time follows the operation. The question is which operation the damage calls for, not the hours.`,
      settledBy: `${guide}, what each operation includes; photos of the part's damage.`,
    };
  }
  return {
    key: "database_time",
    why: `Same database operation, different time (${hr(ours)} against ${hr(theirs)}). The guide publishes one time per operation, so a difference means one sheet added or removed time on top of it (an overlap deduction, an add-on, or a manual adjustment).`,
    settledBy: `${guide}, the operation's published time and its overlap and included-operation notes; the line's own notes on each sheet.`,
  };
};

/** Most specific first; the first rule that answers wins. */
const RULES: Build[] = [
  SUBLET_PRICE,
  ADAS_RESEARCH,
  CALIBRATION,
  INITIALIZATION,
  SCAN,
  BLEND,
  FEATHER_PRIME_BLOCK,
  MASKING,
  FINISH_SAND,
  REFINISH_ADD,
  CORROSION,
  ADHESIVE,
  CLEANUP,
  ELECTRICAL,
  ROAD_TEST,
  TEST_FIT,
  STRIKER,
  EMBLEM,
  ACCESS,
  OVERLAP,
  STRUCTURAL_SETUP,
  DAMAGE_SCOPE,
  PAIRED_TIME,
];

/**
 * Why the higher estimate carries this operation, or more time for it, than
 * the lower one. Null when no rule recognises the operation: the caller then
 * prints the sheets' figures alone rather than a generic sentence.
 */
export function explainLaborDifference(ctx: RationaleContext): LaborRationale | null {
  const result = explainFromSheets(ctx);
  // A price-only difference is not a question of whether the work is required.
  if (!result || !ctx.caseDocuments?.length || result.key === "sublet_price") return result;
  const evidence = findCaseRequirement(ctx.higher[0], result.key, ctx.caseDocuments);
  if (!evidence) return result;
  return {
    ...result,
    caseEvidence: evidence,
    settledBy: `In the case file, ${evidence.document}: "${evidence.quote}" ${result.settledBy}`,
  };
}

/**
 * The requirement sentences a case document can print for an operation, by
 * what the line is. Each pattern finds the sentence that STATES the
 * requirement (a "must", a "necessitates", a "perform … if"), never a mention.
 */
const CASE_REQUIREMENTS: Array<{ applies: (head: RationaleLine, key: RationaleKey) => boolean; pattern: RegExp | RegExp[] }> = [
  {
    applies: (head, key) => key === "initialization" && /\bwindow\b/i.test(head.desc),
    pattern: /power window control system must be initiali[sz]ed|window[^.]{0,120}must be initiali[sz]ed/i,
  },
  {
    applies: (head) => RE.radar.test(head.desc),
    pattern: /(millimeter wave radar|front radar)[^.]{0,160}necessitates[^.]{0,200}|(millimeter wave radar|front radar)[^.]{0,160}must be (adjusted|calibrated|aimed)/i,
  },
  {
    applies: (head) => RE.sas.test(head.desc),
    pattern: /steering angle sensor[^.]{0,160}(necessitates|must be (initiali[sz]ed|calibrated))[^.]{0,200}/i,
  },
  {
    applies: (head) => RE.occupant.test(head.desc),
    pattern: /perform the zero point calibration[^.]{0,120}if any of the following[^.]{0,400}|seat weight sensor[^.]{0,160}necessitates[^.]{0,200}/i,
  },
  {
    applies: (head, key) => key === "scan",
    pattern: /electrical and electronic systems? necessitates[^.]{0,300}collision damage|pre[- ]?(and|&) post[- ]?(repair )?scans?[^.]{0,120}(required|must|necessitates)/i,
  },
  {
    applies: (head) => RE.cleanAdhesive.test(head.desc),
    // Most specific first: tape residue on the body is what a "clean adhesive" line pays.
    pattern: [/wipe off any tape adhesive residue with cleaner/i, /remove any remaining butyl tape[^.]{0,80}/i],
  },
];

/** The first case document that prints the requirement, with the sentence quoted as printed (whitespace collapsed). */
function findCaseRequirement(
  head: RationaleLine,
  key: RationaleKey,
  documents: CaseDocument[]
): { document: string; quote: string } | null {
  const rules = CASE_REQUIREMENTS.filter((rule) => rule.applies(head, key));
  const patterns = rules.flatMap((rule) => (Array.isArray(rule.pattern) ? rule.pattern : [rule.pattern]));
  for (const pattern of patterns) {
    for (const doc of documents) {
      const text = doc.text.replace(/\s+/g, " ");
      const match = pattern.exec(text);
      if (!match) continue;
      // Widen to the sentence the match sits in; a sentence that starts more
      // than 200 characters back is quoted from the match, never mid-word.
      const sentenceStart = text.lastIndexOf(". ", match.index) + 2;
      const start = sentenceStart >= 2 && match.index - sentenceStart <= 200 ? sentenceStart : match.index;
      // To the end of the sentence when it closes soon; a print that runs on
      // without a full stop (a report's next heading) is cut at the match.
      const matchEnd = match.index + match[0].length;
      const endDot = text.indexOf(". ", matchEnd);
      const end = endDot >= 0 && endDot - matchEnd <= 80 ? endDot + 1 : matchEnd;
      let quote = text.slice(start, end).trim();
      if (quote.length > 360) quote = `${quote.slice(0, 357).trim()}...`;
      return { document: doc.name, quote };
    }
  }
  return null;
}

/** The part a line names is a body panel, by its last name word. */
export function isPanelDescription(desc: string): boolean {
  return isPanel({ line: null, oper: null, desc, hours: 0, paintHours: 0, price: 0 });
}

/** Two descriptions name the same part on the same side (see sharesPanel). */
export function samePart(aDesc: string, bDesc: string): boolean {
  const line = (desc: string): RationaleLine => ({ line: null, oper: null, desc, hours: 0, paintHours: 0, price: 0 });
  return sharesPanel(line(aDesc), line(bDesc));
}

function explainFromSheets(ctx: RationaleContext): LaborRationale | null {
  if (!ctx.higher.length) return null;
  const v = voiceFor(ctx.voice);
  for (const rule of RULES) {
    const result = rule(ctx, v);
    if (!result) continue;
    if (ctx.lower || result.key === "damage_scope") return result;
    // A line the matcher left unpaired may still be on their sheet, written
    // under another operation ("Algn RT Striker" against "R&I RT Striker") or
    // fewer times. Say so before the argument, so it is checked first.
    const head = ctx.higher[0];
    // A blend's twin is already read by the blend rule itself.
    const kin = ctx.lowerSheet.filter((l) => sharesPanel(head, l) && !(op(head) === "blnd" && op(l) === "blnd"));
    if (!kin.length) return result;
    const listed = kin
      .slice(0, 2)
      .map((l) => `${v.loRef([l.line])} (${l.oper ? `${l.oper} ` : ""}${withoutMarkup(l.desc)})`)
      .join(" and ");
    return {
      ...result,
      why: `Check first: ${listed} ${kin.length === 1 ? "names" : "name"} the same part${
        kin.some((l) => op(l) !== op(head)) ? " under a different operation" : ""
      }, so this may be a wording or count difference rather than work left out. ${result.why}`,
    };
  }
  return null;
}

/** Exported for tests. */
export const __test = { perPanelHours, markupOf, repairAbove, sharesPanel, partName, findCaseRequirement };
