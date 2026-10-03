/**
 * A comparison line that states, in its own note, the work it includes.
 *
 * RO 21548: the carrier wrote one line, "Other diagnostic services-TESLA
 * TOOLBOX" (1.0 hr), noted "(includes pre and post and 1 Calibration and
 * Service Mode)". The shop itemizes that work on eight lines: pre- and
 * post-repair scan, the camera calibration steps, service mode in and out.
 * Paired line to line, all eight read as missing from the carrier and the
 * carrier's line as missing from the shop: nine false statements about one
 * item of work the carrier pays, at fewer hours.
 *
 * The note is the carrier's own statement of scope. A comparison line nothing
 * paired with, whose note says it includes named work, is compared ONCE
 * against our unpaired lines that name that work: the hours difference is the
 * finding, and neither side is "missing".
 *
 * The vocabulary is deliberately narrow (scans, calibration, service mode) and
 * applies only to a diagnostic comparison line. A note it does not recognize,
 * or one that EXCLUDES work, leaves both sides exactly as the matcher read them.
 */
import type { EstimateDeltaRow, EstimateLineItemDelta } from "./estimateDeltaMatcher";
import { lineAnnotationsFromText } from "./appraisalSummary/estimateFromDeltaRows";

const DIAGNOSTIC_LINE = /diagnos|scan|calibrat|\badas\b|toolbox/i;
const INCLUDES = /\binclud(?:es|ing|ed)\b([^.]*)/i;
const NEGATED = /(?:does\s*n[o']?t|do\s+not|\bnot)\s+includ|\bexclud/i;

/** What a note names, and the wording of our lines that do that work. */
const TERMS: ReadonlyArray<{ named: RegExp; ours: RegExp }> = [
  { named: /\bpre\b/i, ours: /\bpre[\s-]*(?:repair\s+)?(?:scan|diagnostic)/i },
  { named: /\bpost\b/i, ours: /\bpost[\s-]*(?:repair\s+)?(?:scan|diagnostic)/i },
  { named: /calibrat/i, ours: /calibrat|initiate\s+camera|capture\s+image|adjust\s+cameras?/i },
  { named: /service\s+mode/i, ours: /service\s+mode/i },
];

export interface InclusionCoverage {
  lowerRow: EstimateDeltaRow;
  /** The work the note names, as printed. */
  included: string;
  coveredRows: EstimateDeltaRow[];
}

const hoursOf = (row: EstimateDeltaRow) => (row.labor ?? 0) + (row.paint ?? 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const hr = (n: number) => n.toFixed(1);

export function applyComparisonInclusionNotes(params: {
  deltas: EstimateLineItemDelta[];
  lowerOnlyRows: EstimateDeltaRow[];
  comparisonText: string;
  comparisonName: string;
}): { deltas: EstimateLineItemDelta[]; lowerOnlyRows: EstimateDeltaRow[]; coverage: InclusionCoverage[] } {
  const notes = lineAnnotationsFromText(params.comparisonText);
  let deltas = [...params.deltas];
  let lowerOnlyRows = [...params.lowerOnlyRows];
  const coverage: InclusionCoverage[] = [];
  for (const lowerRow of params.lowerOnlyRows) {
    if (lowerRow.lineNumber === null || !DIAGNOSTIC_LINE.test(lowerRow.description)) continue;
    const note = notes.get(lowerRow.lineNumber)?.note?.trim();
    if (!note || NEGATED.test(note)) continue;
    const included = note.match(INCLUDES)?.[1]?.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
    if (!included) continue;
    const terms = TERMS.filter((term) => term.named.test(included));
    if (!terms.length) continue;
    const covered = deltas.filter(
      (delta) =>
        delta.kind === "missing_operation" &&
        delta.lowerRow === null &&
        terms.some((term) => term.ours.test(delta.higherRow.description))
    );
    if (!covered.length) continue;
    const coveredRows = covered.map((delta) => delta.higherRow);
    coverage.push({ lowerRow, included, coveredRows });
    deltas = deltas.filter((delta) => !covered.includes(delta));
    lowerOnlyRows = lowerOnlyRows.filter((row) => row !== lowerRow);

    const ours = round1(coveredRows.reduce((sum, row) => sum + hoursOf(row), 0));
    const theirs = round1(hoursOf(lowerRow));
    const net = round1(ours - theirs);
    if (net === 0) continue;
    const lines = coveredRows.map((row) => row.lineNumber).filter((line): line is number => line !== null);
    const lead = coveredRows[0];
    const types = new Set(coveredRows.map((row) => row.laborType ?? null));
    const others = coveredRows.length - 1;
    deltas.push({
      kind: "reduced_labor",
      lowerRow,
      higherRow: {
        ...lead,
        description: `${lead.description}${others ? ` and ${others} more line${others === 1 ? "" : "s"}` : ""} that "${lowerRow.description}" includes`,
        laborType: types.size === 1 ? lead.laborType ?? null : null,
      },
      coveredHigherLines: lines,
      matchBasis: "description",
      laborDelta: net,
      paintDelta: null,
      priceDelta: null,
      summary:
        `"${lowerRow.description}" (line ${lowerRow.lineNumber}, ${hr(theirs)} hr) on ${params.comparisonName} states it includes ${included}. ` +
        `This estimate itemizes that work on ${coveredRows.length} line${coveredRows.length === 1 ? "" : "s"} (${lines.map((line) => `L${line}`).join(", ")}) at ${hr(ours)} hr in total. ` +
        (net > 0
          ? `The comparison estimate pays the work at ${hr(net)} hr less; the difference is hours, not a missing operation.`
          : `The comparison estimate allows ${hr(-net)} hr more for it.`),
      changedFields: ["labor"],
      statusLabels: ["COVERED_BY_COMPARISON_NOTE"],
      annotate: true,
    });
  }
  return { deltas, lowerOnlyRows, coverage };
}
