/**
 * APPRAISAL DISPUTE REPORT — model builder and document builder.
 *
 * Third output of the Delta pipeline: a shop-staff-only, plain-English
 * companion to the Forensic Estimate Analysis and the Delta Citation Density
 * annotated estimate. It consumes the SAME data the Forensic report is
 * rendered from — the reconciled category totals and the numbered findings —
 * and produces a `DeltaForensicReportModel` that the existing forensic PDF
 * renderer draws, so it shares the masthead, footer and pagination of the
 * report it accompanies.
 *
 * Pure functions, no I/O:
 *
 *   const model = buildPlainSummaryModel(input);      // numbers + selected lines
 *   const doc   = buildPlainSummaryDocument(model);   // sections and blocks
 *   const pdf   = await renderPlainSummaryPdf(model); // via renderDeltaForensicReport
 *
 * Every dollar and hour in the output is read from `input`; nothing is
 * inferred. If a bucket cannot be computed from the input it is omitted or
 * printed as "not shown", never guessed (the rules file's nullIsNotZero).
 *
 * Fixed copy — the say/don't-say table, the "not bad faith" sentence, the
 * caveat that findings are estimate-difference evidence only, and the four
 * resolution steps — is the compliance guardrail. It mirrors the Forensic
 * report's "What the vehicle owner should know" and "Recommended path" and
 * should change only together with those.
 *
 * Audience: internal shop staff. Never surfaced in the customer-facing
 * Snapshot report or in anything carrier-facing.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { DeltaForensicReportModel, ForensicBlock, ForensicSection, ForensicTableRow } from "./deltaForensicReport";
import { loadCollisionIqLogo, renderDeltaForensicReport } from "./deltaForensicReportRenderer";

// ---------------------------------------------------------------------------
// Input contract — the narrow slice of the delta this module needs. Mapped
// from the Forensic report's input in plainLanguageSummaryAdapter.ts.
// ---------------------------------------------------------------------------

export type DeltaCategory =
  | "missing_operation"        // on higher estimate, no counterpart on lower
  | "part_or_price_difference" // paired, different price
  | "reduced_labor"            // paired, lower estimate allows fewer hours
  | "rate_difference"          // category rate differs
  | "category_amount"          // category total differs (parts, misc)
  | "total_difference"         // grand total finding
  | "lower_only_lines"         // lines present only on the lower estimate
  | "support_review";          // e.g. sand & polish needing P-page support

export type FindingSection = "structural" | "adas" | "refinish" | "other";

export interface Finding {
  id: number;                  // finding number, same as the badge on the Citation Density copy
  category: DeltaCategory;
  section: FindingSection;
  title: string;               // "RT Mirror assy power folding w/side camera"
  lineA?: number;              // line number on the higher (shop) estimate
  lineB?: number;              // line number on the lower (comparison) estimate
  amountDelta?: number;        // $ (positive = higher estimate is more)
  laborDelta?: number;         // hours
  paintDelta?: number;         // hours
  priceA?: number;             // printed price on higher estimate (for placeholder detection)
  priceB?: number;
  lowerOnlyCount?: number;     // only for lower_only_lines
  lowerOnlySamples?: string[]; // a few human-readable examples, already formatted
}

/** A labor-type category. `hours`/`rate` are null when the document prints a
 *  flat figure with no basis — an absent basis is not a zero basis. */
export interface LaborCategory {
  hours: number | null;
  rate: number | null;
  total: number;
}

export interface EstimateTotals {
  parts: number | null;
  bodyLabor: LaborCategory | null;
  paintLabor: LaborCategory | null;
  paintSupplies: LaborCategory | null; // "hours" = paint hours the materials ride on
  miscellaneous: number | null;
  /** Categories outside the five buckets (mechanical, frame, sublet…), summed. */
  other?: { label: string; total: number } | null;
  subtotal: number | null;
  tax: number | null;
  total: number;
}

export interface EstimateDoc {
  title: string;               // "Shop Post-TD 22264.pdf"
  label?: string;              // "Coast National" etc. Optional carrier/author label
  lineCount: number | null;
  totals: EstimateTotals;
}

export interface PlainSummaryInput {
  preparedDate: string;        // "2026-09-17"
  vehicle: string;             // "2023 Audi Q5 45 S Line Prestige"
  roNumber?: string;
  docA: EstimateDoc;           // higher-cost estimate (the shop's)
  docB: EstimateDoc;           // comparison estimate (the carrier's)
  findings: Finding[];
  missingLineCount: number;    // Appendix A count (107 on RO 22264)
  /** Categories the reconciliation could not price on one document; named, not zeroed. */
  unpricedCategories?: string[];
  /** Identity rows for the masthead, already redacted to the export policy. */
  identity?: Array<{ label: string; value: string }>;
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type BucketKey = "parts" | "bodyLabor" | "paintLabor" | "paintSupplies" | "misc" | "other" | "tax" | "total";

export interface Bucket {
  key: BucketKey;
  label: string;
  ours: string;
  theirs: string;
  /** null when one side's figure is not printed — "not quantified", never zero. */
  gap: number | null;
  plain: string;
}

export interface NamedLine {
  finding: number;
  line?: number;
  title: string;
  amount?: number;
  hours?: number;
  kind: "labor" | "paint";
}

export interface RateEffect {
  body: number | null;
  paint: number | null;
  supplies: number | null;
  total: number;
  bodyRateGap: number | null;
  paintRateGap: number | null;
  suppliesRateGap: number | null;
  /** Labor + paint + supplies gap (over the categories with a basis) minus the rate effect. */
  hoursEffect: number;
  /** Categories left out of the split because one document prints no hours or rate. */
  excluded: string[];
}

export interface PlainSummaryModel {
  header: {
    vehicle: string;
    roNumber?: string;
    preparedDate: string;
    ours: string;
    theirs: string;
    gap: number;
  };
  identity: Array<{ label: string; value: string }>;
  buckets: Bucket[];
  rateEffect: RateEffect | null;
  hoursGap: { body: number | null; paint: number | null };
  parts: { top: NamedLine[]; lowerOnly?: Finding };
  paintHours: NamedLine[];      // blends, clear coat adds, feather/prime/block
  bodyHours: NamedLine[];       // door shells, test fits, R&I trim
  bumperOverhaul?: Finding;     // the reduced_labor bumper finding, if present
  adas: {
    /** ADAS lines with NO counterpart on the comparison estimate. */
    lines: NamedLine[];
    /** ADAS lines the comparison estimate DOES price, at a different figure. */
    priced: Array<NamedLine & { priceA?: number; priceB?: number }>;
    placeholders: NamedLine[];
    scanPriceDiff?: Finding;
  };
  misc: NamedLine[];
  supportReview: Finding[];
  missingLineCount: number;
  lowerOnlyCount: number;
  unpricedCategories: string[];
}

export const money = (n: number): string =>
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hrs = (n: number) => n.toFixed(1).replace(/\.0$/, "") + " hr";
const laborCell = (c: LaborCategory | null): string => {
  if (!c) return "not shown";
  if (c.hours !== null && c.rate !== null) return `${c.hours.toFixed(1)} hr @ $${c.rate.toFixed(0)}`;
  return `flat ${money(c.total)}, no hrs/rate shown`;
};
const moneyCell = (n: number | null): string => (n === null ? "not shown" : money(n));
const r2 = (n: number) => Math.round(n * 100) / 100;
const gapOf = (a: number | null | undefined, b: number | null | undefined): number | null =>
  typeof a === "number" && typeof b === "number" ? r2(a - b) : null;

export const PAINT_OP = /\b(blnd|blend|clear coat|feather|prime|block|edging|refinish)\b/i;
export const BODY_OP = /\b(door shell|test fit|r&i|r & i|remove|install|weatherstrip|run channel|trim|glass|molding|mldg|liner)\b/i;
// ADAS *procedures* (calibrations, scans, measurements) — not physical parts that happen to carry a camera.
export const ADAS_OP = /(calibrat|scan\b|adas|control points|function test)/i;
export const MISC_OP = /\b(alignment|transport|mount|balance|tire disposal|cavity wax|masking|primer|urethane|adhesive|mask for|protect wiring|wash|debris|waste|nozzle|acid brush|flex additive|interior protection|static charge)\b/i;
const SCAN_PRE = /pre-?repair scan/i;
const BUMPER_OH = /o\/h bumper|overhaul bumper|bumper assy/i;

export function buildPlainSummaryModel(input: PlainSummaryInput): PlainSummaryModel {
  const A = input.docA.totals, B = input.docB.totals;
  const gap = r2(A.total - B.total);

  const buckets: Bucket[] = [];
  const bucket = (b: Bucket) => buckets.push(b);

  if (A.parts !== null || B.parts !== null) {
    bucket({ key: "parts", label: "Parts", ours: moneyCell(A.parts), theirs: moneyCell(B.parts), gap: gapOf(A.parts, B.parts),
      plain: "Biggest single bucket when part type differs: new OEM on ours; used, aftermarket, reconditioned or nothing on theirs." });
  }
  if (A.bodyLabor || B.bodyLabor) {
    bucket({ key: "bodyLabor", label: "Body labor", ours: laborCell(A.bodyLabor), theirs: laborCell(B.bodyLabor),
      gap: gapOf(A.bodyLabor?.total, B.bodyLabor?.total), plain: describeLabor(A.bodyLabor, B.bodyLabor, "") });
  }
  if (A.paintLabor || B.paintLabor) {
    bucket({ key: "paintLabor", label: "Paint labor", ours: laborCell(A.paintLabor), theirs: laborCell(B.paintLabor),
      gap: gapOf(A.paintLabor?.total, B.paintLabor?.total),
      plain: describeLabor(A.paintLabor, B.paintLabor, " Blends and clear-coat adds are usually where the hours went.") });
  }
  if (A.paintSupplies || B.paintSupplies) {
    bucket({ key: "paintSupplies", label: "Paint supplies", ours: laborCell(A.paintSupplies), theirs: laborCell(B.paintSupplies),
      gap: gapOf(A.paintSupplies?.total, B.paintSupplies?.total),
      plain: "Materials ride on paint hours, so fewer hours plus a lower materials rate hits twice." });
  }
  if (A.miscellaneous !== null || B.miscellaneous !== null) {
    bucket({ key: "misc", label: "Miscellaneous / sublet", ours: moneyCell(A.miscellaneous), theirs: moneyCell(B.miscellaneous),
      gap: gapOf(A.miscellaneous, B.miscellaneous),
      plain: "Alignment, transport to and from sublet, mount & balance, and shop materials they did not write." });
  }
  if (A.other || B.other) {
    const label = A.other?.label ?? B.other?.label ?? "Other categories";
    bucket({ key: "other", label, ours: moneyCell(A.other?.total ?? null), theirs: moneyCell(B.other?.total ?? null),
      gap: gapOf(A.other?.total, B.other?.total), plain: "Categories outside the five above, taken from the printed totals." });
  }
  if (A.tax !== null || B.tax !== null) {
    bucket({ key: "tax", label: "Sales tax", ours: moneyCell(A.tax), theirs: moneyCell(B.tax), gap: gapOf(A.tax, B.tax), plain: "Follows the rest." });
  }
  bucket({ key: "total", label: "Total", ours: money(A.total), theirs: money(B.total), gap, plain: "" });

  // Rate-only effect, computed on OUR hours (so it's the "before anyone argues
  // an hour" number). Only categories both documents price with a basis take
  // part; a flat figure with no rate is named as excluded, not treated as $0/hr.
  let rateEffect: RateEffect | null = null;
  {
    const split = (ours: LaborCategory | null, theirs: LaborCategory | null) => {
      if (!ours || !theirs || ours.hours === null || ours.rate === null || theirs.rate === null) return null;
      const rateGap = r2(ours.rate - theirs.rate);
      return { rateGap, effect: r2(ours.hours * rateGap), gap: r2(ours.total - theirs.total) };
    };
    const body = split(A.bodyLabor, B.bodyLabor);
    const paint = split(A.paintLabor, B.paintLabor);
    const supplies = split(A.paintSupplies, B.paintSupplies);
    const included = [body, paint, supplies].filter((x): x is NonNullable<typeof x> => x !== null);
    const excluded = [
      !body && (A.bodyLabor || B.bodyLabor) ? "body labor" : "",
      !paint && (A.paintLabor || B.paintLabor) ? "paint labor" : "",
      !supplies && (A.paintSupplies || B.paintSupplies) ? "paint supplies" : "",
    ].filter(Boolean);
    if (included.some((x) => x.rateGap !== 0)) {
      const total = r2(included.reduce((sum, x) => sum + x.effect, 0));
      const laborGap = r2(included.reduce((sum, x) => sum + x.gap, 0));
      rateEffect = {
        body: body?.effect ?? null,
        paint: paint?.effect ?? null,
        supplies: supplies?.effect ?? null,
        total,
        bodyRateGap: body?.rateGap ?? null,
        paintRateGap: paint?.rateGap ?? null,
        suppliesRateGap: supplies?.rateGap ?? null,
        hoursEffect: r2(laborGap - total),
        excluded,
      };
    }
  }

  const F = input.findings;
  const named = (f: Finding, kind: "labor" | "paint"): NamedLine => ({
    finding: f.id, line: f.lineA, title: f.title, amount: f.amountDelta, hours: kind === "paint" ? f.paintDelta : f.laborDelta, kind,
  });

  const missing = F.filter((f) => f.category === "missing_operation" || f.category === "part_or_price_difference");
  const isAdas = (f: Finding) => ADAS_OP.test(f.title);

  // Parts: biggest dollar lines that are not ADAS/misc/sublet.
  const partsTop = missing
    .filter((f) => (f.amountDelta ?? 0) > 0 && !isAdas(f) && !MISC_OP.test(f.title))
    .sort((a, b) => (b.amountDelta ?? 0) - (a.amountDelta ?? 0))
    .slice(0, 8)
    .map((f) => named(f, "labor"));

  const paintHours = missing
    .filter((f) => (f.paintDelta ?? 0) > 0 && PAINT_OP.test(f.title))
    .sort((a, b) => (b.paintDelta ?? 0) - (a.paintDelta ?? 0))
    .slice(0, 8)
    .map((f) => named(f, "paint"));

  const bodyHours = missing
    .filter((f) => (f.laborDelta ?? 0) > 0 && !isAdas(f) && (BODY_OP.test(f.title) || (f.amountDelta ?? 0) === 0))
    .sort((a, b) => (b.laborDelta ?? 0) - (a.laborDelta ?? 0))
    .slice(0, 8)
    .map((f) => named(f, "labor"));

  const adasAll = F.filter((f) => isAdas(f) && f.category !== "support_review" && f.category !== "lower_only_lines");
  // Read from the SAME computed findings the forensic report prints: a
  // priced-differently ADAS line is priced on both estimates and is never
  // "missing on theirs" (RO 21336: five sublet calibrations at +25% vs +34%
  // were narrated as "the insurer wrote none of them at a real price").
  const adasMissing = adasAll.filter((f) => f.category === "missing_operation");
  const adasPriced = adasAll.filter((f) => f.category !== "missing_operation");
  const adasLines = adasMissing.map((f) => named(f, "labor"));
  const adasPricedLines = adasPriced.map((f) => ({ ...named(f, "labor"), priceA: f.priceA, priceB: f.priceB }));
  const placeholders = adasAll
    .filter((f) => f.priceA !== undefined && f.priceA > 0 && f.priceA <= 0.01)
    .map((f) => named(f, "labor"));
  const scanPriceDiff = adasAll.find((f) => f.category === "part_or_price_difference" && SCAN_PRE.test(f.title));

  const misc = missing
    .filter((f) => MISC_OP.test(f.title) && !isAdas(f) && (f.amountDelta ?? 0) > 0)
    .sort((a, b) => (b.amountDelta ?? 0) - (a.amountDelta ?? 0))
    .slice(0, 10)
    .map((f) => named(f, "labor"));

  const lowerOnly = F.find((f) => f.category === "lower_only_lines");

  return {
    header: { vehicle: input.vehicle, roNumber: input.roNumber, preparedDate: input.preparedDate, ours: input.docA.title, theirs: input.docB.title, gap },
    identity: input.identity ?? [],
    buckets,
    rateEffect,
    hoursGap: {
      body: gapOf(A.bodyLabor?.hours, B.bodyLabor?.hours),
      paint: gapOf(A.paintLabor?.hours, B.paintLabor?.hours),
    },
    parts: { top: partsTop, lowerOnly },
    paintHours,
    bodyHours,
    bumperOverhaul: F.find((f) => f.category === "reduced_labor" && BUMPER_OH.test(f.title)),
    adas: { lines: adasLines, priced: adasPricedLines, placeholders, scanPriceDiff },
    misc,
    supportReview: F.filter((f) => f.category === "support_review"),
    missingLineCount: input.missingLineCount,
    lowerOnlyCount: lowerOnly?.lowerOnlyCount ?? 0,
    unpricedCategories: input.unpricedCategories ?? [],
  };
}

function describeLabor(a: LaborCategory | null, b: LaborCategory | null, tail: string): string {
  if (!a || !b) return "Printed on one document only; see the note under the table.";
  const dh = gapOf(a.hours, b.hours);
  const dr = gapOf(a.rate, b.rate);
  const parts: string[] = [];
  if (dh !== null && dh > 0) parts.push(`${hrs(dh)} fewer hours`);
  if (dr !== null && dr > 0) parts.push(`$${dr.toFixed(0)}/hr less`);
  if (dh === null && dr === null) return "One side prints a flat figure with no hours or rate, so the split cannot be stated.";
  if (!parts.length) return "No difference in this category.";
  return parts.join(" and ") + "." + tail;
}

// ---------------------------------------------------------------------------
// Document — sections and blocks for the shared forensic renderer
// ---------------------------------------------------------------------------

const REPORT_TITLE = "Appraisal Dispute Report";

/** Footer line stamped on every page: title | RO | vehicle | audience. The
 *  renderer appends the page number. */
export function plainSummaryFooterLine(model: PlainSummaryModel): string {
  return [REPORT_TITLE, model.header.roNumber ? `RO ${model.header.roNumber}` : "", model.header.vehicle, "Shop staff only"]
    .filter(Boolean)
    .join(" | ");
}

export function buildPlainSummaryDocument(model: PlainSummaryModel): DeltaForensicReportModel {
  const ro = model.header.roNumber ? ` | RO ${model.header.roNumber}` : "";
  const byKey = (key: BucketKey) => model.buckets.find((b) => b.key === key);
  const total = byKey("total")!;
  const list = (xs: NamedLine[], fmt: (x: NamedLine) => string) => xs.map(fmt).join(", ");
  const amt = (x: NamedLine) => `${x.title} (${money(x.amount ?? 0)})`;
  const hr = (x: NamedLine) => `${x.title} (${(x.hours ?? 0).toFixed(1)})`;
  const gapText = (b: Bucket | undefined) => (b && b.gap !== null ? money(b.gap) : "not quantified");
  const priced = model.adas.scanPriceDiff;
  const pricedBoth = priced && typeof priced.priceA === "number" && typeof priced.priceB === "number" ? priced : undefined;

  const sections: ForensicSection[] = [];
  let number = 0;
  const section = (title: string, blocks: ForensicBlock[]) => {
    number += 1;
    sections.push({ number, title, blocks });
  };

  // Header table: the two documents, the gap, the companions, the audience.
  const orientation: ForensicBlock = {
    kind: "table",
    columns: [{ header: "Orientation", weight: 22 }, { header: "Detail", weight: 78 }],
    rows: [
      { cells: ["Our estimate", `${model.header.ours} — ${total.ours}`] },
      { cells: ["Their estimate", `${model.header.theirs} — ${total.theirs}`] },
      { cells: ["The gap", money(model.header.gap)], variant: "total" },
      { cells: ["Companion reports", "Forensic Estimate Analysis & Repair Cost Gap Report (the narrative) and the Delta Citation Density copy of our estimate (the highlighted version)"] },
      { cells: ["Audience", "Internal. For the front desk, estimators and anyone who has to explain this to the owner. Not for the carrier, not for the customer's file as-is."] },
    ],
  };

  section("A note for the customer (copy and paste)", [
    {
      kind: "note",
      text: "Written for the vehicle owner, in the shop's voice. Paste it into an email or a text as-is, or edit it. It uses only the figures on the two estimates and stays inside the say / don't-say rules further down: no promise about what the carrier will pay, no date, no comment on anyone's intent.",
    },
    { kind: "callout", tone: "owner", paragraphs: [buildCustomerNote(model)] },
  ]);

  section("The thirty-second version", [
    orientation,
    {
      kind: "callout",
      tone: "owner",
      paragraphs: [
        `Two people looked at the same car and wrote two very different repair plans. Ours is ${total.ours}. The insurer's is ${total.theirs}. The difference is ${money(model.header.gap)}, and it comes from three things: parts (they priced cheaper part types or left parts off), labor rates and hours (${model.rateEffect ? "they pay less per hour and allow fewer hours" : "they allow fewer hours"}), and a long list of operations they simply did not write (${model.missingLineCount} of our lines have no match on their sheet). Nothing in the two reports says anyone acted in bad faith. This is a disagreement between two appraisers, and most of it gets settled at the car, not on paper.`,
      ],
    },
  ]);

  const bucketRows: ForensicTableRow[] = model.buckets.map((b) => ({
    cells: [b.label, b.ours, b.theirs, gapText(b), b.plain],
    variant: b.key === "total" ? "total" : "body",
  }));
  const moneyBlocks: ForensicBlock[] = [
    { kind: "paragraph", text: "Every dollar below comes straight off the printed totals of the two estimates. Tax is left out of the buckets because it just follows whatever the rest settles at." },
    {
      kind: "table",
      columns: [
        { header: "Bucket", weight: 16 },
        { header: "Ours", weight: 15, align: "right" },
        { header: "Theirs", weight: 15, align: "right" },
        { header: "Gap (ours − theirs)", weight: 12, align: "right" },
        { header: "What that means in plain words", weight: 42 },
      ],
      rows: bucketRows,
    },
  ];
  if (model.unpricedCategories.length) {
    moneyBlocks.push({
      kind: "note",
      text: `Not quantified: ${model.unpricedCategories.join(", ")}. One document's printed total for that category could not be read, so the gap is left blank rather than assumed to be zero.`,
    });
  }
  if (model.rateEffect) {
    const r = model.rateEffect;
    const gaps = [
      r.bodyRateGap ? `body x $${r.bodyRateGap}` : "",
      r.paintRateGap ? `paint x $${r.paintRateGap}` : "",
      r.suppliesRateGap ? `materials x $${r.suppliesRateGap}` : "",
    ].filter(Boolean).join(", ");
    moneyBlocks.push({
      kind: "paragraph",
      text: `The rate piece by itself. Before anyone argues about a single hour, the rate difference alone is worth about ${money(r.total)} on our hours (${gaps}). The other roughly ${money(r.hoursEffect)} of the labor-and-materials gap is hours. Keep those two arguments separate; they get settled by different people with different evidence.${
        r.excluded.length ? ` ${capitalize(r.excluded.join(" and "))} ${r.excluded.length === 1 ? "is" : "are"} left out of this split because one document prints a flat figure with no hours or rate.` : ""
      }`,
    });
  }
  section("Where the money is", moneyBlocks);

  section("The four kinds of difference you will see", [
    { kind: "paragraph", text: "The Forensic report labels each finding with one of these. Knowing which one you are looking at tells you what proof it needs." },
    {
      kind: "table",
      columns: [
        { header: "Label on the report", weight: 18 },
        { header: "Plain English", weight: 22 },
        { header: "Example on this car", weight: 32 },
        { header: "What settles it", weight: 28 },
      ],
      rows: [
        {
          cells: [
            "Missing from comparison estimate",
            "We wrote it. They did not write it at all.",
            `${[model.parts.top.slice(0, 3).map(amt).join(", "), model.paintHours.length ? "blends, clear-coat adds" : ""].filter(Boolean).join(", ")}${model.parts.top.length || model.paintHours.length ? ". " : ""}This is ${model.missingLineCount} lines.`,
            "Show it is needed: photos, OEM procedure, the part actually installed, the sublet invoice.",
          ],
        },
        {
          cells: [
            "Priced differently",
            "Both wrote it. They put a different number on it.",
            pricedBoth
              ? `${pricedBoth.title}: ${money(pricedBoth.priceA!)} on ours, ${money(pricedBoth.priceB!)} on theirs.`
              : "See findings marked 'priced differently'.",
            "Supplier or sublet invoice.",
          ],
        },
        {
          cells: [
            "Rate / amount difference",
            "Same category, different hourly rate or category total.",
            model.rateEffect ? describeRateGaps(model.rateEffect) : "No rate difference on this loss.",
            "Our posted rate and what this market actually pays. A rate argument, not a repair argument.",
          ],
        },
        {
          cells: [
            "Lines only on the lower estimate",
            "They wrote something we did not.",
            `${model.lowerOnlyCount} lines${model.parts.lowerOnly?.lowerOnlySamples?.length ? ": " + model.parts.lowerOnly.lowerOnlySamples.join(", ") : ""}.`,
            "Usually the cheaper-part version of something we wrote as OEM. Match them up before assuming anything is \"extra.\"",
          ],
        },
      ],
    },
  ]);

  const bucketBlocks: ForensicBlock[] = [];
  bucketBlocks.push({ kind: "subheading", text: `Parts (${gapText(byKey("parts"))} gap)` });
  if (model.parts.top.length) {
    bucketBlocks.push({
      kind: "paragraph",
      text: `This is mostly a part-type disagreement, not a "did the part get hit" disagreement. Our biggest lines with no match on their sheet: ${list(model.parts.top, amt)}.${
        model.parts.lowerOnly?.lowerOnlySamples?.length ? ` Their sheet has ${model.parts.lowerOnly.lowerOnlySamples.join(", ")} in roughly the same spots.` : ""
      }`,
    });
  }
  bucketBlocks.push({
    kind: "bullets",
    items: [
      "Say: \"We wrote new factory parts. The insurer wrote used, aftermarket or reconditioned. That is where most of the parts money is.\"",
      "Do not say the used or aftermarket parts are unsafe or illegal. The reports do not say that, and OEM position statements are guidance, not law.",
      "Keep the parts-type question separate from the labor question. Bundling a small parts argument with a big labor argument tends to stall both.",
    ],
  });

  if (model.rateEffect) {
    bucketBlocks.push({ kind: "subheading", text: "Labor rates" });
    bucketBlocks.push({
      kind: "paragraph",
      text: `Their estimate pays less per hour in the labor categories that print a rate. A rate gap compounds across every hour, which is why it is worth about ${money(model.rateEffect.total)} by itself. This is a shop-versus-carrier business question, not something the estimator proves with photos.`,
    });
    bucketBlocks.push({
      kind: "bullets",
      items: [
        "Say: \"Our posted rate is what we wrote. The insurer's estimate is written at a lower rate. That difference alone is real money on a job this size.\"",
        "Do not promise the customer the carrier will pay our rate.",
      ],
    });
  }

  const hoursLabel = [
    model.hoursGap.body !== null ? `${model.hoursGap.body.toFixed(1)} body` : "",
    model.hoursGap.paint !== null ? `${model.hoursGap.paint.toFixed(1)} paint` : "",
  ].filter(Boolean).join(", ");
  bucketBlocks.push({ kind: "subheading", text: hoursLabel ? `Labor hours (${hoursLabel})` : "Labor hours" });
  const hoursText = [
    model.paintHours.length ? `The missing paint hours are mostly ${list(model.paintHours, hr)}.` : "",
    model.bodyHours.length ? `The missing body hours are ${list(model.bodyHours, hr)}.` : "",
  ].filter(Boolean).join(" ");
  if (hoursText) bucketBlocks.push({ kind: "paragraph", text: hoursText });
  const hoursItems = [
    "Say: \"The insurer's sheet skips the blend panels and most of the trim removal. Those hours are real work; they are on the sheet because that is how the car goes back together.\"",
  ];
  if (model.bumperOverhaul) {
    hoursItems.push(
      `The single largest hours line to defend: ${model.bumperOverhaul.title}${findingRef(model.bumperOverhaul.id)}. The report flags it as a quantity shortfall against the comparison estimate, so expect pushback.`
    );
  }
  bucketBlocks.push({ kind: "bullets", items: hoursItems });

  if (model.adas.lines.length || model.adas.priced.length) {
    bucketBlocks.push({ kind: "subheading", text: "Safety systems / ADAS (small dollars now, big dollars later)" });
    const pricedText = model.adas.priced.length
      ? `The insurer priced ${model.adas.priced.length === 1 ? "this one" : `${model.adas.priced.length} of them`} at a different figure: ${model.adas.priced
          .map((x) =>
            typeof x.priceA === "number" && typeof x.priceB === "number"
              ? `${x.title} (${money(x.priceA)} on ours, ${money(x.priceB)} on theirs)`
              : x.title
          )
          .join(", ")}. `
      : "";
    const missingText = model.adas.lines.length
      ? `${model.adas.priced.length ? "" : "The insurer wrote none of them at a real price. "}Missing on theirs: ${model.adas.lines.map((x) => x.title).join(", ")}.`
      : "";
    bucketBlocks.push({
      kind: "paragraph",
      text: `${model.adas.placeholders.length ? `${model.adas.placeholders.length} calibration and scan lines on our sheet are written at $0.01 as a placeholder, cost open to the dealer invoice. ` : ""}${
        pricedBoth && !model.adas.priced.length ? `${pricedBoth.title}: ${money(pricedBoth.priceA!)} on ours, ${money(pricedBoth.priceB!)} on theirs. ` : ""
      }${pricedText}${missingText}`.trim(),
    });
    bucketBlocks.push({
      kind: "bullets",
      items: [
        "Say: \"The car has cameras and radar on the side that was hit. The manufacturer requires those be recalibrated after the repair. That cost is not on the insurer's estimate yet because we do not have the dealer invoice yet.\"",
        "Tell the owner in writing that the systems will be calibrated and that they will get the post-repair scan report.",
      ],
    });
  }

  if (model.misc.length) {
    bucketBlocks.push({ kind: "subheading", text: `Miscellaneous and sublet (${gapText(byKey("misc"))} gap)` });
    bucketBlocks.push({
      kind: "paragraph",
      text: `${list(model.misc, amt)}, plus small shop-supply lines. Individually tiny; together ${gapText(byKey("misc"))}.`,
    });
    bucketBlocks.push({
      kind: "bullets",
      items: ["Say: \"These are the shop-supply and sublet items. They are on our sheet because we buy them or pay someone for them. Each one has a receipt.\""],
    });
  }
  section("Bucket by bucket: what to say", bucketBlocks);

  section("Things to say, things not to say", [
    {
      kind: "table",
      columns: [{ header: "Say this", weight: 50 }, { header: "Not this", weight: 50 }],
      rows: [
        { cells: ["\"Two appraisers disagree. That is normal. Most of it gets resolved when the damaged panels come off and both sides look at the car.\"", "\"The insurance company is lowballing you\" or anything about intent or bad faith. The reports say the opposite."] },
        { cells: ["\"You choose the repair shop. Nobody can require you to use a particular one.\"", "\"The carrier has to pay whatever we write.\" They do not, and this is not a number we can promise."] },
        { cells: ["\"A supplement is a step in the process, not the final answer.\"", "\"This will be fixed in a week.\" Supplements and reinspections take time; do not set a date."] },
        { cells: ["\"Your policy has a section on what happens when the two sides cannot agree on the amount. Read it, or ask your agent.\"", "Explaining the appraisal clause, quoting it, or telling the owner to invoke it. That is legal territory and not the shop's role."] },
        { cells: ["\"Keep every document: both estimates, every supplement, scan reports, parts invoices.\"", "Handing the owner the highlighted Citation Density copy. It is a working document, not a customer document."] },
      ],
    },
  ]);

  const proofItems = [
    "Parts: supplier invoices and the part-type authorization for every OEM part.",
    "Labor and paint hours: the OEM repair procedure for each disputed operation, and CCC/MOTOR P-page support for anything the database does not include automatically.",
    ...model.supportReview.map((f) => `${f.title}${findingRef(f.id)} is specifically flagged as needing CCC/MOTOR P-page or database support.`),
    "ADAS: scan reports, the dealer calibration invoice, and completion proof for each calibration.",
    "Sublet and misc: the alignment, transport, and tire-supplier invoices.",
  ];
  section("The honest caveat: what these reports prove and what they do not", [
    {
      kind: "paragraph",
      text: "Every finding rests on the two estimates themselves. The reports prove that a difference exists and put a dollar figure on it. They do not yet prove that our side of each difference is the correct one. Every finding is stamped \"support needed, not retrieved.\" Nothing external (an OEM repair procedure, a P-page, an invoice) is attached to any line yet.",
    },
    { kind: "paragraph", text: "The report is the map, not the ammunition. The ammunition still has to be collected:" },
    { kind: "bullets", items: proofItems },
  ]);

  section("What happens next", [
    {
      kind: "steps",
      items: [
        "Reinspection at the car with both appraisers present and the damaged assemblies off. The biggest items are far easier to settle in person than by email.",
        "Clean up our own sheet first. Fix any internal inconsistencies (a part with no labor to install it, an operation denied while a dependent one is allowed) before the hard items.",
        "Attach the OEM procedure to every disputed labor operation before it goes back to the carrier.",
        "Argue parts type and labor separately.",
      ],
    },
  ]);

  section("Reading the two companion reports", [
    {
      kind: "table",
      columns: [{ header: "Report", weight: 24 }, { header: "How to read it", weight: 76 }],
      rows: [
        { cells: ["Forensic Estimate Analysis", `The narrative. Section 3 is the plain-language summary; Section 4 is the money table above. Findings are numbered and grouped into structural, ADAS, refinish and "other." Appendix A lists all ${model.missingLineCount} of our lines that have no match on theirs. Line numbers refer to our estimate, not theirs.`] },
        { cells: ["Delta Citation Density", "Our estimate with the differences painted on. Yellow highlight on a line means it differs from the insurer's sheet. The red numbered badge in the left margin is the finding number from the Forensic report. The red footnotes at the bottom of each page say what the insurer wrote instead. The legend is on the last page."] },
      ],
    },
    {
      kind: "note",
      text: `Source figures: Forensic Estimate Analysis & Repair Cost Gap Report and Delta Citation Density Report${ro}, both prepared ${model.header.preparedDate}. The vehicle was not physically inspected for either report; hidden damage may change both estimates. This summary is not legal advice.`,
    },
  ]);

  return {
    title: REPORT_TITLE,
    subtitle: `Shop talking points for the two estimates on this loss | ${model.header.vehicle}${ro} | Prepared ${model.header.preparedDate}`,
    generatedLabel: `Prepared ${model.header.preparedDate}`,
    identity: model.identity,
    sections,
    footerLine: plainSummaryFooterLine(model),
  };
}

/**
 * The customer-facing paragraph a manager can paste into an email.
 *
 * Customer wording, so it names no line numbers, no finding numbers and no
 * internal report. Every figure is one the two estimates print; each driver
 * of the gap is named only when the estimates show it (a parts gap, a rate
 * or hours difference, operations with no counterpart, ADAS lines). It makes
 * no claim about part quality, the carrier's intent, or what will be paid.
 */
export function buildCustomerNote(model: PlainSummaryModel): string {
  const total = model.buckets.find((b) => b.key === "total")!;
  const parts = model.buckets.find((b) => b.key === "parts");
  const drivers: string[] = [];
  if (parts && parts.gap !== null && parts.gap > 0) {
    drivers.push("which replacement parts are written and how they are priced");
  }
  const hoursShort = (model.hoursGap.body ?? 0) > 0 || (model.hoursGap.paint ?? 0) > 0;
  if (model.rateEffect && hoursShort) {
    drivers.push("the hourly labor rate and the number of labor hours allowed");
  } else if (model.rateEffect) {
    drivers.push("the hourly labor rate");
  } else if (hoursShort) {
    drivers.push("the number of labor hours allowed");
  }
  if (model.missingLineCount > 0) {
    drivers.push(
      `${model.missingLineCount} ${model.missingLineCount === 1 ? "operation" : "operations"} on our estimate that the insurance estimate does not include yet`
    );
  }
  const driverSentence = drivers.length
    ? ` The difference comes mainly from ${sentenceList(drivers)}.`
    : "";
  const adasSentence = model.adas.lines.length
    ? " Your vehicle has driver-assistance cameras or sensors on the damaged side, and the manufacturer requires them to be recalibrated after the repair. That work is on our estimate, and we will make sure it is completed and documented for you."
    : "";
  return (
    `Thank you for trusting us with your ${model.header.vehicle}. Two repair plans have been written for it. Ours comes to ${total.ours}, and the insurance company's appraiser has written ${total.theirs}, a difference of ${money(model.header.gap)}. A gap like this is common at this stage and does not mean anyone has acted in bad faith; two appraisers looked at the same vehicle and reached different conclusions.` +
    driverSentence +
    adasSentence +
    " The next step is a supplement and a joint reinspection with the damaged panels removed, which is where most of these differences get settled. We will keep you updated as that happens, and we will keep every estimate, supplement and invoice on file for you. Please call us with any questions."
  );
}

function sentenceList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function describeRateGaps(r: RateEffect): string {
  const parts = [
    r.bodyRateGap ? `$${r.bodyRateGap}/hr body` : "",
    r.paintRateGap ? `$${r.paintRateGap}/hr paint` : "",
    r.suppliesRateGap ? `$${r.suppliesRateGap}/hr materials` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join("; ")}.` : "Rates agree; the difference is category totals.";
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/** " (Finding 27)" when the finding carries a badge number; nothing otherwise —
 *  an unnumbered finding is never given a number here. */
function findingRef(id: number): string {
  return id > 0 ? ` (Finding ${id})` : "";
}

/** Every string the document prints, for tests and wording checks. */
export function plainSummaryDocumentText(doc: DeltaForensicReportModel): string {
  const parts: string[] = [doc.title, doc.subtitle, doc.footerLine, ...doc.identity.map((row) => `${row.label} ${row.value}`)];
  for (const section of doc.sections) {
    parts.push(section.title);
    for (const block of section.blocks) {
      switch (block.kind) {
        case "paragraph":
        case "note":
        case "subheading":
          parts.push(block.text);
          break;
        case "bullets":
        case "steps":
          parts.push(...block.items);
          break;
        case "callout":
          parts.push(...block.paragraphs);
          break;
        case "table":
          parts.push(...block.columns.map((column) => column.header));
          for (const row of block.rows) parts.push(...row.cells);
          break;
      }
    }
  }
  return parts.join("\n");
}

/** Render the summary as a standalone PDF through the shared forensic renderer. */
export async function renderPlainSummaryPdf(model: PlainSummaryModel): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadCollisionIqLogo(doc);
  const pageCount = renderDeltaForensicReport(doc, buildPlainSummaryDocument(model), { font, boldFont, logo, startPageNumber: 1 });
  return { bytes: await doc.save(), pageCount };
}
