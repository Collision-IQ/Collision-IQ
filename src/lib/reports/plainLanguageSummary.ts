/**
 * APPRAISAL DISPUTE REPORT — model builder, document builder and ship gate.
 *
 * Third output of the Delta pipeline: a shop-staff-only, plain-English
 * companion to the Forensic Estimate Analysis and the Delta Citation Density
 * annotated estimate. It is drawn by the existing forensic PDF renderer, so it
 * shares the masthead, footer and pagination of the report it accompanies.
 *
 *   const model = buildPlainSummaryModel(input);      // closed ledger + evidence
 *   const doc   = buildPlainSummaryDocument(model);   // sections and blocks
 *   const pdf   = await renderPlainSummaryPdf(model); // lint gate, then render
 *
 * EVERY NUMBER COMES FROM ONE CLOSED LEDGER (appraisalSummary/gapLedger.ts):
 * labor hours at our rates, any open rate gap, paint materials, parts/sublet/
 * supplies net of the carrier's rate adjustment, and tax — summing to the
 * printed grand-total difference to the cent, or the model is not built.
 *
 * EVERY CLAIM SENTENCE IS EVIDENCE-GATED (appraisalSummary/summaryGuards.ts):
 * a part-type sentence only when a document shows a non-OEM part, a rate
 * argument only when the rates are not settled, an ADAS sentence only from
 * the carrier's own exclusion note or the group hours. The rendered text is
 * then linted unit by unit and the PDF is refused on any violation
 * (SummaryLintError), the same way the R24 release gate refuses a run.
 *
 * RO 21995 is why: the previous version of this report told staff the carrier
 * wrote "used, aftermarket or reconditioned" parts (both sheets are 100% OEM),
 * that the rate gap was worth $1,212.70 (a $3,728.00 concession already pays
 * our rates), and that "23 of our lines have no match" (most were the same
 * operations under other names).
 *
 * Audience: internal shop staff. Never surfaced in the customer-facing
 * Snapshot report or in anything carrier-facing.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { DeltaForensicReportModel, ForensicBlock, ForensicSection, ForensicTableRow } from "./deltaForensicReport";
import { loadCollisionIqLogo, renderDeltaForensicReport } from "./deltaForensicReportRenderer";
import { argueItems, type ArgueItem, type MatcherPair } from "./appraisalSummary/argueItems";
import { buildGapLedger, type GapLedger } from "./appraisalSummary/gapLedger";
import { integrityChecks, type Flag } from "./appraisalSummary/integrityChecks";
import { classifyNonLabor } from "./appraisalSummary/nonLaborBuckets";
import { groupEquivalents, type GroupDelta } from "./appraisalSummary/operationEquivalence";
import { partTypeEvidence, type PartTypeEvidence } from "./appraisalSummary/partTypeEvidence";
import { buildShortPayView, type ShortPayView } from "./appraisalSummary/shortPayView";
import { buildSummaryFacts, lintSummaryUnits, type LintContext, type SummaryFacts } from "./appraisalSummary/summaryGuards";
import type { Estimate } from "./appraisalSummary/types";

// ---------------------------------------------------------------------------
// Input and model
// ---------------------------------------------------------------------------

export interface PlainSummaryInput {
  preparedDate: string;        // "2026-09-25"
  vehicle: string;             // for the masthead and the owner note, already redacted
  roNumber?: string;
  /** Identity rows for the masthead, already redacted to the export policy. */
  identity?: Array<{ label: string; value: string }>;
  shop: Estimate;              // the annotated (higher) estimate
  carrier: Estimate;           // the comparison estimate
  /** The delta matcher's differences, by line number. */
  pairs: MatcherPair[];
  /** Line prices must reproduce the printed non-labor totals. Default on; off only for partial fixtures. */
  strictLines?: boolean;
}

export interface PlainSummaryModel {
  header: {
    vehicle: string;
    roNumber?: string;
    preparedDate: string;
    ours: string;
    theirs: string;
  };
  identity: Array<{ label: string; value: string }>;
  shop: Estimate;
  carrier: Estimate;
  ledger: GapLedger;
  partType: PartTypeEvidence;
  groups: GroupDelta[];
  flags: Flag[];
  facts: SummaryFacts;
  items: ArgueItem[];
  /** Short-paid vs carrier-only, gross; null when the lines do not reconcile to the gap. */
  shortPay: ShortPayView | null;
  /** The deductible a document states (the carrier's first); null when neither says. */
  deductible: number | null;
  lint: LintContext;
}

/** Builds the closed ledger and the evidence objects. Throws LedgerNotClosedError
 *  or NonLaborParseError when the numbers cannot be stated; the caller turns
 *  that into a run warning and ships no summary. */
export function buildPlainSummaryModel(input: PlainSummaryInput): PlainSummaryModel {
  const { shop, carrier } = input;
  const ledger = buildGapLedger(shop, carrier, { strictLines: input.strictLines ?? true });
  const partType = partTypeEvidence(shop, carrier);
  const { groups, usedShop } = groupEquivalents(shop, carrier);
  const flags = integrityChecks(shop, carrier, { pairs: input.pairs });
  const facts = buildSummaryFacts(ledger, partType, groups, flags);
  const items = argueItems({ shop, carrier, groups, usedShop, flags, pairs: input.pairs });
  const hasDealerCalibrationSublet = [...shop.lines, ...carrier.lines].some(
    (l) => classifyNonLabor(l) === "sublet" && /calibrat|adas/i.test(l.desc)
  );
  return {
    header: {
      vehicle: input.vehicle,
      roNumber: input.roNumber,
      preparedDate: input.preparedDate,
      ours: shop.fileName,
      theirs: carrier.fileName,
    },
    identity: input.identity ?? [],
    shop,
    carrier,
    ledger,
    partType,
    groups,
    flags,
    facts,
    items,
    shortPay: buildShortPayView({ shop, carrier, ledger, groups, pairs: input.pairs }),
    deductible: carrier.deductible ?? shop.deductible ?? null,
    lint: { ledger, partType, hasDealerCalibrationSublet },
  };
}

export const money = (n: number): string =>
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hr = (n: number) => `${n.toFixed(1)} hr`;
const rate = (n: number) => `$${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2)}/hr`;

// ---------------------------------------------------------------------------
// Document — sections and blocks for the shared forensic renderer
// ---------------------------------------------------------------------------

const REPORT_TITLE = "Appraisal Dispute Report";
const MAX_ITEMS = 12;

/** Footer line stamped on every page: title | RO | vehicle | audience. */
export function plainSummaryFooterLine(model: PlainSummaryModel): string {
  return [REPORT_TITLE, model.header.roNumber ? `RO ${model.header.roNumber}` : "", model.header.vehicle, "Shop staff only"]
    .filter(Boolean)
    .join(" | ");
}

export function buildPlainSummaryDocument(model: PlainSummaryModel): DeltaForensicReportModel {
  const { ledger: L, facts, shop, carrier } = model;
  const ro = model.header.roNumber ? ` | RO ${model.header.roNumber}` : "";
  const sections: ForensicSection[] = [];
  let number = 0;
  const section = (title: string, blocks: ForensicBlock[]) => {
    number += 1;
    sections.push({ number, title, blocks });
  };

  // 1. What it is / what it isn't.
  const carrierPaysMore = model.groups.filter((g) => g.carrierHours > g.shopHours);
  const isnt: string[] = [
    facts.notParts ? `Not a parts-type dispute. ${facts.notParts}` : "",
    facts.notRates ? `Not a labor-rate dispute. ${facts.notRates}` : "",
    carrierPaysMore.length
      ? `Not "they left it off". Some work they wrote under another name, and on ${carrierPaysMore
          .map((g) => `${g.label.toLowerCase()} (${hr(g.carrierHours)} theirs vs ${hr(g.shopHours)} ours)`)
          .join("; ")} they pay more than we wrote.`
      : "",
  ].filter(Boolean);
  section("What this is, and what it isn't", [
    {
      kind: "table",
      columns: [{ header: "Orientation", weight: 22 }, { header: "Detail", weight: 78 }],
      rows: [
        { cells: ["Our estimate", `${model.header.ours}: ${money(L.shopTotal)}`] },
        { cells: ["Their estimate", `${model.header.theirs}: ${money(L.carrierTotal)}`] },
        { cells: ["The gap", money(L.gap)], variant: "total" },
        ...(model.deductible !== null
          ? [{ cells: ["Deductible (owner)", `${money(model.deductible)}, as the estimate states it. It applies whichever estimate is paid.`] }]
          : []),
        { cells: ["Audience", "Internal. For the front desk, estimators and anyone who has to explain this to the owner. Not for the carrier, not for the customer's file as-is."] },
      ],
    },
    {
      kind: "callout",
      tone: "owner",
      paragraphs: [
        [facts.headline + ".", facts.mostlyHours ?? "", "Nothing in the two estimates says anyone acted in bad faith; this is two appraisers disagreeing, and most of it gets settled at the car."]
          .filter(Boolean)
          .join(" "),
      ],
    },
    ...(isnt.length ? [{ kind: "bullets" as const, items: isnt }] : []),
  ]);

  // 2. Where the money comes from — the closed ledger.
  section("Where the money comes from", [
    {
      kind: "paragraph",
      text: "Every figure below comes from the two estimates' printed totals and lines. The rows add up to the printed difference to the cent; if they did not, this report would not have been produced.",
    },
    {
      kind: "table",
      columns: [
        { header: "Bucket", weight: 22 },
        { header: "Amount", weight: 14, align: "right" },
        { header: "How it is computed", weight: 64 },
      ],
      rows: ledgerRows(model),
    },
  ]);

  // 2b. The gross view behind the net.
  if (model.shortPay && model.shortPay.carrierOver > 0) {
    const v = model.shortPay;
    const top = v.over.slice(0, 6);
    const rest = v.over.slice(6);
    const blocks: ForensicBlock[] = [
      {
        kind: "paragraph",
        text: `The ${money(v.gap)} gap is a net. At our rates, the carrier short-pays ${money(v.shortPaid)} of our lines, and its sheet carries ${money(v.carrierOver)} of lines ours does not have or pays more on them. ${money(v.shortPaid)} short-paid, less ${money(v.carrierOver)} carrier-only, plus ${money(v.tax)} tax, is ${money(v.gap)}.`,
      },
      {
        kind: "table",
        columns: [
          { header: "Theirs is higher", weight: 46 },
          { header: "Their line", weight: 18 },
          { header: "Our line", weight: 18 },
          { header: "Amount", weight: 18, align: "right" },
        ],
        rows: [
          ...top.map((u) => ({
            cells: [
              u.label,
              u.carrierLines.length ? u.carrierLines.map((n) => `L${n}`).join(", ") : "none",
              u.shopLines.length ? u.shopLines.map((n) => `L${n}`).join(", ") : "none",
              money(-u.diff),
            ],
          })),
          ...(rest.length
            ? [{ cells: [`${rest.length} smaller lines`, "", "", money(-rest.reduce((sum, u) => sum + u.diff, 0))] }]
            : []),
          { cells: ["Total", "", "", money(v.carrierOver)], variant: "total" as const },
        ],
      },
      {
        kind: "note",
        text: "Lines are matched as the same work written under another name, then by the delta matcher, part number, and shared description; a line with no match counts on one side only. The net is fixed by the printed totals; how it splits between the two sides depends on that matching.",
      },
    ];
    section("Short-paid vs. what only they wrote", blocks);
  }

  // 3. Check this first.
  section("Check this first", [
    facts.checkFirst.length
      ? { kind: "bullets", items: facts.checkFirst.map((f) => f.text) }
      : { kind: "paragraph", text: "Nothing on either sheet needs resolving before the items below." },
  ]);

  // 4. Items worth arguing.
  const shown = model.items.slice(0, MAX_ITEMS);
  const rest = model.items.slice(MAX_ITEMS);
  const itemBlocks: ForensicBlock[] = [
    {
      kind: "paragraph",
      text: `Largest first within each strength, valued at our rates. STRONG: their own document supports us. NEEDS PROOF: attach the P-page, invoice or OEM procedure first.${
        model.items.some((i) => i.strength === "Weak") ? " WEAK: a retrieved P-page shows it is included in an operation they already pay." : ""
      }`,
    },
  ];
  if (shown.length) {
    itemBlocks.push({
      kind: "table",
      columns: [
        { header: "Strength", weight: 13 },
        { header: "Item", weight: 25 },
        { header: "What the sheets show", weight: 44 },
        { header: "Worth", weight: 18, align: "right" },
      ],
      rows: shown.map((item) => ({
        cells: [item.strength.toUpperCase(), item.title, item.detail, money(item.value)],
      })),
    });
  } else {
    itemBlocks.push({ kind: "paragraph", text: "No hours or parts difference is left once equivalent operations are grouped." });
  }
  if (rest.length) {
    itemBlocks.push({
      kind: "note",
      text: `${rest.length} smaller ${rest.length === 1 ? "item" : "items"} worth ${money(rest.reduce((sum, i) => sum + i.value, 0))} in total are not listed; the Forensic Estimate Analysis lists every line.`,
    });
  }
  section("Items worth arguing", itemBlocks);

  // 5. Clean up our own sheet (and what to ask the carrier to fix on theirs).
  const cleanUp: ForensicBlock[] = [];
  const cleanUpItems = mergeCategoryFlags(facts.cleanUpOurs);
  cleanUp.push(
    cleanUpItems.length
      ? { kind: "bullets", items: cleanUpItems }
      : { kind: "paragraph", text: "Nothing on our sheet to fix before it goes back." }
  );
  if (facts.askCarrier.length) {
    cleanUp.push({ kind: "subheading", text: "Ask the carrier to correct on theirs" });
    cleanUp.push({ kind: "bullets", items: facts.askCarrier.map((f) => f.text) });
  }
  section("Clean up our own sheet", cleanUp);

  // 6. Owner note.
  section("A note for the owner (copy and paste)", [
    {
      kind: "note",
      text: "Written for the vehicle owner, in the shop's voice. It uses only the figures on the two estimates and stays inside the say / don't-say rules below: no promise about what the carrier will pay, no date, no comment on anyone's intent.",
    },
    { kind: "callout", tone: "owner", paragraphs: [buildOwnerNote(model)] },
  ]);

  // 7. Say / don't say.
  const sayRows: ForensicTableRow[] = [
    { cells: ["\"Two appraisers disagree about how many hours the repair takes. That is normal, and most of it gets settled at the car.\"", "Anything about intent: no \"lowballing\", no \"bad faith\". Nothing in the estimates supports it."] },
    { cells: ["\"You choose the repair shop. Nobody can require you to use a particular one.\"", "\"The carrier has to pay whatever we write.\" They do not, and this is not a number we can promise."] },
    { cells: ["\"A supplement is a step in the process, not the final answer.\"", "\"This will be fixed in a week.\" Supplements and reinspections take time; do not set a date."] },
    { cells: ["\"Your policy has a section on what happens when the two sides cannot agree on the amount. Read it, or ask your agent.\"", "Explaining the appraisal clause, quoting it, or telling the owner to invoke it. That is legal territory and not the shop's role."] },
  ];
  if (facts.notParts) {
    sayRows.push({ cells: ["\"Both estimates use new factory parts.\"", "Any claim about part type. The carrier's parts-usage page lists nothing but new factory parts."] });
  }
  if (facts.notRates) {
    sayRows.push({ cells: ["\"The rates are agreed. The difference is labor time.\"", "Arguing our hourly rate. The carrier's rate adjustment already pays it."] });
  }
  sayRows.push({ cells: ["\"Keep every document: both estimates, every supplement, scan reports, parts invoices.\"", "Handing the owner the highlighted Citation Density copy. It is a working document, not a customer document."] });
  section("Things to say, things not to say", [
    { kind: "table", columns: [{ header: "Say this", weight: 50 }, { header: "Not this", weight: 50 }], rows: sayRows },
  ]);

  // 8. Next steps.
  section("What happens next", [
    {
      kind: "steps",
      items: [
        facts.checkFirst.length
          ? "Resolve the \"Check this first\" items with the carrier before anything else; a high-dollar line nobody can explain undermines every other argument."
          : "Confirm both sheets are the latest versions before anything else.",
        "Clean up our own sheet and send the corrected version, so the carrier is answering our final numbers.",
        "Send the STRONG items first, each with the carrier's own line or note quoted. Then the NEEDS PROOF items, each with its P-page, OEM procedure or invoice attached.",
        "Ask for a reinspection with both appraisers present and the damaged assemblies off for anything still open.",
      ],
    },
  ]);

  // 9. Where the detail lives.
  section("Where the detail lives", [
    {
      kind: "table",
      columns: [{ header: "Report", weight: 24 }, { header: "What it holds", weight: 76 }],
      rows: [
        { cells: ["Forensic Estimate Analysis", "Every line-level difference the matcher found, including the ones this report groups as the same work written under another name. Line numbers refer to our estimate."] },
        { cells: ["Delta Citation Density", "Our estimate with the differences painted on: yellow highlight where a line differs, the carrier's figure in the red footnotes, the legend on the last page."] },
        { cells: ["The two estimates", `${shop.fileName} (${shop.lines.length} lines read) and ${carrier.fileName} (${carrier.lines.length} lines read). Every L-number above is a line on one of these.`] },
      ],
    },
    {
      kind: "note",
      text: `Source figures: ${shop.fileName} and ${carrier.fileName}${ro}, prepared ${model.header.preparedDate}. The vehicle was not physically inspected for this report; hidden damage may change both estimates. This summary is not legal advice.`,
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
 * Our under-coded lines read as one item with what they are worth at our
 * rates ("coded body where the carrier codes mechanical: 3.3 hr, $280.50"),
 * not as one bullet per line. Every other flag prints as written.
 */
function mergeCategoryFlags(flags: Flag[]): string[] {
  const out: string[] = [];
  const merged = new Map<string, Flag[]>();
  for (const flag of flags) {
    if (flag.kind !== "laborCategoryMismatch") {
      out.push(flag.text);
      continue;
    }
    const cats = flag.text.match(/ours is coded (\w+), theirs (\w+)/);
    const key = cats ? `${cats[1]}→${cats[2]}` : flag.text;
    merged.set(key, [...(merged.get(key) ?? []), flag]);
  }
  for (const [key, group] of merged) {
    const [ours, theirs] = key.split("→");
    if (group.length === 1 || !theirs) {
      out.push(...group.map((f) => f.text));
      continue;
    }
    const names = group.map((f) => `${f.text.replace(/: ours is coded.*$/, "")} L${f.lines.shop?.[0]}`);
    const dollars = group.reduce((sum, f) => sum + (f.dollars ?? 0), 0);
    out.push(
      `Coded ${ours} on our sheet where the carrier codes ${theirs}: ${names.join(", ")}.${
        dollars > 0 ? ` Recoding is worth ${money(dollars)} at our rates.` : ""
      }`
    );
  }
  return out;
}

function ledgerRows(model: PlainSummaryModel): ForensicTableRow[] {
  const { ledger: L, shop, carrier, items, facts } = model;
  const rows: ForensicTableRow[] = [];
  const adj = L.rate.adjustmentAmount;
  rows.push({
    cells: [
      "Labor hours",
      money(L.laborHours.dollars),
      `Both sides' hours valued at our category rates${
        L.rate.settledByAdjustment
          ? ` (valid because the carrier's ${money(adj)} rate adjustment equals the ${money(L.rate.impliedAdjustment)} rate difference)`
          : ""
      }. ${hr(L.laborHours.shop)} ours vs ${hr(L.laborHours.carrier)} theirs.`,
    ],
  });
  if (L.laborRate !== 0) {
    const labor = L.rate.openRateItems.filter((i) => i.label !== "Paint materials");
    rows.push({
      cells: [
        "Labor rate",
        money(L.laborRate),
        `(our rate − their rate) × their hours${
          labor.length ? `: ${labor.map((i) => `${i.label} ${hr(i.hours)} × ${rate(i.shopRate - i.carrierRate)}`).join("; ")}` : ""
        }${adj > 0 ? `, less the carrier's ${money(adj)} rate adjustment` : ""}.`,
      ],
    });
  } else if (adj > 0) {
    rows.push({ cells: ["Labor rate", money(0), `Settled by the carrier's ${money(adj)} rate adjustment.`] });
  }
  const ps = shop.totals.paintSupplies;
  const pc = carrier.totals.paintSupplies;
  const materialsRate = L.rate.openRateItems.find((i) => i.label === "Paint materials");
  const materialsHours = Math.round((ps.hours - pc.hours) * 10) / 10;
  const materialsSplit =
    materialsRate && Math.abs(materialsRate.dollars + materialsHours * ps.rate - L.paintMaterials) <= 0.01
      ? `, which is the ${rate(materialsRate.shopRate - materialsRate.carrierRate)} rate (${money(materialsRate.dollars)}) plus ${hr(materialsHours)} × ${rate(ps.rate)} (${money(materialsHours * ps.rate)})`
      : "";
  rows.push({ cells: ["Paint materials", money(L.paintMaterials), `${money(ps.cost)} − ${money(pc.cost)}${materialsSplit}.`] });
  const largest = [
    ...items.filter((i) => i.hours === 0 && i.strength === "Strong").map((i) => `${i.title.toLowerCase()} ${money(i.value)} on ours`),
    ...facts.checkFirst
      .filter((f) => f.kind === "carrierOnlyHighDollar" && f.dollars)
      .map((f) => `the ${money(f.dollars!)} line only they wrote (see Check this first)`),
  ];
  rows.push({
    cells: [
      "Parts, sublet, supplies (net)",
      money(L.nonLaborNet),
      `${shop.totals.misc ? `(${money(shop.totals.parts)} + ${money(shop.totals.misc)})` : money(shop.totals.parts)} − (${money(carrier.totals.parts + carrier.totals.misc)}${
        adj > 0 ? ` − ${money(adj)} rate adjustment` : ""
      }). Sublet and supplies are compared line by line, wherever each sheet prints them.${
        largest.length ? ` Includes ${largest.join(" and ")}.` : ""
      }`,
    ],
  });
  rows.push({ cells: ["Tax", money(L.tax), `${money(shop.totals.tax)} − ${money(carrier.totals.tax)}.`] });
  rows.push({ cells: ["Total", money(L.gap), `${money(L.shopTotal)} − ${money(L.carrierTotal)}.`], variant: "total" });
  return rows;
}

/**
 * The owner paragraph. Customer wording: no line numbers, no internal report
 * names. Figures come from the ledger; the ADAS sentence appears only when the
 * evidence-gated staff sentence exists. Never states intent, a date, or what
 * the carrier will pay.
 */
export function buildOwnerNote(model: PlainSummaryModel): string {
  const { ledger: L, facts } = model;
  const share = L.gap > 0 ? Math.round((L.laborHours.dollars / L.gap) * 100) : 0;
  const drivers: string[] = [];
  if (L.laborHours.diff > 0 && share > 0) {
    drivers.push(
      `Most of that difference (${share}%) is labor time: we wrote ${L.laborHours.diff.toFixed(1)} more hours of repair work than their appraiser did.`
    );
  }
  if (facts.notParts && facts.notRates) {
    drivers.push("Both estimates use new factory parts, and the two agree on labor rates.");
  } else if (facts.notParts) {
    drivers.push("Both estimates use new factory parts.");
  } else if (facts.notRates) {
    drivers.push("The two estimates agree on labor rates.");
  }
  if (facts.adasSentence) {
    drivers.push(
      "Your vehicle's driver-assistance cameras and sensors must be calibrated after the repair. That work is on our estimate, and we will make sure it is completed and documented for you."
    );
  }
  return [
    `Thank you for trusting us with your ${model.header.vehicle}. Two repair plans have been written for it. Ours comes to ${money(L.shopTotal)}, and the insurance company's appraiser has written ${money(L.carrierTotal)}, a difference of ${money(L.gap)}.${
      model.deductible !== null ? ` Your ${money(model.deductible)} deductible is the same under either one.` : ""
    }`,
    ...drivers,
    "A gap like this is common at this stage and does not mean anyone has acted in bad faith; two appraisers looked at the same vehicle and reached different conclusions.",
    "The next step is a supplement and, where needed, a joint reinspection with the damaged parts removed, which is where most of these differences get settled. We will keep you updated as that happens, and we will keep every estimate, supplement and invoice on file for you. Please call us with any questions.",
  ].join(" ");
}

/** Every rendered unit of text (a paragraph, a bullet, a table cell), in order. */
export function plainSummaryDocumentUnits(doc: DeltaForensicReportModel): string[] {
  const units: string[] = [doc.title, doc.subtitle, doc.footerLine, ...doc.identity.map((row) => `${row.label} ${row.value}`)];
  for (const section of doc.sections) {
    units.push(section.title);
    for (const block of section.blocks) {
      switch (block.kind) {
        case "paragraph":
        case "note":
        case "subheading":
          units.push(block.text);
          break;
        case "bullets":
        case "steps":
          units.push(...block.items);
          break;
        case "callout":
          units.push(...block.paragraphs);
          break;
        case "table":
          units.push(...block.columns.map((column) => column.header));
          for (const row of block.rows) units.push(...row.cells);
          break;
      }
    }
  }
  return units;
}

/** Every string the document prints, for tests and wording checks. */
export function plainSummaryDocumentText(doc: DeltaForensicReportModel): string {
  return plainSummaryDocumentUnits(doc).join("\n");
}

/** The ship gate refused the rendered text. `violations` is shown on the run. */
export class SummaryLintError extends Error {
  constructor(readonly violations: string[]) {
    super(`the rendered summary failed ${violations.length} wording check(s)`);
  }
}

/** Lint the rendered text, then render through the shared forensic renderer. */
export async function renderPlainSummaryPdf(model: PlainSummaryModel): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const document = buildPlainSummaryDocument(model);
  const violations = lintSummaryUnits(plainSummaryDocumentUnits(document), model.lint);
  if (violations.length) throw new SummaryLintError(violations);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadCollisionIqLogo(doc);
  const pageCount = renderDeltaForensicReport(doc, document, { font, boldFont, logo, startPageNumber: 1 });
  return { bytes: await doc.save(), pageCount };
}
