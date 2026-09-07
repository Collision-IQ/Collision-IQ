/**
 * The SOURCE estimate's own EMS export, used as the line data.
 *
 * A rekey sheet is read off a printed estimate: the columns are recovered from
 * a page, and everything downstream — the translation, the grouping, the
 * totals check — stands on that reading. When the shop also has the estimate's
 * own EMS export, the same values are available as DATA, stated by the system
 * that wrote the estimate, and there is no reason to prefer a reading of a
 * page over them.
 *
 * What the export cannot supply is the sheet's other half. Measured on a real
 * Mitchell export: its `.lin` carries no section headings at all, no totals
 * page, and no line notes — the print carries those. So this is a MERGE, not a
 * replacement: the page keeps the groups, the notes, the identity and the
 * totals page it reconciles against, and the export supplies the values of
 * each line.
 *
 * The merge is conservative by construction. A field is taken from the export
 * only where the export HAS one and this build knows how to read it; anything
 * else leaves the page's own reading standing. An export that maps to nothing
 * can only add, never subtract.
 */

import type { EstimateDeltaRow } from "@/lib/reports/estimateDeltaMatcher";
import type { EmsEstimate, EmsLine } from "./emsReader";
import VOCABULARY from "./data/rekeyVocabulary.json";
import { resolveOperation, resolveOperationCode } from "./rekeyVocabulary";
import { looksLikePartNumber } from "@/lib/reports/deltaEngine/estimateNormalize";

/** Letter → EMS labor code, inverted: the export states the code, and a parsed
 *  row carries the letter its print puts beside the hours. */
const LABOR_LETTER_BY_CODE = new Map(
  Object.entries(VOCABULARY.cccLaborMarkers as Record<string, string>).map(([letter, code]) => [code, letter])
);

/**
 * The codes an estimating system writes where a database reference would be,
 * to say the estimator typed this line rather than pulling it from the parts
 * and labor database. The same code appears as `VendorRefNum` in that
 * estimate's BMS, which is how the reading was confirmed: on the real pair,
 * both files mark the same 29 lines.
 *
 * POSITIVE EVIDENCE ONLY. One platform writes this reference on every line and
 * the other leaves the field empty throughout, so a line with no marker is a
 * line this build knows nothing about — never a line proved to be
 * database-backed.
 */
const MANUAL_ENTRY_CODES = new Set((VOCABULARY.manualEntryCodes as string[]).map((code) => code.trim()));

const PART_TYPES = VOCABULARY.partTypes as Array<{
  ccc: string;
  ems: string | null;
  aliases: string[];
  emsAliases?: string[];
}>;

/** The print word for an EMS part-type code, so the merged row resolves its
 *  part type through the same table every other row does. */
function partTypeWordFor(code: string | null): string | null {
  const normalized = (code ?? "").trim().toUpperCase();
  if (!normalized) return null;
  const entry = PART_TYPES.find(
    (candidate) =>
      (candidate.ems ?? "").toUpperCase() === normalized ||
      (candidate.emsAliases ?? []).some((alias) => alias.toUpperCase() === normalized)
  );
  if (!entry) return null;
  // The first alias is the word a print states; the CCC name is the fallback
  // for a type whose alias list is empty.
  return entry.aliases[0] ?? entry.ccc;
}

export interface SourceExportMerge {
  rows: EstimateDeltaRow[];
  /** Rows whose values came from the export rather than from the page. */
  merged: number;
  /** Lines the export carries that no printed row matched, by line number. */
  unmatched: number[];
  /** Line numbers the export itself marks as typed by the estimator. */
  manualLines: Set<number>;
}

/**
 * Merge an EMS export's line values into the rows read from the print.
 *
 * Rows are joined on the line number both sides print, which is the estimating
 * system's own numbering: measured on the real pair, all 84 printed rows join
 * a line, every price agrees, and the only hour differences are the refinish
 * lines the sheet deliberately folds into the panel above them.
 */
export function mergeSourceExportRows(params: {
  rows: EstimateDeltaRow[];
  estimate: EmsEstimate;
}): SourceExportMerge {
  const byLine = new Map<number, EmsLine>();
  for (const line of params.estimate.lines) {
    if (line.lineNumber === null) continue;
    if (!byLine.has(line.lineNumber)) byLine.set(line.lineNumber, line);
  }

  const matched = new Set<number>();
  const manualLines = new Set<number>();
  let merged = 0;
  const rows = params.rows.map((row) => {
    const line = row.lineNumber === null ? undefined : byLine.get(row.lineNumber);
    if (!line) return row;
    matched.add(row.lineNumber as number);
    if (isManualEntry(line.databaseRef)) manualLines.add(row.lineNumber as number);
    merged += 1;
    return mergeRow(row, line);
  });

  return {
    rows,
    merged,
    unmatched: [...byLine.keys()].filter((line) => !matched.has(line)).sort((a, b) => a - b),
    manualLines,
  };
}

/** Whether the export's own database reference says the estimator typed this
 *  line. False for an absent reference, which states nothing either way. */
export function isManualEntry(databaseRef: string | null | undefined): boolean {
  const code = (databaseRef ?? "").trim();
  return code !== "" && MANUAL_ENTRY_CODES.has(code);
}

function mergeRow(row: EstimateDeltaRow, line: EmsLine): EstimateDeltaRow {
  const merged: EstimateDeltaRow = { ...row };

  // Part number, quantity and price: the three columns a print welds together
  // and this build recovers by measuring the page. The export states them.
  //
  // An export writes a figure in every column of every line — zero where the
  // line has none — so a zero is only a value where the page also priced the
  // line. Taking every zero put a $0.00 price and a quantity of 1 on every
  // labor-only row, which is the noise class RV-5 exists to keep out.
  // An export's part-number column is not always a part number: this one
  // writes the literal word "Sublet" in ALT_PARTNO on every sublet line, and
  // carrying it would put a word in the column the estimator orders from.
  const exportedPartNumber = line.partNumber ? line.partNumber.replace(/\s+/g, "") : null;
  if (exportedPartNumber && looksLikePartNumber(exportedPartNumber)) merged.partNumber = exportedPartNumber;
  const priced = (line.price ?? 0) !== 0 || merged.price !== null;
  if (priced && line.price !== null) merged.price = line.price;
  if (priced && line.qty !== null) merged.qty = line.qty;

  // The part type, as a code rather than as a word read off a column.
  const partWord = partTypeWordFor(line.partType);
  if (partWord) merged.partSource = [partWord];

  // Labor: typed hours, and the included flag stated rather than inferred from
  // an "Incl." cell.
  const body = line.labor.find((entry) => (entry.type ?? "").toUpperCase() === "LAB");
  const refinish = line.labor.find((entry) => (entry.type ?? "").toUpperCase() === "LAR");
  const other = line.labor.find(
    (entry) => entry.type && !["LAB", "LAR"].includes(entry.type.toUpperCase()) && LABOR_LETTER_BY_CODE.has(entry.type.toUpperCase())
  );
  if (body) {
    merged.labor = body.included === true ? null : (body.hours ?? merged.labor);
    merged.laborIncluded = body.included === true;
  }
  if (refinish) {
    merged.paint = refinish.included === true ? null : (refinish.hours ?? merged.paint);
    merged.paintIncluded = refinish.included === true;
  }
  if (other && other.type) {
    // A non-body labor type is a LETTER on the print and a code in the export;
    // the row carries the letter, so the code is translated back through the
    // print's own legend rather than a second table.
    merged.laborType = LABOR_LETTER_BY_CODE.get(other.type.toUpperCase()) ?? merged.laborType ?? null;
    merged.labor = other.included === true ? null : (other.hours ?? merged.labor);
    merged.laborIncluded = other.included === true;
  }

  // The operation, from the export's labor operation code — translated to the
  // operation this build names, because the row's own field is the printed
  // abbreviation ("Repl", "R&I"), not a labor code. Only a code the vocabulary
  // knows is taken: an unknown one would replace a description this build
  // reads correctly with an operation it cannot name, which is worse than the
  // page.
  //
  // And only where the ROW does not already state its operation. This print
  // spells the operation into the description ("Remove Replace Frt Bumper
  // Cover"), and the reading that resolves it is the same reading that lifts
  // those words out; supplying the operation separately settled the operation
  // and left the words behind, putting "Remove Replace" into the keying
  // description of 73 of 84 rows. The export answers where the page could not,
  // and stays out of the way where it could.
  const alreadyStated = resolveOperation({ opCode: row.opCode, description: row.description }).mapped;
  if (!alreadyStated) {
    const opCode = line.labor.map((entry) => entry.opCode).find(Boolean) ?? null;
    const operation = opCode ? resolveOperationCode(opCode) : null;
    if (operation) merged.opCode = operation;
  }

  return merged;
}
