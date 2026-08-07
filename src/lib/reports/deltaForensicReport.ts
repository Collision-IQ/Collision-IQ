/**
 * The Delta report as a forensic document, not a field dump.
 *
 * The Findings Report used to open with a bare cover page and then print one
 * card per finding, every card a list of "Anchor id / Delta class / Initial file
 * hash" rows. Everything a machine needed was on the page and nothing a reader
 * needed was: no statement of what the two documents are, no reconciliation of
 * the money, no grouping of eight calibration omissions into one finding, and
 * no separation of "here is what we observed" from "here is what you should do
 * about it".
 *
 * This module builds the reader-facing structure — purpose, documents examined,
 * plain-language summary, reconciliation, findings grouped by subject matter,
 * authorities, limitations, appendices — from the SAME finding objects the
 * annotator already produced. It adds no facts. Every dollar figure it prints
 * comes from a finding's own evidence or from an estimate total that was
 * extracted; every authority it names came back from retrieval. Where a number
 * or an authority is absent, the report says so rather than filling the gap.
 *
 * Three rules the shape encodes:
 *
 * PAIR-AGNOSTIC. Nothing here knows about carriers, insurers, or a particular
 * RO. Document labels come from the resolved estimate roles, so a shop-to-shop
 * comparison never renders the word "carrier" (see canonicalDelta's
 * SHOP_TO_SHOP_BANNED_PATTERNS and the release gate's R09).
 *
 * NOTHING IS SUPPRESSED SILENTLY. Every list that is capped says what it capped
 * and how many remain (R18), and differences that carry no quantified dollar
 * value are counted in the open rather than dropped out of the totals.
 *
 * NO INVENTED AUTHORITY. Section "Authorities relied upon" is assembled from
 * findings that carry a retrieved authority. A finding whose authority was not
 * retrieved contributes a "verification required" row, never a title (R15).
 */
import type {
  CitationDensityFinding,
  CitationDensityDocumentEstimateRole,
} from "@/lib/ai/types/estimateScrubber";
import type { CanonicalDeltaSet } from "./canonicalDelta";
import { counterpartLabel } from "./deltaWording";
import { redactDownloadContent } from "@/lib/privacy/redactDownloadContent";

// ---------------------------------------------------------------------------
// Document model — rendering-agnostic, so the layout can change without the
// adjudication changing with it.
// ---------------------------------------------------------------------------

export type ForensicKeyValue = { label: string; value: string };

export type ForensicTableColumn = {
  header: string;
  /** Relative width weight; the renderer normalises these to the text column. */
  weight: number;
  align?: "left" | "right" | "center";
  mono?: boolean;
};

export type ForensicTableRow = {
  cells: string[];
  /** group = shaded band introducing a set of rows; total = ruled emphasis row. */
  variant?: "body" | "group" | "total";
  /** A figure that runs the other way (credited to the comparison document). */
  credit?: boolean;
};

export type ForensicBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "note"; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "steps"; items: string[] }
  | { kind: "table"; columns: ForensicTableColumn[]; rows: ForensicTableRow[] }
  | { kind: "callout"; tone: "owner" | "caution" | "neutral"; paragraphs: string[] };

export type ForensicSection = {
  /** Printed section number. Appendices carry their label in `title` instead. */
  number?: number;
  title: string;
  blocks: ForensicBlock[];
};

export type DeltaForensicReportModel = {
  title: string;
  subtitle: string;
  generatedLabel: string;
  identity: ForensicKeyValue[];
  sections: ForensicSection[];
  /** Repeated in the page footer band. */
  footerLine: string;
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type ForensicFindingRecord = {
  finding: CitationDensityFinding;
  /** Badge number on the annotated estimate. Absent for unanchored findings. */
  markerNumber?: number;
  sourcePageNumber?: number;
  sourceLineNumber?: string | null;
};

export type ForensicClaimContext = {
  vehicle?: string | null;
  vin?: string | null;
  claimNumber?: string | null;
  roNumber?: string | null;
  ownerName?: string | null;
  insurer?: string | null;
  jurisdiction?: string | null;
  repairFacility?: string | null;
  lossDate?: string | null;
  mileage?: string | null;
};

export type ForensicEstimateDocument = {
  fileName: string;
  estimateRole?: CitationDensityDocumentEstimateRole | null;
  total?: number | null;
  lineCount?: number | null;
};

export type DeltaForensicReportInput = {
  reportTitle: string;
  reportShortTitle: string;
  subject: ForensicEstimateDocument;
  comparisons?: ForensicEstimateDocument[];
  anchored: ForensicFindingRecord[];
  unanchored: ForensicFindingRecord[];
  canonicalDeltaSet?: CanonicalDeltaSet;
  claimContext?: ForensicClaimContext;
  warnings?: string[];
  /** Per-document text-layer reliability notes (broken font encoding, OCR). */
  textLayerNotes?: string[];
  generatedAt?: string;
  /** Applies the download redaction policy to identity and prose. Default true. */
  redactSensitive?: boolean;
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const NOT_QUANTIFIED = "not quantified";

function money(value: number): string {
  return `$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Signed money, with the sign as a word-safe glyph the extractor can read. */
function signedMoney(value: number): string {
  return value < 0 ? `-${money(value)}` : money(value);
}

function hours(value: number): string {
  return `${value.toFixed(1)} hrs`;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

function sentenceList(items: string[], conjunction = "and"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

function clean(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The operation itself, with a detector's classification prefix dropped. Only
 * the trailing segment is taken, and only when what remains still reads as an
 * operation — a label with no prefix, or one whose tail is too short to stand
 * on its own, is returned whole rather than truncated into nonsense.
 */
function shortOperationName(label: string | null | undefined): string {
  const text = clean(label);
  const separator = text.lastIndexOf(": ");
  if (separator < 0) return text;
  const tail = text.slice(separator + 2).trim();
  return tail.length >= 6 ? tail : text;
}

// ---------------------------------------------------------------------------
// Document role vocabulary — the only place a document gets a name
// ---------------------------------------------------------------------------

export function describeEstimateRole(
  role: CitationDensityDocumentEstimateRole | null | undefined,
  fallback: string
): string {
  switch (role) {
    case "carrier_estimate":
      return "the carrier estimate";
    case "shop_initial":
      return "the initial shop estimate";
    case "shop_supplement":
      return "the shop supplement";
    case "shop_final":
      return "the shop supplement/final estimate";
    case "independent_appraiser":
      return "the independent appraiser estimate";
    default:
      return fallback;
  }
}

// ---------------------------------------------------------------------------
// Themes — how eight separate calibration omissions become one finding group
// ---------------------------------------------------------------------------

type ThemeKey =
  | "structural"
  | "adas"
  | "parts"
  | "refinish"
  | "labor"
  | "operations"
  | "policy"
  | "other";

const THEME_TITLES: Record<ThemeKey, string> = {
  structural: "Structural repair and repair method",
  adas: "Advanced driver assistance systems, scanning and calibration",
  parts: "Parts type, hardware and one-time-use components",
  refinish: "Refinish and materials",
  labor: "Labor hours and rates",
  operations: "Operations written on one document only",
  policy: "Policy, coverage and regulatory items",
  other: "Other documented differences",
};

const THEME_ORDER: ThemeKey[] = [
  "structural",
  "adas",
  "parts",
  "refinish",
  "labor",
  "operations",
  "policy",
  "other",
];

function themeOf(finding: CitationDensityFinding): ThemeKey {
  switch (finding.category) {
    case "structural_or_fit_verification":
      return "structural";
    case "adas_calibration":
    case "scan_diagnostic":
      return "adas";
    case "parts_downgrade":
    case "one_time_use_parts":
    case "hardware_fasteners":
      return "parts";
    case "refinish":
      return "refinish";
    case "labor_difference":
    case "r_and_i":
      return "labor";
    case "not_included_operation":
      return "operations";
    case "policy_coverage":
    case "state_regulation":
      return "policy";
    default:
      return "other";
  }
}

// ---------------------------------------------------------------------------
// Finding accessors — the model reads evidence, it never invents it
// ---------------------------------------------------------------------------

/** Dollars this finding puts in dispute. Absent when nothing was extracted. */
export function findingDollarImpact(finding: CitationDensityFinding): number | null {
  if (isNumber(finding.impact?.dollarImpact)) return Math.abs(finding.impact.dollarImpact);
  const here = finding.shopEvidence?.amount;
  const there = finding.carrierEvidence?.amount;
  if (isNumber(here) && isNumber(there)) return Math.abs(here - there);
  if (isNumber(here)) return Math.abs(here);
  if (isNumber(there)) return Math.abs(there);
  return null;
}

function findingHoursImpact(finding: CitationDensityFinding): number | null {
  if (isNumber(finding.impact?.laborHoursImpact)) return Math.abs(finding.impact.laborHoursImpact);
  const here = finding.shopEvidence?.laborHours;
  const there = finding.carrierEvidence?.laborHours;
  if (isNumber(here) && isNumber(there)) return Math.abs(here - there);
  return null;
}

/** True when the operation exists on one document and has no counterpart. */
function isPresenceDifference(finding: CitationDensityFinding): boolean {
  if (finding.deltaClass === "PRESENT_ONLY_IN_SOURCE") return true;
  if (finding.deltaClass === "PRESENT_ONLY_IN_COMPARISON") return true;
  if (finding.deltaClass) return false;
  return finding.estimateGapType === "missing_from_carrier";
}

/** True when both documents carry the line and the values differ. */
function isValueDifference(finding: CitationDensityFinding): boolean {
  if (
    finding.deltaClass === "VALUE_CHANGED" ||
    finding.deltaClass === "PART_SWAPPED" ||
    finding.deltaClass === "LABOR_CHANGED"
  ) {
    return true;
  }
  if (finding.deltaClass) return false;
  return finding.estimateGapType === "reduced_by_carrier";
}

function isSafetyRelevant(finding: CitationDensityFinding): boolean {
  return (
    finding.impact?.safetyImpact === "high" ||
    finding.category === "adas_calibration" ||
    finding.category === "scan_diagnostic" ||
    finding.category === "structural_or_fit_verification"
  );
}

/** Provenance the detail card records and a reader has no use for. */
const PROVENANCE_LIMITATION =
  /^(?:source(?:Pdf)?Hash|artifactVersion|initial(?:File)?Hash|supplement(?:File)?Hash|anchorId|canonicalDelta\w*|findingId|buildCommit)\s*[:=]/i;

/**
 * The limitations a reader needs, with the pipeline's own bookkeeping removed.
 *
 * Detectors append provenance to `limitations` so it travels with the finding
 * — "sourcePdfHash:75ec…; artifactVersion:citation-density-part-source-…". That
 * belongs on the detail record, which still prints it. Rendered mid-narrative
 * it reads as a caveat about the repair, which it is not.
 */
export function readerFacingLimitations(limitations: string[] | undefined): string {
  return (limitations ?? [])
    .flatMap((limitation) => String(limitation ?? "").split(";"))
    .map((segment) => clean(segment))
    .filter((segment) => segment.length > 0 && !PROVENANCE_LIMITATION.test(segment))
    .join("; ");
}

/**
 * A retrieved authority, or null. "verified" is the only status that means the
 * document came back; "referenced_not_produced" means the estimate mentions it
 * and nobody has produced it, which is precisely the case R15 exists to stop
 * being rendered as a citation. An unretrieved authority is never named.
 */
function retrievedAuthority(finding: CitationDensityFinding): { title: string; locator?: string } | null {
  const locator =
    clean(finding.matchedDocumentUrl ?? "") || clean(finding.sourcePageLine ?? "") || undefined;
  const best = finding.bestAvailableAuthority;
  if (best?.title && best.status === "verified") {
    return { title: clean(best.title), locator };
  }
  if (
    finding.matchedDocumentTitle &&
    (finding.retrievalStatus === "matched" || finding.retrievalStatus === "retrieved")
  ) {
    return { title: clean(finding.matchedDocumentTitle), locator };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Model builder
// ---------------------------------------------------------------------------

export function buildDeltaForensicReportModel(
  input: DeltaForensicReportInput
): DeltaForensicReportModel {
  const redact = input.redactSensitive !== false;
  const scrub = (value: string) => (redact ? redactDownloadContent(value) : value);

  const records = [...input.anchored, ...input.unanchored];

  const subjectLabel = describeEstimateRole(
    input.subject.estimateRole ?? input.canonicalDeltaSet?.estimateFiles.supplement.estimateRole,
    "the annotated estimate"
  );
  const primaryComparison = input.comparisons?.[0];
  const comparisonLabel = counterpartLabel(
    primaryComparison || input.canonicalDeltaSet
      ? describeEstimateRole(
          primaryComparison?.estimateRole ?? input.canonicalDeltaSet?.estimateFiles.initial.estimateRole,
          "the comparison estimate"
        )
      : null
  );

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const generatedLabel = `Prepared ${formatPreparedDate(generatedAt)}`;

  const sections: ForensicSection[] = [];
  let sectionNumber = 0;
  const addSection = (title: string, blocks: ForensicBlock[]) => {
    if (blocks.length === 0) return;
    sectionNumber += 1;
    sections.push({ number: sectionNumber, title, blocks });
  };

  addSection("Purpose and scope", buildPurposeSection(subjectLabel, comparisonLabel, input));
  addSection("Documents examined", buildDocumentsSection(input, scrub));
  addSection(
    "Summary in plain language",
    buildPlainSummarySection(records, subjectLabel, comparisonLabel, input, scrub)
  );

  const reconciliation = buildReconciliationSection(records, input);
  if (reconciliation.length) addSection("Reconciliation of the difference", reconciliation);

  for (const theme of THEME_ORDER) {
    const themed = records.filter((record) => themeOf(record.finding) === theme);
    if (!themed.length) continue;
    addSection(
      `Findings — ${THEME_TITLES[theme].toLowerCase()}`,
      buildThemeSection(themed, subjectLabel, comparisonLabel, scrub)
    );
  }

  addSection(
    "What the vehicle owner should know",
    buildOwnerSection(records, comparisonLabel)
  );
  addSection("Recommended path to resolution", buildResolutionSection(records, comparisonLabel));
  addSection("Authorities relied upon", buildAuthoritiesSection(records, input));
  addSection("Limitations", buildLimitationsSection(records, input, comparisonLabel, scrub));

  const appendixA = buildPresenceAppendix(records, comparisonLabel, scrub);
  if (appendixA.length) {
    sections.push({
      title: `Appendix A — Operations with no counterpart on ${stripLeadingThe(comparisonLabel)}`,
      blocks: appendixA,
    });
  }
  const appendixB = buildValueAppendix(records, subjectLabel, comparisonLabel, scrub);
  if (appendixB.length) {
    sections.push({
      title: "Appendix B — Lines present on both documents at different values",
      blocks: appendixB,
    });
  }
  const appendixC = buildDocumentationAppendix(records, scrub);
  if (appendixC.length) {
    sections.push({
      title: "Appendix C — Differences carried for documentation, with no dollar value extracted",
      blocks: appendixC,
    });
  }

  sections.push({
    title: "Preparation statement",
    blocks: [
      {
        kind: "callout",
        tone: "caution",
        paragraphs: [
          `This report was prepared from the documents identified in Section 2 and from the authorities listed above. Every dollar figure in it appears on one of those documents; none is inferred. It is offered as an appraisal and documentation analysis to assist the parties in resolving a difference in the amount of loss. It is not legal advice, not a coverage determination, and not an allegation of misconduct by any party.`,
          `Where an authority is shown as requiring verification, it has not been retrieved and must be obtained before the finding it supports is relied upon in a formal proceeding.`,
        ],
      },
    ],
  });

  return {
    title: input.reportTitle,
    subtitle: `Line-level reconciliation of ${subjectLabel} against ${comparisonLabel}`,
    generatedLabel,
    identity: buildIdentityRows(input, scrub),
    sections,
    footerLine: clean(
      `${input.reportShortTitle} | ${scrub(input.subject.fileName)} | ${generatedLabel}`
    ),
  };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function buildIdentityRows(
  input: DeltaForensicReportInput,
  scrub: (value: string) => string
): ForensicKeyValue[] {
  const context = input.claimContext ?? {};
  const files = input.canonicalDeltaSet?.estimateFiles;
  const candidates: Array<[string, string | null | undefined]> = [
    ["Owner / insured", context.ownerName ?? files?.insuredName ?? files?.ownerName],
    ["Vehicle", context.vehicle],
    ["VIN", context.vin],
    ["Claim number", context.claimNumber],
    ["RO number", context.roNumber],
    ["Insurer", context.insurer ?? files?.supplement.insurer ?? files?.initial.insurer],
    ["Date of loss", context.lossDate],
    ["Odometer", context.mileage],
    ["Repair facility", context.repairFacility],
    ["Jurisdiction", context.jurisdiction],
  ];
  // The download redaction policy is label-aware: a bare "26-232003028-01" is
  // not recognisable as a claim number, but "Claim number: 26-232003028-01" is.
  // The label is therefore scrubbed together with its value and stripped back
  // off, so the header block is redacted to the same policy as report prose.
  const scrubValue = (label: string, value: string) => {
    const prefix = `${label}: `;
    const scrubbed = scrub(`${prefix}${value}`);
    return scrubbed.startsWith(prefix) ? scrubbed.slice(prefix.length) : scrubbed;
  };

  return candidates
    .filter(([, value]) => clean(value).length > 0)
    .map(([label, value]) => ({ label, value: scrubValue(label, clean(value)) }));
}

function buildPurposeSection(
  subjectLabel: string,
  comparisonLabel: string,
  input: DeltaForensicReportInput
): ForensicBlock[] {
  const hasComparison = (input.comparisons?.length ?? 0) > 0 || Boolean(input.canonicalDeltaSet);
  if (!hasComparison) {
    return [
      {
        kind: "paragraph",
        text: `Only one estimate was parsed for this report. It therefore documents what ${subjectLabel} does and does not evidence on its own, and it makes no comparison. Nothing below should be read as a difference between two appraisals.`,
      },
    ];
  }
  return [
    {
      kind: "paragraph",
      text: `Two appraisals of the same loss exist and they do not agree. This report compares them line by line, identifies each point of difference, quantifies it in dollars where the documents state a value, and gives the technical or regulatory basis for the difference where one is available. ${capitalize(subjectLabel)} is the annotated document; ${comparisonLabel} is the document it is measured against.`,
    },
    {
      kind: "paragraph",
      text: "It is written to be read both by a claims professional and by the vehicle owner. The plain-language summary states the outcome; the numbered findings carry the technical detail; the appendices list every affected line so that nothing summarised above is taken on trust.",
    },
    {
      kind: "paragraph",
      text: "This is a documentation and appraisal analysis. It is not legal advice, and it does not allege intent or bad faith on the part of any party. Several findings are ordinary appraisal disagreements that reasonable professionals resolve routinely.",
    },
  ];
}

function buildDocumentsSection(
  input: DeltaForensicReportInput,
  scrub: (value: string) => string
): ForensicBlock[] {
  const documents: ForensicEstimateDocument[] = [input.subject, ...(input.comparisons ?? [])];
  if (documents.length === 0) return [];

  const columns: ForensicTableColumn[] = [
    { header: "Role in this comparison", weight: 26 },
    { header: "Document", weight: 44 },
    { header: "Estimate role", weight: 18 },
    { header: "Total", weight: 12, align: "right" },
  ];
  const rows: ForensicTableRow[] = documents.map((document, index) => ({
    cells: [
      index === 0 ? "Annotated document" : `Compared against (${index})`,
      scrub(clean(document.fileName)),
      stripLeadingThe(describeEstimateRole(document.estimateRole, "role not resolved")),
      isNumber(document.total) ? money(document.total) : "not extracted",
    ],
  }));

  const blocks: ForensicBlock[] = [{ kind: "table", columns, rows }];

  const subjectTotal = input.subject.total;
  const comparisonTotal = input.comparisons?.[0]?.total;
  if (isNumber(subjectTotal) && isNumber(comparisonTotal)) {
    rows.push({
      variant: "total",
      cells: ["Difference between the printed totals", "", "", money(subjectTotal - comparisonTotal)],
    });
  }

  blocks.push({
    kind: "note",
    text: "Method. Both documents were parsed to structured line data. Lines were matched on part number first, then on normalised description plus operation plus side qualifier. The documents may come from different estimating platforms, so line numbers do not correspond and no weight is placed on sequence.",
  });
  return blocks;
}

function buildPlainSummarySection(
  records: ForensicFindingRecord[],
  subjectLabel: string,
  comparisonLabel: string,
  input: DeltaForensicReportInput,
  scrub: (value: string) => string
): ForensicBlock[] {
  if (!records.length) {
    return [
      {
        kind: "callout",
        tone: "neutral",
        paragraphs: [
          `No line-level differences were resolved between ${subjectLabel} and ${comparisonLabel}. That is a statement about what could be matched from the two documents as parsed, not a statement that the two appraisals agree in every respect.`,
        ],
      },
    ];
  }

  const presence = records.filter((record) => isPresenceDifference(record.finding));
  const values = records.filter((record) => isValueDifference(record.finding));
  const quantified = records
    .map((record) => findingDollarImpact(record.finding))
    .filter((value): value is number => value !== null);
  const quantifiedTotal = quantified.reduce((total, value) => total + value, 0);
  const hoursTotal = records
    .map((record) => findingHoursImpact(record.finding))
    .filter((value): value is number => value !== null)
    .reduce((total, value) => total + value, 0);
  const safety = records.filter((record) => isSafetyRelevant(record.finding));

  const paragraphs: string[] = [];

  const subjectTotal = input.subject.total;
  const comparisonTotal = input.comparisons?.[0]?.total;
  if (isNumber(subjectTotal) && isNumber(comparisonTotal)) {
    paragraphs.push(
      `What the two documents say. ${capitalize(subjectLabel)} totals ${money(subjectTotal)}. ${capitalize(comparisonLabel)} totals ${money(comparisonTotal)}. The difference between the two printed totals is ${money(subjectTotal - comparisonTotal)}.`
    );
  }

  const counts: string[] = [];
  if (presence.length) {
    counts.push(
      `${presence.length} ${plural(presence.length, "operation or part", "operations or parts")} written on one document with no counterpart on the other`
    );
  }
  if (values.length) {
    counts.push(
      `${values.length} ${plural(values.length, "line")} carried on both documents at different values`
    );
  }
  const otherCount = records.length - presence.length - values.length;
  if (otherCount > 0) {
    counts.push(`${otherCount} further documented ${plural(otherCount, "difference")}`);
  }
  if (counts.length) {
    paragraphs.push(`Where the difference comes from. This review identifies ${sentenceList(counts)}.`);
  }

  if (quantified.length) {
    const unquantified = records.length - quantified.length;
    paragraphs.push(
      `What is quantified. ${quantified.length} of the ${records.length} ${plural(records.length, "difference")} carry a dollar value on the face of the documents, totalling ${money(quantifiedTotal)}${hoursTotal > 0 ? ` and ${hours(hoursTotal)} of labor` : ""}.${
        unquantified > 0
          ? ` The remaining ${unquantified} ${plural(unquantified, "difference")} ${unquantified === 1 ? "is" : "are"} documented in Appendix C without a dollar value, because no amount was printed against ${unquantified === 1 ? "it" : "them"}.`
          : ""
      }`
    );
  } else {
    paragraphs.push(
      `What is quantified. None of the ${records.length} ${plural(records.length, "difference")} carries a dollar value that could be extracted from the documents. Each is documented on its own terms; no total is stated, because ${NOT_QUANTIFIED} means exactly that.`
    );
  }

  if (safety.length) {
    // Detector labels carry a classification prefix ("Expanded scope within a
    // present category: RT Blind spot radar"). Naming four of them in one
    // sentence repeated the prefix four times and buried the four operations,
    // which are the only part of the label the reader needs here.
    const named = [
      ...new Set(
        safety
          .map((record) => scrub(shortOperationName(record.finding.operationLabel)))
          .filter(Boolean)
      ),
    ].slice(0, 4);
    paragraphs.push(
      `The safety items. ${safety.length} of these ${plural(safety.length, "difference")} ${safety.length === 1 ? "is" : "are"} not cosmetic — ${sentenceList(named)}${safety.length > named.length ? `, and ${safety.length - named.length} more listed below` : ""}. Scanning, calibration and structural repair method are the items where an unfunded operation is not merely a cost compromise; a system can appear to work while being aimed incorrectly.`
    );
  }

  return [{ kind: "callout", tone: "owner", paragraphs }];
}

function buildReconciliationSection(
  records: ForensicFindingRecord[],
  input: DeltaForensicReportInput
): ForensicBlock[] {
  const reconciliation = input.canonicalDeltaSet?.reconciliation;
  if (reconciliation) {
    const categories = Object.entries(reconciliation.categoryDeltas)
      .filter(([, delta]) => isNumber(delta) && Math.abs(delta) > 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const rows: ForensicTableRow[] = categories.map(([category, delta]) => ({
      cells: [category, signedMoney(delta)],
      credit: delta > 0,
    }));
    rows.push({ variant: "total", cells: ["Pre-tax subtotal change", signedMoney(reconciliation.subtotalDelta)] });
    if (isNumber(reconciliation.taxDelta) && reconciliation.taxDelta !== 0) {
      rows.push({ cells: ["Tax change", signedMoney(reconciliation.taxDelta)] });
    }
    rows.push({
      variant: "total",
      cells: ["Grand total change", signedMoney(reconciliation.grandTotalDelta)],
    });
    return [
      {
        kind: "table",
        columns: [
          { header: "Category", weight: 72 },
          { header: "Change", weight: 28, align: "right" },
        ],
        rows,
      },
      {
        kind: "note",
        text: "These are the estimates' own category subtotals, not sums of individual line differences. Line prices do not add to a category total on a printed estimate — overlap deductions, included operations and rate multipliers sit between the two — so the two figures are reconciled here rather than conflated.",
      },
    ];
  }

  const quantified = records.filter((record) => findingDollarImpact(record.finding) !== null);
  if (!quantified.length) return [];

  const byTheme = new Map<ThemeKey, { count: number; total: number }>();
  for (const record of quantified) {
    const theme = themeOf(record.finding);
    const bucket = byTheme.get(theme) ?? { count: 0, total: 0 };
    bucket.count += 1;
    bucket.total += findingDollarImpact(record.finding) ?? 0;
    byTheme.set(theme, bucket);
  }

  const rows: ForensicTableRow[] = THEME_ORDER.filter((theme) => byTheme.has(theme)).map((theme) => {
    const bucket = byTheme.get(theme)!;
    return {
      cells: [THEME_TITLES[theme], String(bucket.count), money(bucket.total)],
    };
  });
  const total = quantified.reduce((sum, record) => sum + (findingDollarImpact(record.finding) ?? 0), 0);
  rows.push({
    variant: "total",
    cells: ["Total of quantified line differences", String(quantified.length), money(total)],
  });

  const unquantified = records.length - quantified.length;
  return [
    {
      kind: "table",
      columns: [
        { header: "Subject of the difference", weight: 62 },
        { header: "Lines", weight: 12, align: "right" },
        { header: "Amount in dispute", weight: 26, align: "right" },
      ],
      rows,
    },
    {
      kind: "note",
      text: `This table sums the line differences that carry a printed dollar value. It is not a reconciliation of the two documents' totals pages, and it should not be presented as one${
        unquantified > 0
          ? `; ${unquantified} further ${plural(unquantified, "difference")} ${unquantified === 1 ? "is" : "are"} documented in Appendix C with no amount extracted`
          : ""
      }.`,
    },
  ];
}

function buildThemeSection(
  records: ForensicFindingRecord[],
  subjectLabel: string,
  comparisonLabel: string,
  scrub: (value: string) => string
): ForensicBlock[] {
  const ordered = [...records].sort(
    (a, b) => (findingDollarImpact(b.finding) ?? -1) - (findingDollarImpact(a.finding) ?? -1)
  );
  const blocks: ForensicBlock[] = [];

  for (const record of ordered) {
    const finding = record.finding;
    const heading = record.markerNumber
      ? `Finding ${record.markerNumber} — ${scrub(clean(finding.operationLabel))}`
      : `Finding (listed only) — ${scrub(clean(finding.operationLabel))}`;
    blocks.push({ kind: "subheading", text: heading });

    const summary = scrub(clean(finding.currentSupportSummary));
    if (summary) blocks.push({ kind: "paragraph", text: summary });

    const evidence = buildEvidenceTable(record, subjectLabel, comparisonLabel, scrub);
    if (evidence) blocks.push(evidence);

    const followUp: string[] = [];
    const missing = scrub(clean(finding.missingProofSummary));
    if (missing) followUp.push(`Documentation still required: ${missing}`);
    const next = scrub(clean(finding.recommendedNextAction));
    if (next) followUp.push(`Next action: ${next}`);
    const authority = retrievedAuthority(finding);
    followUp.push(
      authority
        ? `Authority: ${authority.title}${authority.locator ? ` (${authority.locator})` : ""}`
        : "Authority: verification required — no supporting document was retrieved for this finding."
    );
    const limitations = readerFacingLimitations(finding.limitations);
    if (limitations) {
      followUp.push(`Limitation: ${scrub(limitations)}`);
    }
    blocks.push({ kind: "bullets", items: followUp });
  }

  return blocks;
}

function buildEvidenceTable(
  record: ForensicFindingRecord,
  subjectLabel: string,
  comparisonLabel: string,
  scrub: (value: string) => string
): ForensicBlock | null {
  const finding = record.finding;
  const here = finding.shopEvidence;
  const there = finding.carrierEvidence;
  if (!here && !there) return null;

  const describe = (evidence: typeof here) => {
    if (!evidence) return ["not written", "", ""];
    return [
      scrub(clean(evidence.description)) || "line carried",
      isNumber(evidence.amount) ? money(evidence.amount) : "no amount shown",
      isNumber(evidence.laborHours) ? hours(evidence.laborHours) : "no hours shown",
    ];
  };

  const [hereDescription, hereAmount, hereHours] = describe(here);
  const [thereDescription, thereAmount, thereHours] = describe(there);
  const rows: ForensicTableRow[] = [
    {
      cells: [
        `${capitalize(stripLeadingThe(subjectLabel))}${here?.lineNumber ? ` (Ln ${clean(here.lineNumber)})` : ""}`,
        hereDescription,
        hereAmount,
        hereHours,
      ],
    },
    {
      cells: [
        `${capitalize(stripLeadingThe(comparisonLabel))}${there?.lineNumber ? ` (Ln ${clean(there.lineNumber)})` : ""}`,
        thereDescription,
        thereAmount,
        thereHours,
      ],
    },
  ];

  // R10 — an absent basis is not a zero basis. A "Difference: not quantified /
  // 0.0 hrs" row states two things the documents do not: that the gap was
  // measured, and that it came to nothing. The row is emitted only when at
  // least one side of it carries a real figure.
  const dollars = findingDollarImpact(finding);
  const laborHours = findingHoursImpact(finding);
  const hasHours = laborHours !== null && laborHours !== 0;
  if (dollars !== null || hasHours) {
    rows.push({
      variant: "total",
      cells: [
        "Difference",
        "",
        dollars !== null ? money(dollars) : NOT_QUANTIFIED,
        hasHours ? hours(laborHours) : "",
      ],
    });
  }

  return {
    kind: "table",
    columns: [
      { header: "Document", weight: 26 },
      { header: "As written", weight: 40 },
      { header: "Amount", weight: 17, align: "right" },
      { header: "Labor", weight: 17, align: "right" },
    ],
    rows,
  };
}

function buildOwnerSection(
  records: ForensicFindingRecord[],
  comparisonLabel: string
): ForensicBlock[] {
  const paragraphs: string[] = [
    "A supplement is a stage in a claim, not a verdict. Additional damage found during repair is normally handled by a further supplement, and the documents themselves generally say so. Much of what is disputed here becomes visible only once panels are removed.",
    "If the two sides cannot agree on the amount, most policies contain an appraisal clause. It applies to disputes about the amount of loss, not about whether something is covered. Read the policy for the exact procedure and any time limits before invoking it.",
  ];

  if (records.some((record) => isSafetyRelevant(record.finding))) {
    paragraphs.push(
      "Whatever is agreed on dollars, ask in writing that the electronic systems named in these findings be scanned and calibrated after repair, and that you receive the post-repair scan report. These are the items where an unfunded operation is not merely a cost compromise."
    );
  }

  paragraphs.push(
    `Keep every document: both estimates, all supplements, the pre- and post-repair scan reports, and any parts invoices. If you later need to demonstrate what was and was not done, these are the record. Nothing in this report requires or recommends litigation, and nothing in it asserts that ${comparisonLabel} was prepared improperly.`
  );

  return [{ kind: "callout", tone: "owner", paragraphs }];
}

function buildResolutionSection(
  records: ForensicFindingRecord[],
  comparisonLabel: string
): ForensicBlock[] {
  if (!records.length) return [];
  const steps: string[] = [];

  const structural = records.filter((record) => themeOf(record.finding) === "structural");
  if (structural.length) {
    steps.push(
      "Reinspect the vehicle with both appraisers present and the affected panels removed. Structural findings are best settled at the vehicle rather than on paper."
    );
  }

  const adas = records.filter((record) => themeOf(record.finding) === "adas");
  if (adas.length) {
    steps.push(
      "Attach the model-specific calibration and scan requirements for this vehicle to support the diagnostic and calibration findings, and confirm which operations the repair facility will perform in house."
    );
  }

  const parts = records.filter((record) => themeOf(record.finding) === "parts");
  const labor = records.filter((record) => themeOf(record.finding) === "labor");
  if (parts.length && labor.length) {
    steps.push(
      "Address parts type separately from labor. The two turn on different evidence — a parts-type question turns on the position statement and the applicable disclosure rule, a labor question on documented procedure — and bundling them tends to stall both."
    );
  }

  const unretrieved = records.filter((record) => !retrievedAuthority(record.finding));
  if (unretrieved.length) {
    steps.push(
      `Obtain the supporting authority for the ${unretrieved.length} ${plural(unretrieved.length, "finding")} marked "verification required" before relying on ${unretrieved.length === 1 ? "it" : "them"} in a formal proceeding. Those findings state a documented difference between the two estimates; they do not yet carry a retrieved procedure or position statement.`
    );
  }

  steps.push(
    `Exchange the line list in the appendices with ${comparisonLabel}'s author and resolve the items that are not disputed in substance before the harder ones are reached. Correcting the mechanical items first narrows the dispute.`
  );
  steps.push(
    "If agreement is not reached, the appraisal clause in the policy is the contractual mechanism for resolving a difference in the amount of loss."
  );

  return [{ kind: "steps", items: steps }];
}

function buildAuthoritiesSection(
  records: ForensicFindingRecord[],
  input: DeltaForensicReportInput
): ForensicBlock[] {
  const rows: ForensicTableRow[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    const authority = retrievedAuthority(record.finding);
    if (!authority) continue;
    const key = authority.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      cells: [
        authority.title,
        clean(record.finding.operationLabel),
        authority.locator ?? "retrieved; no locator recorded",
      ],
    });
  }

  const unretrieved = records.filter((record) => !retrievedAuthority(record.finding)).length;

  const documents = [input.subject, ...(input.comparisons ?? [])].map((document) => document.fileName);
  rows.push({
    cells: [
      "The estimates themselves",
      "Every dollar figure, part number, hour and printed note in this report",
      documents.join("; "),
    ],
  });

  const blocks: ForensicBlock[] = [
    {
      kind: "table",
      columns: [
        { header: "Source", weight: 34 },
        { header: "What it supports", weight: 40 },
        { header: "Where to obtain", weight: 26, mono: true },
      ],
      rows,
    },
  ];

  if (unretrieved > 0) {
    blocks.push({
      kind: "note",
      text: `${unretrieved} ${plural(unretrieved, "finding")} in this report ${unretrieved === 1 ? "carries" : "carry"} no retrieved authority and ${unretrieved === 1 ? "is" : "are"} marked "verification required". No source is named for ${unretrieved === 1 ? "it" : "them"}, because naming an authority that was not retrieved would misstate the evidence. ${unretrieved === 1 ? "That finding rests" : "Those findings rest"} on the two estimates alone.`,
    });
  }
  blocks.push({
    kind: "note",
    text: "Statutory and regulatory text should be verified as current before being relied upon in any formal proceeding.",
  });
  return blocks;
}

function buildLimitationsSection(
  records: ForensicFindingRecord[],
  input: DeltaForensicReportInput,
  comparisonLabel: string,
  scrub: (value: string) => string
): ForensicBlock[] {
  const items: string[] = [];

  for (const note of input.textLayerNotes ?? []) {
    const text = scrub(clean(note));
    if (text) items.push(text);
  }
  for (const warning of input.warnings ?? []) {
    const text = scrub(clean(warning));
    if (text) items.push(text);
  }

  items.push(
    "Neither appraisal was prepared by the author of this report, and the vehicle was not physically inspected for it. Hidden damage may alter both estimates."
  );
  items.push(
    "Certain differences are legitimate professional judgement — repair-versus-replace calls, blend allowances and overlap deductions among them. This report quantifies them without asserting that one appraiser is necessarily correct."
  );

  const counterpartOnly = records.filter(
    (record) => record.finding.deltaClass === "PRESENT_ONLY_IN_COMPARISON"
  ).length;
  if (counterpartOnly > 0) {
    items.push(
      `${counterpartOnly} ${plural(counterpartOnly, "operation")} appears on ${comparisonLabel} and not on the annotated document. ${counterpartOnly === 1 ? "It is" : "They are"} listed in Appendix A and credited to ${comparisonLabel} throughout, not counted as a shortfall.`
    );
  }

  const lowConfidence = records.filter((record) => record.finding.confidence === "low").length;
  if (lowConfidence > 0) {
    items.push(
      `${lowConfidence} ${plural(lowConfidence, "finding")} ${lowConfidence === 1 ? "is" : "are"} recorded at low confidence and should be confirmed against the native files before being relied upon.`
    );
  }

  const unanchored = input.unanchored.length;
  if (unanchored > 0) {
    items.push(
      `${unanchored} ${plural(unanchored, "finding")} could not be tied to a measured row on the annotated document and ${unanchored === 1 ? "is" : "are"} listed in the unanchored appendix rather than marked on the estimate pages. ${unanchored === 1 ? "It carries" : "They carry"} no page annotation.`
    );
  }

  return [{ kind: "bullets", items }];
}

// ---------------------------------------------------------------------------
// Appendices
// ---------------------------------------------------------------------------

const APPENDIX_ROW_CAP = 120;

function buildPresenceAppendix(
  records: ForensicFindingRecord[],
  comparisonLabel: string,
  scrub: (value: string) => string
): ForensicBlock[] {
  const presence = records.filter((record) => isPresenceDifference(record.finding));
  if (!presence.length) return [];

  const grouped = new Map<ThemeKey, ForensicFindingRecord[]>();
  for (const record of presence) {
    const theme = themeOf(record.finding);
    grouped.set(theme, [...(grouped.get(theme) ?? []), record]);
  }

  const rows: ForensicTableRow[] = [];
  let printed = 0;
  let running = 0;

  for (const theme of THEME_ORDER) {
    const members = grouped.get(theme);
    if (!members?.length) continue;
    const groupTotal = members
      .map((record) => findingDollarImpact(record.finding))
      .filter((value): value is number => value !== null)
      .reduce((total, value) => total + value, 0);
    rows.push({
      variant: "group",
      cells: [THEME_TITLES[theme], "", groupTotal > 0 ? money(groupTotal) : NOT_QUANTIFIED],
    });
    for (const record of members) {
      if (printed >= APPENDIX_ROW_CAP) break;
      const amount = findingDollarImpact(record.finding);
      if (amount !== null) running += amount;
      rows.push({
        cells: [
          record.markerNumber ? `Finding ${record.markerNumber}` : "listed only",
          scrub(clean(record.finding.operationLabel)),
          amount !== null ? money(amount) : NOT_QUANTIFIED,
        ],
      });
      printed += 1;
    }
  }

  rows.push({
    variant: "total",
    cells: [`${printed} ${plural(printed, "line")}`, "Total with a printed amount", money(running)],
  });

  const blocks: ForensicBlock[] = [
    {
      kind: "note",
      text: `Each line below is written on one document and has no counterpart on the other. Amounts are as printed on the document that carries the line. Labor associated with these lines is captured in the reconciliation above and is not repeated here.`,
    },
    {
      kind: "table",
      columns: [
        { header: "Ref", weight: 14 },
        { header: `Operation or part — no counterpart on ${stripLeadingThe(comparisonLabel)}`, weight: 66 },
        { header: "Amount", weight: 20, align: "right" },
      ],
      rows,
    },
  ];

  if (presence.length > printed) {
    blocks.push({
      kind: "note",
      text: `Showing ${printed} of ${presence.length} lines. The remaining ${presence.length - printed} are recorded in the finding detail records that follow this appendix.`,
    });
  }
  return blocks;
}

function buildValueAppendix(
  records: ForensicFindingRecord[],
  subjectLabel: string,
  comparisonLabel: string,
  scrub: (value: string) => string
): ForensicBlock[] {
  const values = records.filter((record) => isValueDifference(record.finding));
  if (!values.length) return [];

  const ordered = [...values].sort(
    (a, b) => (findingDollarImpact(b.finding) ?? -1) - (findingDollarImpact(a.finding) ?? -1)
  );
  const shown = ordered.slice(0, APPENDIX_ROW_CAP);

  const rows: ForensicTableRow[] = shown.map((record) => {
    const here = record.finding.shopEvidence;
    const there = record.finding.carrierEvidence;
    const delta = findingDollarImpact(record.finding);
    return {
      cells: [
        record.markerNumber ? `Finding ${record.markerNumber}` : "listed only",
        scrub(clean(record.finding.operationLabel)),
        isNumber(here?.amount) ? money(here!.amount!) : "no amount shown",
        isNumber(there?.amount) ? money(there!.amount!) : "no amount shown",
        delta !== null ? money(delta) : NOT_QUANTIFIED,
      ],
    };
  });

  const total = shown
    .map((record) => findingDollarImpact(record.finding))
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => sum + value, 0);
  rows.push({
    variant: "total",
    cells: [`${shown.length} ${plural(shown.length, "line")}`, "Net difference across these lines", "", "", money(total)],
  });

  const blocks: ForensicBlock[] = [
    {
      kind: "table",
      columns: [
        { header: "Ref", weight: 13 },
        { header: "Operation", weight: 39 },
        { header: capitalize(stripLeadingThe(subjectLabel)), weight: 16, align: "right" },
        { header: capitalize(stripLeadingThe(comparisonLabel)), weight: 16, align: "right" },
        { header: "Difference", weight: 16, align: "right" },
      ],
      rows,
    },
  ];
  if (values.length > shown.length) {
    blocks.push({
      kind: "note",
      text: `Showing ${shown.length} of ${values.length} lines, ordered by amount. The remaining ${values.length - shown.length} are recorded in the finding detail records that follow this appendix.`,
    });
  }
  return blocks;
}

function buildDocumentationAppendix(
  records: ForensicFindingRecord[],
  scrub: (value: string) => string
): ForensicBlock[] {
  const unquantified = records.filter((record) => findingDollarImpact(record.finding) === null);
  if (!unquantified.length) return [];

  const shown = unquantified.slice(0, APPENDIX_ROW_CAP);
  const rows: ForensicTableRow[] = shown.map((record) => ({
    cells: [
      record.markerNumber ? `Finding ${record.markerNumber}` : "listed only",
      scrub(clean(record.finding.operationLabel)),
      scrub(clean(record.finding.missingProofSummary)) || "documentation not stated",
    ],
  }));

  const blocks: ForensicBlock[] = [
    {
      kind: "note",
      text: "These differences are documented on the estimates but carry no printed amount that could be extracted. They are excluded from every dollar total in this report. An absent amount is not a zero amount, and neither this report nor a negotiation built on it should treat it as one.",
    },
    {
      kind: "table",
      columns: [
        { header: "Ref", weight: 14 },
        { header: "Operation", weight: 44 },
        { header: "Documentation required", weight: 42 },
      ],
      rows,
    },
  ];
  if (unquantified.length > shown.length) {
    blocks.push({
      kind: "note",
      text: `Showing ${shown.length} of ${unquantified.length} lines. The remaining ${unquantified.length - shown.length} are recorded in the finding detail records that follow this appendix.`,
    });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function stripLeadingThe(value: string): string {
  return value.replace(/^the\s+/i, "");
}

function formatPreparedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
