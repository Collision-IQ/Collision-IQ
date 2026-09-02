/**
 * Module A — Rekey Sheet (WO-RK1 §3).
 *
 * Turns an already-extracted estimate into a CCC-ordered keying sheet: every
 * line pre-translated into CCC vocabulary, grouped in CCC order, with the
 * profile settings that must be set BEFORE keying printed first.
 *
 * It adds no new extraction. Rows and totals come from the shared estimate
 * reader (`parseCccEstimateRows` / `parseCccEstimateTotals`), which already
 * handles overprint normalization, glued columns, wrapped rows and the
 * changelog partition. This module only translates and arranges.
 *
 * What it will not do:
 *   - invent a CCC group for a section it does not recognize (UNMAPPED, carried
 *     verbatim, flagged);
 *   - distribute an aggregate clear-coat allowance across panels (an invented
 *     allocation, and it breaks Module B's line matching);
 *   - claim a per-line tax status the source does not print.
 */

import {
  parseCccEstimateRows,
  parseCccEstimateTotals,
  type EstimateDeltaRow,
} from "@/lib/reports/estimateDeltaMatcher";
import { readClaimIdentity } from "@/lib/reports/claimIdentityGate";
import { looksLikePartNumber } from "@/lib/reports/deltaEngine/estimateNormalize";
import { harvestPartsVendors, vendorLineSignature } from "./partsVendors";
import {
  looksLikeMitchellLayout,
  parseMitchellEstimateRows,
  parseMitchellEstimateTotals,
} from "./mitchellEstimateReader";
import { normalizeOverprintText } from "@/lib/reports/overprintNormalize";
import VOCABULARY from "./data/rekeyVocabulary.json";
import {
  UNMAPPED,
  groupSortIndex,
  normalizeVocabularyText,
  resolveLaborType,
  resolveOperation,
  resolvePartType,
  resolveSectionGroup,
  stripTrailingPartTypeWording,
} from "./rekeyVocabulary";
import type {
  RekeyExpectedTotals,
  RekeyGroup,
  RekeyLaborEntry,
  RekeyLedgerRow,
  RekeyProfileField,
  RekeySheet,
} from "./rekeyTypes";

const NOTE_CODES = new Set((VOCABULARY.noteCodes as string[]).map((code) => code.trim()));
const MANUAL_ENTRY_CODES = new Set((VOCABULARY.manualEntryCodes as string[]).map((code) => code.trim()));
const PROFILE_ROUTED_COST_LABELS = (VOCABULARY.profileRoutedCostLabels as string[]).map(normalizeVocabularyText);
const AGGREGATE_REFINISH_LABELS = (VOCABULARY.aggregateRefinishLabels as string[]).map(normalizeVocabularyText);

const MISCELLANEOUS_GROUP = "MISCELLANEOUS OPERATIONS";

/** The manual-line marker printed ahead of a row's description. */
const MANUAL_LINE_MARKER = /^\s*\d{1,4}\s*#/;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function money(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `$${value.toFixed(2)}`;
}

/** Values the source printed with an adjacent asterisk (Mitchell judgment items). */
function judgmentValues(rawText: string): Set<string> {
  const found = new Set<string>();
  for (const match of (rawText ?? "").matchAll(/(\d[\d,]*(?:\.\d+)?)\s*\*/g)) {
    found.add(match[1].replace(/,/g, ""));
  }
  return found;
}

function isJudgment(values: Set<string>, value: number | null): boolean {
  if (value === null) return false;
  return values.has(String(value)) || values.has(value.toFixed(2)) || values.has(value.toFixed(1));
}

function matchesLabel(description: string, labels: string[]): boolean {
  const normalized = normalizeVocabularyText(description);
  if (!normalized) return false;
  const padded = ` ${normalized} `;
  return labels.some((label) => label && (normalized === label || padded.includes(` ${label} `)));
}

/**
 * Notes printed as their own coded row ("900501 Reconcile with invoice"),
 * keyed to the row they qualify.
 *
 * These never reach the row parser — a coded note carries no operation, part
 * number, price or hours, so it is correctly rejected as a line item. They are
 * still worth printing on the sheet, indented under their row, because they are
 * instructions to the person keying. Harvested straight from the text so the
 * line-item path is untouched.
 */
export function harvestRowNotes(text: string): Map<number, string[]> {
  const notes = new Map<number, string[]>();
  if (!text) return notes;
  const lines = normalizeOverprintText(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  let lastRowLine: number | null = null;
  for (const line of lines) {
    const head = line.match(/^(?:S\d\s+)?(\d{1,3})\s+(.*)$/);
    const body = head ? head[2] : line;
    const codeMatch = body.match(/^(\d{6})\b\s*(.*)$/);
    if (codeMatch && NOTE_CODES.has(codeMatch[1])) {
      const prose = codeMatch[2].trim();
      if (prose && lastRowLine !== null) {
        notes.set(lastRowLine, [...(notes.get(lastRowLine) ?? []), prose]);
      }
      continue;
    }
    if (head) lastRowLine = Number(head[1]);
  }
  return notes;
}

/**
 * Recover an OEM part number the source prints WITH SPACES ("M1PZ 17E810 AA").
 *
 * The shared extractor reads a part number as a single token, so a spaced one
 * stays in the description and the row reaches the sheet with no part number
 * to key. WO-RK1 §3.4.6: CCC is keyed with the spacing removed, and the
 * printed form is kept for the estimator to compare against.
 *
 * Shape-based and anchored at the TAIL, because both platforms print the part
 * number after the description:
 *   - the run is the last tokens of the description, all upper-case
 *     alphanumeric, at least two of them;
 *   - every token carries a digit, except a 1-2 letter suffix at the very end
 *     ("AA") — which is what stops the walk from swallowing a side token
 *     ("LT") or any other all-caps description word;
 *   - at least one token must independently read as a part number.
 */
export function recoverSpacedPartNumber(
  description: string
): { partNumberSource: string; description: string } | null {
  const tokens = description.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  let start = tokens.length;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!/^[A-Z0-9][A-Z0-9.-]*$/.test(token)) break;
    const isTrailingSuffix = index === tokens.length - 1 && /^[A-Z]{1,2}$/.test(token);
    if (!/\d/.test(token) && !isTrailingSuffix) break;
    start = index;
  }

  const run = tokens.slice(start);
  if (run.length < 2) return null;
  if (!run.some((token) => looksLikePartNumber(token))) return null;

  return {
    partNumberSource: run.join(" "),
    description: tokens.slice(0, start).join(" ").trim(),
  };
}

/** Strip a leading manual-entry code from a description ("900500 Add for …"). */
function stripManualEntryCode(description: string): { description: string; code: string | null } {
  const match = description.match(/^(\d{6})\b\s*(.*)$/);
  if (!match || !MANUAL_ENTRY_CODES.has(match[1])) return { description, code: null };
  return { description: match[2].trim() || description, code: match[1] };
}

function buildLaborEntries(params: {
  row: EstimateDeltaRow;
  judgment: Set<string>;
  /** Refinish-only and blend operations bill refinish time by definition,
   *  whichever column the printed hours landed in. */
  forceRefinish: boolean;
}): RekeyLaborEntry[] {
  const { row, judgment, forceRefinish } = params;
  const entries: RekeyLaborEntry[] = [];
  const bodyType = forceRefinish ? "LAR" : (resolveLaborType(row.laborType) ?? "LAB");

  if (row.labor !== null || row.laborIncluded) {
    entries.push({
      type: bodyType,
      hours: row.labor ?? 0,
      included: row.laborIncluded,
      judgment: isJudgment(judgment, row.labor),
    });
  }
  if (row.paint !== null || row.paintIncluded) {
    entries.push({
      type: "LAR",
      hours: row.paint ?? 0,
      included: row.paintIncluded,
      judgment: isJudgment(judgment, row.paint),
    });
  }
  return entries;
}

/** A cost-only row: a dollar amount with no part number and no billed hours. */
function isCostOnlyRow(row: EstimateDeltaRow): boolean {
  return (
    row.price !== null &&
    !row.partNumber &&
    row.labor === null &&
    row.paint === null &&
    !row.laborIncluded &&
    !row.paintIncluded
  );
}

function flagsFor(row: RekeyLedgerRow): string[] {
  const flags: string[] = [];
  if (row.labor.some((entry) => entry.judgment) || row.misc?.judgment) flags.push("judgment");
  if (row.labor.some((entry) => entry.included)) flags.push("Incl.");
  if (row.misc?.sublet) flags.push("Subl");
  if (row.taxable === true) flags.push("Tax");
  if (!row.sectionMapped) flags.push("group: verify");
  if (!row.operationMapped) flags.push("operation: verify");
  if (row.operationCcc === "Manual") flags.push("manual line");
  if (row.partTypeCcc === UNMAPPED && row.partNumber) flags.push("part type: verify");
  return flags;
}

/** Words that identify a part rather than qualify it. */
const DESCRIPTION_QUALIFIERS = new Set([
  "LT", "RT", "LEFT", "RIGHT", "FRONT", "REAR", "UPPER", "LOWER", "INNER", "OUTER",
  "FRT", "UPR", "LWR", "W", "WO", "AND", "THE", "FOR", "PER", "OF", "ASSY", "ONLY",
  "PANEL", "NEW", "USED", "ADD",
]);

/**
 * True when two descriptions name the same part.
 *
 * Only the part NAME counts, so the description is cut at the first trim
 * qualifier the platform prints ("w/o performance", "(Alum)"). Without the
 * cut, "Bumper cover w/o performance" and "Tow eye cap w/o performance" share
 * the word "performance" and read as one part — which is exactly the pair that
 * was wrongly merged.
 */
export function sharesPartNoun(parent: string, child: string): boolean {
  const partName = (value: string) =>
    (value ?? "")
      .split(/\s(?:w\/o|w\/|wo|with|without)\s|\(/i)[0]
      .trim();
  const nouns = (value: string) =>
    new Set(
      normalizeVocabularyText(partName(value))
        .split(" ")
        .filter((word) => word.length >= 3 && !DESCRIPTION_QUALIFIERS.has(word))
    );
  const parentNouns = nouns(parent);
  for (const noun of nouns(child)) {
    if (parentNouns.has(noun)) return true;
  }
  return false;
}

function emptyGroupTotals(): RekeyGroup["totals"] {
  return { lines: 0, body: 0, paint: 0, mech: 0, parts: 0, misc: 0 };
}

function accumulate(totals: RekeyGroup["totals"], row: RekeyLedgerRow): void {
  totals.lines += 1;
  for (const entry of row.labor) {
    if (entry.included) continue;
    if (entry.type === "LAR") totals.paint = round1(totals.paint + entry.hours);
    else if (entry.type === "LAM") totals.mech = round1(totals.mech + entry.hours);
    else totals.body = round1(totals.body + entry.hours);
  }
  if (row.price !== null) totals.parts = round2(totals.parts + row.price);
  if (row.misc) totals.misc = round2(totals.misc + row.misc.amount);
}

function readDeductible(text: string): number | null {
  const match = /\bdeductible\b[^\n$]*\$?\s*([\d,]+\.\d{2})/i.exec(text ?? "");
  if (match) return Number(match[1].replace(/,/g, ""));
  return /\bdeductible\b[^\n]*\bwaived\b/i.test(text ?? "") ? 0 : null;
}

function findCategory(
  totals: RekeyExpectedTotals | null,
  pattern: RegExp
): { category: string; hours: number | null; rate: number | null; cost: number | null } | null {
  return totals?.categories.find((entry) => pattern.test(entry.category)) ?? null;
}

/**
 * Profile block (WO-RK1 §3.5). Printed at the TOP of the sheet because a wrong
 * profile explains every downstream number: CCC computes paint materials and
 * part markups from the profile, not from the keyed lines, so a materials or
 * recycled-part total that will not close is almost always set here.
 */
export function buildProfileBlock(params: {
  text: string;
  totals: RekeyExpectedTotals | null;
  /** Read off the totals block when that layout prints one there. */
  deductible?: number | null;
}): RekeyProfileField[] {
  const { text, totals } = params;
  const fields: RekeyProfileField[] = [];

  const rateField = (field: string, pattern: RegExp) => {
    const category = findCategory(totals, pattern);
    fields.push(
      category?.rate !== null && category?.rate !== undefined
        ? {
            field,
            value: category.rate,
            display: `${money(category.rate)}/hr`,
            basis: "printed",
            note: `Source totals: ${category.category}`,
          }
        : {
            field,
            value: null,
            display: "not printed",
            basis: "unavailable",
            note: "Set from the source estimate's totals page before keying.",
          }
    );
  };

  rateField("Body rate (LAB)", /body/i);
  rateField("Paint rate (LAR)", /refinish|paint labor/i);
  rateField("Mechanical rate (LAM)", /mechanical/i);

  // Any OTHER rate the totals page prints is a profile setting too. A real
  // estimate carried an "Aluminum Or Steel Repair" category at its own rate;
  // printing only the canonical three left a rate the estimator had to set and
  // was never told about, and the totals cannot close without it.
  const canonical = /body|refinish|paint labor|mechanical/i;
  for (const category of totals?.categories ?? []) {
    if (category.rate === null || canonical.test(category.category)) continue;
    if (/paint (?:supplies|materials?)/i.test(category.category)) continue;
    fields.push({
      field: `${category.category} rate`,
      value: category.rate,
      display: `${money(category.rate)}/hr`,
      basis: "printed",
      note: `Source totals: ${category.category}${
        category.hours === null ? "" : ` (${category.hours} h)`
      }`,
    });
  }

  // Paint supplies: CCC computes materials as rate x refinish hours. When the
  // source prints the materials line as a flat amount with no basis, the rate
  // is DERIVED from the printed refinish hours and labelled as derived — an
  // unset materials rate is the single most common reason a rekeyed estimate
  // will not close.
  const materials = findCategory(totals, /paint (?:supplies|materials?)/i);
  const refinish = findCategory(totals, /refinish|paint labor/i);
  if (materials?.rate !== null && materials?.rate !== undefined) {
    fields.push({
      field: "Paint supplies rate (MAPA)",
      value: materials.rate,
      display: `${money(materials.rate)}/unit`,
      basis: "printed",
      note: `Source totals: ${materials.category}`,
    });
  } else if (materials?.cost && refinish?.hours) {
    const derived = round2(materials.cost / refinish.hours);
    fields.push({
      field: "Paint supplies rate (MAPA)",
      value: derived,
      display: `${money(derived)}/unit`,
      basis: "derived",
      note: `${money(materials.cost)} ÷ ${refinish.hours} refinish hours — the source prints no rate.`,
    });
  } else {
    fields.push({
      field: "Paint supplies rate (MAPA)",
      value: null,
      display: "not printed",
      basis: "unavailable",
      note: "Materials will not close until this is set.",
    });
  }

  if (totals?.tax !== null && totals?.tax !== undefined) {
    const base = totals.subtotal ?? null;
    const pct = base && base > 0 ? round2((totals.tax / base) * 100) : null;
    fields.push({
      field: "Tax",
      value: totals.tax,
      display: pct === null ? money(totals.tax) : `${pct.toFixed(2)}% (${money(totals.tax)})`,
      basis: pct === null ? "printed" : "derived",
      note:
        totals.taxLanes.length > 1
          ? `Stacked lanes: ${totals.taxLanes.map((lane) => `${lane.label} ${money(lane.amount)}`).join(", ")}`
          : "Apply to labor, parts and materials as the source does.",
    });
  } else {
    fields.push({
      field: "Tax",
      value: null,
      display: "not printed",
      basis: "unavailable",
    });
  }

  fields.push({
    field: "Recycled / aftermarket markup",
    value: 0,
    display: "0%",
    basis: "instruction",
    note: "Source part prices are net. Any profile markup inflates every recycled and aftermarket line.",
  });

  const deductible = params.deductible ?? readDeductible(text);
  fields.push(
    deductible === null
      ? { field: "Deductible", value: null, display: "not printed", basis: "unavailable" }
      : {
          field: "Deductible",
          value: deductible,
          display: deductible === 0 ? "Waived / $0.00" : money(deductible),
          basis: "printed",
        }
  );

  return fields;
}

function toExpectedTotals(text: string): RekeyExpectedTotals | null {
  const parsed = parseCccEstimateTotals(text);
  if (!parsed) return null;
  return {
    categories: parsed.categories.map((entry) => ({
      category: entry.category,
      hours: entry.hours,
      rate: entry.rate,
      cost: entry.cost,
    })),
    subtotal: parsed.subtotal,
    tax: parsed.salesTax,
    grandTotal: parsed.grandTotal,
    taxLanes: parsed.taxLanes,
  };
}

function toMitchellExpectedTotals(text: string): RekeyExpectedTotals | null {
  const parsed = parseMitchellEstimateTotals(text);
  if (!parsed) return null;
  return {
    categories: parsed.categories,
    subtotal: parsed.subtotal,
    tax: parsed.tax,
    grandTotal: parsed.grandTotal,
    taxLanes: parsed.taxLanes,
  };
}

/**
 * Line numbers the source prints that produced no keying row.
 *
 * A row can be lost inside extraction for reasons this module cannot fix —
 * one real estimate wrapped a line's quantity onto its own printed line and
 * the shared reader dropped it whole. Losing a line silently is the failure
 * that matters: the estimator keys the sheet and the totals never close, with
 * nothing pointing at why. So the sheet counts what it did not read.
 *
 * Numbers consumed by section headings are not losses — the heading is printed
 * in the same numbered sequence as the rows — so a number whose text matches a
 * section this sheet already carries is excluded.
 */
export function findUnreadLineNumbers(params: {
  text: string;
  rows: RekeyLedgerRow[];
  /** Lines folded into another row are read, not lost. */
  foldedLines: number[];
  mitchellLayout: boolean;
}): number[] {
  const read = new Set<number>([
    ...params.rows.map((row) => row.sourceLine).filter((line): line is number => line !== null),
    ...params.foldedLines,
  ]);
  const anchor = params.mitchellLayout
    ? /^(\d{1,3})(?:\d{6}|AUTO)(?=[A-Za-z$])/
    : /^(\d{1,3})\s*(?=[#*A-Za-z])/;

  const lines = normalizeOverprintText(params.text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((value) => value.replace(/\s+/g, " ").trim());

  const unread: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = anchor.exec(lines[index]);
    if (!match) continue;
    const number = Number(match[1]);
    if (read.has(number) || unread.includes(number)) continue;

    // Test the whole PRINTED BLOCK, not the anchor line alone: the row whose
    // loss this check exists to catch is exactly the one whose value columns
    // wrapped onto their own line.
    let block = lines[index].slice(match[0].length);
    for (let ahead = index + 1; ahead < lines.length && !anchor.test(lines[ahead]); ahead += 1) {
      block += ` ${lines[ahead]}`;
    }

    // A numbered block that bills NOTHING is a heading or a boilerplate note,
    // not a lost row — both platforms number their section headings in the
    // same sequence as their rows. Money or hours is what an estimate line
    // always carries; a bare quantity is not enough, because the boilerplate
    // the preamble numbers carries one too.
    if (!/\$?\d[\d,]*\.\d{2}|(?:^|\s)\d{1,3}\.\d(?:\s|$)/.test(block)) continue;
    unread.push(number);
  }
  return unread.sort((a, b) => a - b);
}

export interface RekeySheetQuality {
  ok: boolean;
  reason: string | null;
}

/**
 * Whether the sheet is fit to key from.
 *
 * A sheet is not merely "short" when extraction fails — it is wrong, and it
 * looks convincing. Run against a layout its reader could not handle, one real
 * estimate produced a sheet whose rows were fragments of the document's own
 * totals pages ("Gross Total", "Deductible - $400.00"), every one of them
 * presented as a keyable line. Printing that invites an estimator to key it.
 *
 * The measure is structural: a real line item carries the line number the
 * source printed against it. When most rows have none, the row structure was
 * never found, whatever else was.
 */
export function assessRekeySheet(sheet: RekeySheet): RekeySheetQuality {
  const rows = sheet.rows.filter((row) => row.keyable);
  if (rows.length === 0) {
    return { ok: false, reason: "No estimate lines could be read from this document." };
  }
  const numbered = rows.filter((row) => row.sourceLine !== null).length;
  if (numbered / rows.length < 0.5) {
    return {
      ok: false,
      reason:
        "The line items in this document could not be read reliably — most of what was found carries no line number, which means the row structure was never located. No sheet was produced rather than one that cannot be trusted.",
    };
  }
  return { ok: true, reason: null };
}

export interface BuildRekeySheetParams {
  text: string;
  sourceFile: string;
}

export function buildRekeySheet(params: BuildRekeySheetParams): RekeySheet {
  const text = params.text ?? "";
  // Section-anchored preamble: a source estimate that spells its operations as
  // words carries few CCC op codes, and the default anchor would treat real
  // cost lines below the last op-coded row as boilerplate.
  const partsVendors = harvestPartsVendors(text);
  // Two print layouts, two readers. The shared reader assumes a row's columns
  // survive extraction as separate tokens, which the Mitchell print does not
  // do — see mitchellEstimateReader for what that costs.
  const mitchellLayout = looksLikeMitchellLayout(text);
  const parsedRows = mitchellLayout
    ? parseMitchellEstimateRows(text)
    : parseCccEstimateRows(text, { preambleAnchor: "section-anchored" }).filter((row) => {
    // Rows read out of the ESTIMATE TOTALS block are totals, never keying
    // rows; they are reconciled separately and must not be keyed twice.
    if (/\bESTIMATE TOTALS\b|\bTOTALS\b/i.test(row.section ?? "")) return false;
    // Same rule for the parts-vendors pages, joined on the row's own text.
    // The join is exact rather than positional, and a row that bills hours is
    // kept whatever it matches — a vendors listing bills none, so a row that
    // does cannot have come off one.
    const signature = vendorLineSignature(row.rawText ?? "");
    if (!signature) return true;
    const billsTime =
      row.labor !== null || row.paint !== null || row.laborIncluded || row.paintIncluded;
    if (billsTime) return true;
    return ![...partsVendors.signatures].some(
      (candidate) => candidate.includes(signature) || signature.includes(candidate)
    );
      });
  const expectedTotals = mitchellLayout ? toMitchellExpectedTotals(text) : toExpectedTotals(text);
  const identity = readClaimIdentity(text);
  const notesByLine = harvestRowNotes(text);
  const warnings: string[] = [];

  const ledger: RekeyLedgerRow[] = [];
  let nonKeyableRows = 0;
  let foldedRefinishRows = 0;

  parsedRows.forEach((row, index) => {
    const judgment = judgmentValues(row.rawText ?? "");
    const stripped = stripManualEntryCode(row.description ?? "");
    let operation = resolveOperation({ opCode: row.opCode, description: stripped.description });
    // The platform prints its own manual-line marker ahead of the description,
    // and its printed legend defines it. A marked row with no operation code
    // is a manual entry BY THE DOCUMENT'S OWN NOTATION, not by inference — so
    // it is named as one instead of being reported as untranslatable, which is
    // what the estimator has to key either way.
    if (!operation.mapped && MANUAL_LINE_MARKER.test(row.rawText ?? "")) {
      operation = { ...operation, ccc: "Manual", laborOpCode: "OP0", mapped: true };
    }
    const description = operation.description || stripped.description;


    // A spaced OEM part number left in the description is recovered before
    // anything keys off the description.
    const recovered = row.partNumber ? null : recoverSpacedPartNumber(description);
    const partNumberSource = recovered?.partNumberSource ?? row.partNumber;
    const withoutPartNumber = recovered ? recovered.description || description : description;

    const keyedDescription = stripTrailingPartTypeWording(withoutPartNumber) || withoutPartNumber;

    const section = resolveSectionGroup({ section: row.section, description: keyedDescription });
    const partType = resolvePartType({
      partSourceTokens: row.partSource,
      rawText: row.rawText,
      hasPartNumber: Boolean(partNumberSource),
    });
    const costOnly = isCostOnlyRow(row);
    const sublet = operation.sublet || partType.miscOnly;
    const taxable = /\bT\s*$/.test(row.rawText ?? "") ? true : null;

    const labor = buildLaborEntries({
      row,
      judgment,
      // Refinish-only, blend and clear-coat rows bill refinish time by
      // definition, whichever column the printed hours landed in.
      forceRefinish:
        operation.refinishOnly ||
        operation.ccc === "Blnd" ||
        matchesLabel(keyedDescription, AGGREGATE_REFINISH_LABELS),
    });

    const miscAmount = sublet || costOnly ? row.price : null;
    const ledgerRow: RekeyLedgerRow = {
      id: `row-${index + 1}`,
      sourceLine: row.lineNumber,
      supplementTag: row.supplementTag ?? null,
      sectionSource: row.section ?? null,
      sectionCcc: section.group,
      sectionMapped: section.mapped,
      descriptionSource: row.description ?? "",
      descriptionCcc: keyedDescription,
      operationSource: operation.sourceLabel,
      operationCcc: operation.ccc,
      operationMapped: operation.mapped,
      laborOpCode: operation.laborOpCode,
      partTypeSource: partType.sourceLabel,
      partTypeCcc: partNumberSource || partType.mapped ? partType.ccc : "None",
      partTypeEms: partType.ems,
      partNumber: partNumberSource ? partNumberSource.replace(/\s+/g, "") : null,
      partNumberSource,
      vendor: partNumberSource
        ? (partsVendors.byPartNumber.get(partNumberSource.replace(/\s+/g, "").toUpperCase()) ?? null)
        : null,
      qty: row.qty,
      price: miscAmount === null ? row.price : null,
      taxable,
      labor,
      misc:
        miscAmount === null
          ? null
          : {
              amount: miscAmount,
              sublet,
              taxable,
              judgment: isJudgment(judgment, miscAmount),
            },
      notes: row.lineNumber !== null ? [...(notesByLine.get(row.lineNumber) ?? [])] : [],
      keyable: true,
      flags: [],
    };

    // Paint materials are a PROFILE setting, not a keyed line — keying them as
    // a line double-counts against CCC's own materials calculation.
    if (costOnly && matchesLabel(keyedDescription, PROFILE_ROUTED_COST_LABELS)) {
      ledgerRow.keyable = false;
      ledgerRow.misc = null;
      ledgerRow.price = row.price;
      ledgerRow.notes.push("Do not key as a line — set the paint supplies rate in the profile block.");
      ledgerRow.sectionCcc = MISCELLANEOUS_GROUP;
      ledgerRow.sectionMapped = true;
    }

    ledgerRow.flags = flagsFor(ledgerRow);
    ledger.push(ledgerRow);
  });

  // Fold "Refinish Only" rows into the part line directly above them in the
  // same section, mirroring how CCC's own EMS splits one line into LAB + LAR
  // records. A refinish-only row with no such parent stands on its own.
  const folded: RekeyLedgerRow[] = [];
  const foldedLines: number[] = [];
  for (const row of ledger) {
    const previous = folded[folded.length - 1];
    const isRefinishOnly =
      row.labor.length > 0 &&
      row.labor.every((entry) => entry.type === "LAR") &&
      !row.partNumber &&
      row.misc === null &&
      normalizeVocabularyText(row.operationCcc) === "REFN";
    if (
      isRefinishOnly &&
      previous &&
      previous.keyable &&
      previous.sectionSource === row.sectionSource &&
      normalizeVocabularyText(previous.operationCcc) !== "REFN" &&
      // The two rows must describe the SAME part. "Hood Outside" folds into
      // "Hood Panel" because both name the hood; "Tow eye cap" does not fold
      // into "Bumper cover", and folding it there merged two different parts
      // into one keying row and lost the tow eye cap entirely.
      sharesPartNoun(previous.descriptionCcc, row.descriptionCcc)
    ) {
      previous.labor.push(...row.labor);
      previous.notes.push(
        `Refinish folded from source line ${row.sourceLine ?? "?"}: ${row.descriptionCcc} (${row.labor
          .map((entry) => entry.hours.toFixed(1))
          .join(" + ")} h).`
      );
      previous.flags = flagsFor(previous);
      foldedRefinishRows += 1;
      if (row.sourceLine !== null) foldedLines.push(row.sourceLine);
      continue;
    }
    folded.push(row);
  }

  // Clear coat is a MANUAL entry once the lines are rekeyed — CCC computes it
  // only for database lines — so every such row is annotated. What is NOT done
  // is merging them: an earlier version collapsed every clear-coat line into
  // one aggregate row in the miscellaneous group, which on a source that
  // prints clear coat PER PANEL destroyed the panel each allowance belongs to
  // and moved refinish hours out of their own section. The source's own
  // structure is evidence; flattening it is a loss, and re-distributing a
  // single aggregate would be an invention. Both are refused: the rows are
  // carried exactly as printed.
  const clearCoatRows = folded.filter((row) => matchesLabel(row.descriptionCcc, AGGREGATE_REFINISH_LABELS));
  for (const row of clearCoatRows) {
    row.notes.push(
      clearCoatRows.length === 1
        ? "Manual refinish entry — CCC does not generate clear coat for a manually keyed line. The source prints one allowance for the whole estimate; key it as ONE line and do not distribute it across panels."
        : "Manual refinish entry — CCC does not generate clear coat for a manually keyed line. The source prints clear coat per panel; key this one against the panel it is printed under."
    );
    if (!row.flags.includes("manual refinish")) row.flags.push("manual refinish");
  }

  for (const row of folded) {
    nonKeyableRows += row.keyable ? 0 : 1;
  }

  // Group in CCC order; within a group, source line order is preserved.
  const groupMap = new Map<string, RekeyGroup>();
  for (const row of folded) {
    const existing = groupMap.get(row.sectionCcc);
    const group = existing ?? {
      group: row.sectionCcc,
      mapped: row.sectionMapped,
      rows: [],
      totals: emptyGroupTotals(),
    };
    group.rows.push(row);
    if (row.keyable) accumulate(group.totals, row);
    if (!existing) groupMap.set(row.sectionCcc, group);
  }
  const groups = [...groupMap.values()].sort((a, b) => groupSortIndex(a.group) - groupSortIndex(b.group));

  const unmappedSections = folded.filter((row) => !row.sectionMapped).length;
  const unmappedOperations = folded.filter((row) => !row.operationMapped).length;

  if (parsedRows.length === 0) {
    warnings.push("No line items could be read from this document. Nothing was written to the sheet.");
  }
  if (!expectedTotals) {
    warnings.push(
      "No estimate totals block was found, so the profile block and the expected CCC totals could not be derived from this document."
    );
  }
  if (unmappedSections > 0) {
    warnings.push(
      `${unmappedSections} line${unmappedSections === 1 ? "" : "s"} sit in a section with no known CCC group. The source section name is printed verbatim — choose the group when keying.`
    );
  }
  if (unmappedOperations > 0) {
    warnings.push(
      `${unmappedOperations} line${unmappedOperations === 1 ? "" : "s"} carry an operation this build does not translate. The source wording is printed verbatim.`
    );
  }
  const unread = findUnreadLineNumbers({ text, rows: folded, foldedLines, mitchellLayout });
  if (unread.length > 0) {
    warnings.push(
      `${unread.length} line${unread.length === 1 ? "" : "s"} printed on the source produced no keying row (line${
        unread.length === 1 ? "" : "s"
      } ${unread.join(", ")}). Key ${
        unread.length === 1 ? "it" : "them"
      } from the source document — the totals below include ${unread.length === 1 ? "it" : "them"}.`
    );
  }

  const nonOemRowsNeedingVendor = folded.filter(
    (row) => ["A/M", "CAPA A/M", "LKQ", "Recond"].includes(row.partTypeCcc) && row.partNumber && !row.vendor
  );
  if (nonOemRowsNeedingVendor.length > 0) {
    warnings.push(
      partsVendors.lines.length === 0
        ? `${nonOemRowsNeedingVendor.length} aftermarket or recycled line${
            nonOemRowsNeedingVendor.length === 1 ? "" : "s"
          } need a vendor when keyed, and this document carries no parts-vendors page — take the vendor from the source estimate.`
        : `${nonOemRowsNeedingVendor.length} aftermarket or recycled line${
            nonOemRowsNeedingVendor.length === 1 ? "" : "s"
          } are not named on the parts-vendors page by part number, so no vendor was attached to them. The page is reproduced at the end of the sheet.`
    );
  }

  return {
    sourceFile: params.sourceFile,
    identity: {
      vin: identity.vin,
      claimNumber: identity.claimNumber,
      roNumber: identity.roNumber,
      vehicle: identity.vehicle,
    },
    profile: buildProfileBlock({
      text,
      totals: expectedTotals,
      deductible: mitchellLayout ? (parseMitchellEstimateTotals(text)?.deductible ?? null) : null,
    }),
    groups,
    rows: folded,
    expectedTotals,
    partsVendorsBlock: partsVendors.lines,
    stats: {
      sourceRows: parsedRows.length,
      keyableRows: folded.filter((row) => row.keyable).length,
      nonKeyableRows,
      foldedRefinishRows,
      unmappedSections,
      unmappedOperations,
      vendorsAttached: folded.filter((row) => row.vendor !== null).length,
    },
    warnings,
  };
}
