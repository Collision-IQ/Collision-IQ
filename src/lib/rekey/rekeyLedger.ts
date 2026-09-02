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
  if (row.partTypeCcc === UNMAPPED && row.partNumber) flags.push("part type: verify");
  return flags;
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

  const deductible = readDeductible(text);
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
  const parsedRows = parseCccEstimateRows(text, { preambleAnchor: "section-anchored" }).filter((row) => {
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
  const expectedTotals = toExpectedTotals(text);
  const identity = readClaimIdentity(text);
  const notesByLine = harvestRowNotes(text);
  const warnings: string[] = [];

  const ledger: RekeyLedgerRow[] = [];
  const aggregateRefinish: { hours: number; sourceLines: number[] } = { hours: 0, sourceLines: [] };
  let nonKeyableRows = 0;
  let foldedRefinishRows = 0;

  parsedRows.forEach((row, index) => {
    const judgment = judgmentValues(row.rawText ?? "");
    const stripped = stripManualEntryCode(row.description ?? "");
    const operation = resolveOperation({ opCode: row.opCode, description: stripped.description });
    const description = operation.description || stripped.description;

    // Aggregate clear-coat allowance: one manual refinish row, never spread
    // across panels. CCC only auto-computes clear coat for database lines, and
    // rekeyed lines are manual, so nothing generates it — but distributing it
    // is an allocation the source never made.
    if (matchesLabel(description, AGGREGATE_REFINISH_LABELS)) {
      const hours = row.paint ?? row.labor ?? 0;
      if (hours > 0) {
        aggregateRefinish.hours = round1(aggregateRefinish.hours + hours);
        if (row.lineNumber !== null) aggregateRefinish.sourceLines.push(row.lineNumber);
        return;
      }
    }

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
      forceRefinish: operation.refinishOnly || operation.ccc === "Blnd",
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
      normalizeVocabularyText(previous.operationCcc) !== "REFN"
    ) {
      previous.labor.push(...row.labor);
      previous.notes.push(
        `Refinish folded from source line ${row.sourceLine ?? "?"}: ${row.descriptionCcc} (${row.labor
          .map((entry) => entry.hours.toFixed(1))
          .join(" + ")} h).`
      );
      previous.flags = flagsFor(previous);
      foldedRefinishRows += 1;
      continue;
    }
    folded.push(row);
  }

  if (aggregateRefinish.hours > 0) {
    const aggregateRow: RekeyLedgerRow = {
      id: `row-clear-coat`,
      sourceLine: aggregateRefinish.sourceLines[0] ?? null,
      supplementTag: null,
      sectionSource: null,
      sectionCcc: MISCELLANEOUS_GROUP,
      sectionMapped: true,
      descriptionSource: "Add for Clear Coat",
      descriptionCcc: "Add for Clear Coat (source aggregate)",
      operationSource: "Refinish",
      operationCcc: "Refn",
      operationMapped: true,
      laborOpCode: "OP0",
      partTypeSource: null,
      partTypeCcc: "None",
      partTypeEms: null,
      partNumber: null,
      partNumberSource: null,
      vendor: null,
      qty: null,
      price: null,
      taxable: null,
      labor: [{ type: "LAR", hours: aggregateRefinish.hours, included: false, judgment: false }],
      misc: null,
      notes: [
        `Manual refinish entry. The source prints one aggregate allowance (source line${
          aggregateRefinish.sourceLines.length === 1 ? "" : "s"
        } ${aggregateRefinish.sourceLines.join(", ") || "—"}); key it as ONE line and do not distribute it across panels.`,
      ],
      keyable: true,
      flags: ["aggregate"],
    };
    folded.push(aggregateRow);
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
    profile: buildProfileBlock({ text, totals: expectedTotals }),
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
