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
 * against our lines that name that work: the hours difference is the finding,
 * and neither side is "missing". Our lines it takes are the unpaired ones, and
 * the ones the matcher paired with a 0.0 hr comparison line whose OWN note
 * says it is included in this one (RO 22120: "Pre-repair scan 0.0", noted
 * "Included in Tesla tool Box"); those comparison lines join the same
 * comparison, so every line on both sheets is counted once.
 *
 * What the note does not establish is said, not assumed: which of our lines
 * its words name and which are counted with it by inference (drive time for a
 * calibration, taking the vehicle out of service mode, which the same carrier
 * pays as separate lines elsewhere), and that it never divides its hours among
 * those steps. A note that includes a counted number of calibrations does not
 * absorb our calibrations of more distinct targets than that: which one it
 * includes is not stated, so those lines stay assessed on their own and the
 * question is raised for verification.
 *
 * The vocabulary is deliberately narrow (scans, calibration, service mode) and
 * applies only to a diagnostic comparison line: one whose description reads
 * diagnostic, or one printed in a diagnostic section ("Tesla Tool Box" under
 * VEHICLE DIAGNOSTICS). A note it does not recognize, or one that EXCLUDES
 * work, leaves both sides exactly as the matcher read them.
 */
import type { EstimateDeltaRow, EstimateLineItemDelta } from "./estimateDeltaMatcher";
import { lineAnnotationsFromText } from "./appraisalSummary/estimateFromDeltaRows";
import { noteCoverScope } from "./appraisalSummary/argueItems";

const DIAGNOSTIC_LINE = /diagnos|scan|calibrat|\badas\b|tool\s*box/i;
/** The CCC section a diagnostic bundle prints under ("VEHICLE DIAGNOSTICS"). */
const DIAGNOSTIC_SECTION = /diagnos|calibrat|\badas\b/i;
const INCLUDES = /\binclud(?:es|ing|ed)\b([^.]*)/i;
const NEGATED = /(?:does\s*n[o']?t|do\s+not|\bnot)\s+includ|\bexclud/i;
/** A comparison line's own note naming the line it is included in. */
const INCLUDED_IN = /\bincluded\s+(?:in|with)\s+([^.;]+)/i;
/** A back-reference shorter than this names nothing ("Included in labor"). */
const MIN_REFERENCE_LETTERS = 6;

interface Term {
  /** The note names the work. "pre" alone is not a scan ("includes pre-drilled holes"). */
  named: RegExp;
  /** Our lines that do that work. */
  ours: RegExp;
  /** Our lines that do related work the note's words do not name. */
  byInference?: RegExp;
  calibration?: boolean;
}

/** What a note names, and the wording of our lines that do that work. */
const TERMS: ReadonlyArray<Term> = [
  {
    named: /\bpre[\s-]*(?:and|&|\/)[\s-]*post\b|\bpre[\s-]*(?:repair\s+)?scan/i,
    ours: /\bpre[\s-]*(?:repair\s+)?(?:scan|diagnostic)/i,
  },
  {
    named: /\bpre[\s-]*(?:and|&|\/)[\s-]*post\b|\bpost[\s-]*(?:repair\s+)?scan/i,
    ours: /\bpost[\s-]*(?:repair\s+)?(?:scan|diagnostic)/i,
  },
  {
    named: /calibrat/i,
    ours: /calibrat|initiate\s+camera|capture\s+image|adjust\s+cameras?/i,
    byInference: /\bdrive\b|\broad\s*test|\btest\s*drive/i,
    calibration: true,
  },
  { named: /service\s+mode/i, ours: /service\s+mode/i, byInference: /\b(?:remove|exit|take)\b|\bout\s+of\b/i },
];

/** What a calibration line calibrates; one note calibration is one of these. */
const CALIBRATION_TARGET =
  /\b(camera|radar|lidar|sonar|blind\s*spot|park(?:ing)?\s+(?:aid|assist|sensor)|steering\s+angle|night\s+vision|head[\s-]*up)/gi;
const COUNT_WORDS: Record<string, number> = { one: 1, single: 1, two: 2, three: 3, four: 4, five: 5 };

export interface InclusionCoverage {
  lowerRow: EstimateDeltaRow;
  /** The work the note names, as printed. */
  included: string;
  coveredRows: EstimateDeltaRow[];
  /** Comparison lines whose own note says they are included in `lowerRow`. */
  coveredLowerRows: EstimateDeltaRow[];
  /** How many of `coveredRows` the matcher had reported as missing. */
  missingCount: number;
}

const hoursOf = (row: EstimateDeltaRow) => (row.labor ?? 0) + (row.paint ?? 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const hr = (n: number) => n.toFixed(1);
const compact = (text: string) => text.toLowerCase().replace(/[^a-z]+/g, "");
const refs = (rows: EstimateDeltaRow[]) => rows.map((row) => `L${row.lineNumber}`).join(", ");

/** How many calibrations a note includes: its count, else one for "calibration", any for "calibrations". */
function calibrationLimit(included: string): number {
  const count = included.match(/\b(\d+|one|single|two|three|four|five)\s+calibrations?\b/i)?.[1]?.toLowerCase();
  if (count) return COUNT_WORDS[count] ?? Number(count);
  return /calibrations\b/i.test(included) ? Infinity : 1;
}

function calibrationTargets(description: string): string[] {
  return [...description.matchAll(CALIBRATION_TARGET)].map((m) => m[1].toLowerCase().replace(/[\s-]+/g, " "));
}

export function applyComparisonInclusionNotes(params: {
  deltas: EstimateLineItemDelta[];
  lowerOnlyRows: EstimateDeltaRow[];
  comparisonText: string;
  comparisonName: string;
}): {
  deltas: EstimateLineItemDelta[];
  lowerOnlyRows: EstimateDeltaRow[];
  coverage: InclusionCoverage[];
  /** Questions a note raises and does not answer, for open verification. */
  verify: string[];
} {
  const notes = lineAnnotationsFromText(params.comparisonText);
  let deltas = [...params.deltas];
  let lowerOnlyRows = [...params.lowerOnlyRows];
  const coverage: InclusionCoverage[] = [];
  const verify: string[] = [];
  for (const lowerRow of params.lowerOnlyRows) {
    if (lowerRow.lineNumber === null || !lowerOnlyRows.includes(lowerRow)) continue;
    if (!DIAGNOSTIC_LINE.test(lowerRow.description) && !DIAGNOSTIC_SECTION.test(lowerRow.section ?? "")) continue;
    const annotation = notes.get(lowerRow.lineNumber);
    const note = annotation?.note?.trim();
    if (!note || NEGATED.test(note)) continue;
    const included = note.match(INCLUDES)?.[1]?.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
    if (!included) continue;
    const terms = TERMS.filter((term) => term.named.test(included));
    if (!terms.length) continue;

    // A 0.0 hr comparison line whose own note says it is included in this one.
    // The name is looked for in this line's printed text with its wrapped
    // continuations joined ("…-TESLA" / "TOOLBOX"), in one direction only.
    const bundleText = compact(annotation?.rowText ?? lowerRow.description);
    const pointsHere = (row: EstimateDeltaRow | null): row is EstimateDeltaRow => {
      if (!row || row.lineNumber === null || row.lineNumber === lowerRow.lineNumber) return false;
      if (hoursOf(row) !== 0 || (row.price ?? 0) !== 0) return false;
      const target = notes.get(row.lineNumber)?.note?.match(INCLUDED_IN)?.[1];
      const key = target ? compact(target) : "";
      return key.length >= MIN_REFERENCE_LETTERS && bundleText.includes(key);
    };
    const termsOf = (row: EstimateDeltaRow) => terms.filter((term) => term.ours.test(row.description));
    let covered = deltas.filter(
      (delta) =>
        termsOf(delta.higherRow).length > 0 &&
        ((delta.kind === "missing_operation" && delta.lowerRow === null) || pointsHere(delta.lowerRow))
    );

    // "1 Calibration" against our calibrations of more distinct targets: the
    // note does not say which one it includes, so none is folded in.
    const calibrationOnly = covered.filter((delta) => termsOf(delta.higherRow).every((term) => term.calibration));
    const targets = [...new Set(calibrationOnly.flatMap((delta) => calibrationTargets(delta.higherRow.description)))];
    const limit = calibrationLimit(included);
    if (calibrationOnly.length && targets.length > limit) {
      covered = covered.filter((delta) => !calibrationOnly.includes(delta));
      verify.push(
        `"${lowerRow.description}" (line ${lowerRow.lineNumber}) on ${params.comparisonName} states it includes ${included}. ` +
          `This estimate itemizes calibration of ${targets.length} targets (${targets.join(", ")}) on ${refs(calibrationOnly.map((delta) => delta.higherRow))}; ` +
          `which of them the note includes is not stated, so those lines are assessed on their own. Verify with the comparison estimate's author.`
      );
    }
    if (!covered.length) continue;

    const coveredRows = covered.map((delta) => delta.higherRow);
    const coveredLowerRows = [
      ...new Set([...covered.map((delta) => delta.lowerRow).filter(pointsHere), ...lowerOnlyRows.filter(pointsHere)]),
    ].sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
    const missingCount = covered.filter((delta) => delta.kind === "missing_operation").length;
    coverage.push({ lowerRow, included, coveredRows, coveredLowerRows, missingCount });
    deltas = deltas.filter((delta) => !covered.includes(delta));
    lowerOnlyRows = lowerOnlyRows.filter((row) => row !== lowerRow && !coveredLowerRows.includes(row));

    const ours = round1(coveredRows.reduce((sum, row) => sum + hoursOf(row), 0));
    const theirs = round1(hoursOf(lowerRow) + coveredLowerRows.reduce((sum, row) => sum + hoursOf(row), 0));
    const net = round1(ours - theirs);
    if (net === 0) continue;
    const lines = coveredRows.map((row) => row.lineNumber).filter((line): line is number => line !== null);
    // Our line is counted by inference when every term it answers to marks it so.
    const inferred = coveredRows.filter((row) => termsOf(row).every((term) => term.byInference?.test(row.description)));
    const lineOf = (row: EstimateDeltaRow) => row.lineNumber as number;
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
      ...(coveredLowerRows.length ? { coveredLowerLines: coveredLowerRows.map(lineOf) } : {}),
      ...(inferred.length ? { coveredByInferenceLines: inferred.filter((row) => row.lineNumber !== null).map(lineOf) } : {}),
      matchBasis: "description",
      laborDelta: net,
      paintDelta: null,
      priceDelta: null,
      summary:
        `"${lowerRow.description}" (line ${lowerRow.lineNumber}, ${hr(hoursOf(lowerRow))} hr) on ${params.comparisonName} states it includes ${included}. ` +
        `This estimate itemizes that work on ${coveredRows.length} line${coveredRows.length === 1 ? "" : "s"} (${lines.map((line) => `L${line}`).join(", ")}) at ${hr(ours)} hr in total. ` +
        noteCoverScope({
          hours: hoursOf(lowerRow),
          crossRefs: coveredLowerRows.map((row) => ({
            line: lineOf(row),
            hours: hoursOf(row),
            note: notes.get(lineOf(row))?.note?.trim() ?? "",
          })),
          named: coveredRows.filter((row) => !inferred.includes(row) && row.lineNumber !== null).map(lineOf),
          inferred: inferred.filter((row) => row.lineNumber !== null).map(lineOf),
          theirs: `On ${params.comparisonName},`,
          ours: "",
        }) +
        " " +
        (net > 0
          ? `The difference is ${hr(net)} hr, not a missing operation.`
          : `The comparison estimate allows ${hr(-net)} hr more in total.`),
      changedFields: ["labor"],
      statusLabels: ["COVERED_BY_COMPARISON_NOTE"],
      annotate: true,
    });
  }
  return { deltas, lowerOnlyRows, coverage, verify };
}
