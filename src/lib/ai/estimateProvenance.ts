// Fix 1: classify two uploaded estimates by evidence/provenance instead of assuming a binary
// shop-vs-carrier split. Two estimates that share an RO number, workfile ID, or "Written By"
// are the SAME source (one shop, one job) — an original and a later supplement — ordered by
// estimate date. Only a genuinely insurer-authored estimate should ever be labeled "carrier".

export type EstimateProvenance = {
  roNumber: string | null;
  workfileId: string | null;
  writtenBy: string | null;
  dateMs: number | null;
};

function normalizeId(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return compact.length >= 3 ? compact : null;
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  const ms = new Date(year, month - 1, day).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** O/I/L read for 0/1 by OCR; folded on both sides so one workfile never compares as two. */
function foldOcrDigits(value: string | null): string | null {
  return value ? value.replace(/O/g, "0").replace(/[IL]/g, "1") : null;
}

const WORKFILE_LABEL = /\bworkfile[ \t]*(?:id|#|no\.?|number)?[ \t]*[:#]?/i;
/** A line that is only a label ("Federal ID:"), the shape of a labels-then-values block. */
const LABEL_ONLY_LINE = /^[ \t]*[A-Za-z][A-Za-z .#/'()-]{0,40}:[ \t]*$/;
/** A workfile ID carries a digit, so a label word ("Federal") is never one. */
const WORKFILE_VALUE = /^[ \t]*([A-Za-z0-9-]*\d[A-Za-z0-9-]*)(?=[ \t]|$)/;

/**
 * The workfile ID a print states, as printed; null when none. Reads the
 * three layouts CCC text layers produce: inline ("Workfile ID: 613bea70"),
 * value on the next line, and a block of labels followed by their values in
 * the same order ("Workfile ID:\nFederal ID:\n613bea70\n12-3456789").
 */
export function readPrintedWorkfileId(text: string): string | null {
  const lines = (text ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const label = lines[i].match(WORKFILE_LABEL);
    if (!label || label.index === undefined) continue;
    const inline = lines[i].slice(label.index + label[0].length).match(WORKFILE_VALUE)?.[1];
    if (inline) return inline;
    if (!LABEL_ONLY_LINE.test(lines[i])) continue;
    // Labels-then-values: count the label lines around this one; the value
    // sits at the same offset in the run of lines that follows the block.
    let start = i;
    while (start > 0 && LABEL_ONLY_LINE.test(lines[start - 1])) start -= 1;
    let end = i + 1;
    while (end < lines.length && LABEL_ONLY_LINE.test(lines[end])) end += 1;
    const value = lines[end + (i - start)]?.match(WORKFILE_VALUE)?.[1];
    if (value) return value;
  }
  return null;
}

export function extractEstimateProvenance(text: string): EstimateProvenance {
  const source = text ?? "";
  // [ \t], never \s, between a label and its value: \s crosses the newline in
  // a labels-then-values layout and reads the next label word as the value.
  const roNumber = normalizeId(
    source.match(/\b(?:repair[ \t]*order|r\.?o\.?)[ \t]*(?:#|no\.?|number|id)?[ \t]*[:#]?[ \t]*([A-Za-z0-9-]*\d[A-Za-z0-9-]*)/i)?.[1]
  );
  const workfileId = foldOcrDigits(normalizeId(readPrintedWorkfileId(source)));
  const writtenBy = source
    .match(/\bwritten[ \t]+by[ \t]*[:#]?[ \t]*([A-Za-z][A-Za-z .,'-]{2,40})/i)?.[1]
    ?.replace(/\s+/g, " ")
    .trim()
    .toLowerCase() ?? null;
  const dateMs =
    parseDateMs(source.match(/\b(?:estimate\s+date|date\s+of\s+estimate|date)\s*[:#]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)?.[1]) ??
    parseDateMs(source.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1]);

  return { roNumber, workfileId, writtenBy, dateMs };
}

// Two estimates are the same source when they share an RO number or workfile ID, or when the
// same person wrote both (and nothing contradicts it). This is what distinguishes an
// original + supplement pair from two independently-authored estimates.
export function isSameSourceEstimatePair(a: EstimateProvenance, b: EstimateProvenance): boolean {
  const sameRo = Boolean(a.roNumber && b.roNumber && a.roNumber === b.roNumber);
  const sameWorkfile = Boolean(a.workfileId && b.workfileId && a.workfileId === b.workfileId);
  const sameWriter = Boolean(a.writtenBy && b.writtenBy && a.writtenBy === b.writtenBy);
  // RO or workfile match is decisive; writer match alone corroborates when no IDs conflict.
  if (sameRo || sameWorkfile) return true;
  const roConflict = Boolean(a.roNumber && b.roNumber && a.roNumber !== b.roNumber);
  const workfileConflict = Boolean(a.workfileId && b.workfileId && a.workfileId !== b.workfileId);
  return sameWriter && !roConflict && !workfileConflict;
}

export type EstimateVersionInput = { text: string; filename: string };
export type EstimateVersionResult = {
  older: EstimateVersionInput & { label: string };
  newer: EstimateVersionInput & { label: string };
  sameSource: boolean;
};

// Order two estimates oldest-first by estimate date and assign neutral version labels. When the
// pair is same-source, they are an original + supplement, never shop vs carrier.
export function resolveEstimateVersionLabels(
  a: EstimateVersionInput,
  b: EstimateVersionInput,
  fallbackLabel: (input: EstimateVersionInput, defaultLabel: string) => string
): EstimateVersionResult {
  const provA = extractEstimateProvenance(a.text);
  const provB = extractEstimateProvenance(b.text);
  const sameSource = isSameSourceEstimatePair(provA, provB);

  let older = a;
  let newer = b;
  if (provA.dateMs !== null && provB.dateMs !== null && provA.dateMs !== provB.dateMs) {
    if (provA.dateMs > provB.dateMs) {
      older = b;
      newer = a;
    }
  }

  return {
    older: {
      ...older,
      label: sameSource ? "Original estimate" : fallbackLabel(older, "Estimate 1"),
    },
    newer: {
      ...newer,
      label: sameSource ? "Supplement" : fallbackLabel(newer, "Estimate 2"),
    },
    sameSource,
  };
}
