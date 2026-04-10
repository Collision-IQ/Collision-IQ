import type {
  EstimateComparisonRow,
  WorkspaceEstimateComparisons,
} from "@/types/workspaceTypes";
import { normalizeWorkspaceEstimateComparisons } from "@/lib/workspace/estimateComparisons";

export function getEstimateComparisonRows(
  estimateComparisons?: WorkspaceEstimateComparisons | null
): EstimateComparisonRow[] {
  return normalizeWorkspaceEstimateComparisons(estimateComparisons).rows;
}

export function getDedupedEstimateComparisonRows(
  estimateComparisons?: WorkspaceEstimateComparisons | null
): EstimateComparisonRow[] {
  return dedupeEstimateComparisonRationales(getEstimateComparisonRows(estimateComparisons));
}

export function getTopEstimateComparisonHighlights(
  rows: EstimateComparisonRow[],
  limit = 5
): string[] {
  const seen = new Set<string>();

  return prioritizeEstimateComparisonRows(dedupeEstimateComparisonRationales(rows))
    .filter((row) => row.deltaType !== "same")
    .map((row) => summarizeEstimateComparisonRow(row))
    .filter((summary): summary is string => Boolean(summary))
    .filter((summary) => {
      const normalized = summary.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    })
    .slice(0, limit);
}

export function dedupeEstimateComparisonRationales(
  rows: EstimateComparisonRow[]
): EstimateComparisonRow[] {
  const seenNotes: string[] = [];

  return rows.map((row) => {
    if (!row.notes?.length) {
      return row;
    }

    const notes = row.notes
      .map((note) => sanitizeComparisonNote(note))
      .filter((note): note is string => Boolean(note))
      .map((note) => {
        const duplicateOf = seenNotes.find((existing) => notesLookDuplicated(existing, note));
        if (!duplicateOf) {
          seenNotes.push(note);
          return note;
        }

        return `Same rationale as earlier: ${shortenComparisonNote(note)}`;
      });

    return notes.join(" ") === row.notes.join(" ") ? row : { ...row, notes };
  });
}

export function getEstimateComparisonLabel(row: EstimateComparisonRow): string {
  return (
    cleanOperationDisplayText(row.operation) ||
    cleanOperationDisplayText(row.partName) ||
    cleanOperationDisplayText(row.category) ||
    "Comparison"
  );
}

export function formatEstimateComparisonValue(
  value: string | number | null | undefined
): string {
  if (value === null || value === undefined || `${value}`.trim() === "") {
    return "Not shown";
  }

  return typeof value === "number" ? `${value}` : value;
}

export function formatEstimateComparisonDelta(row: EstimateComparisonRow): string {
  if (typeof row.delta === "number") {
    return `${row.delta > 0 ? "+" : ""}${row.delta}`;
  }

  if (row.delta) {
    return row.delta;
  }

  switch (row.deltaType) {
    case "added":
      return "Only in shop estimate";
    case "removed":
      return "Only in carrier estimate";
    case "same":
      return "Aligned";
    case "changed":
      return "Changed";
    default:
      return "Unknown";
  }
}

function sanitizeComparisonNote(value: string): string | null {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned : null;
}

function shortenComparisonNote(value: string): string {
  const firstSentence = value.split(/(?<=[.!?])\s+/)[0] || value;
  if (firstSentence.length <= 96) {
    return firstSentence;
  }
  return `${firstSentence.slice(0, 93).trimEnd()}...`;
}

function notesLookDuplicated(left: string, right: string): boolean {
  const normalizedLeft = normalizeComparisonNote(left);
  const normalizedRight = normalizeComparisonNote(right);

  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  return (
    normalizedLeft.length > 48 &&
    normalizedRight.length > 48 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  );
}

function normalizeComparisonNote(value: string): string {
  return value
    .toLowerCase()
    .replace(/^same rationale as earlier:\s*/i, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function prioritizeEstimateComparisonRows(rows: EstimateComparisonRow[]): EstimateComparisonRow[] {
  return [...rows].sort((left, right) => scoreEstimateComparisonRow(right) - scoreEstimateComparisonRow(left));
}

function scoreEstimateComparisonRow(row: EstimateComparisonRow): number {
  const text = `${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""} ${row.notes?.join(" ") ?? ""}`
    .toLowerCase();

  let score = 0;

  if (row.deltaType === "added") score += 5;
  if (row.deltaType === "removed") score += 4;
  if (row.deltaType === "changed") score += 3;

  if (/structural|measure|rail|pillar|apron|support/.test(text)) score += 6;
  if (/calibration|scan|adas|sensor|camera|radar/.test(text)) score += 5;
  if (/pre.?paint|test fit|fit\b/.test(text)) score += 5;
  if (/paint|refinish|blend/.test(text)) score += 4;
  if (/labor|hour/.test(text)) score += 3;
  if (/missing|not clearly carried|not shown|omitted|under.?documented/.test(text)) score += 2;

  if (typeof row.delta === "number") {
    score += Math.min(Math.abs(row.delta), 6);
  }

  return score;
}

function summarizeEstimateComparisonRow(row: EstimateComparisonRow): string | null {
  const label =
    cleanOperationDisplayText(row.operation) ||
    cleanOperationDisplayText(row.partName) ||
    cleanOperationDisplayText(row.category);

  const combinedText = `${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""} ${row.notes?.join(" ") ?? ""}`
    .toLowerCase();

  if (!label && !combinedText.trim()) {
    return null;
  }

  if (/structural|measure|measurement|rail|pillar|apron|support/.test(combinedText)) {
    return `${toSentenceCase(label || "Structural operations")} missing on carrier side`;
  }

  if (/pre.?paint|test fit/.test(combinedText)) {
    return `${toSentenceCase(label || "Pre-paint test fit")} not supported on carrier side`;
  }

  if (/paint|refinish|blend/.test(combinedText) && (row.deltaType === "changed" || typeof row.delta === "number")) {
    return `${toSentenceCase(label || "Refinish hours")} significantly reduced`;
  }

  if (/calibration|scan|adas|sensor|camera|radar/.test(combinedText)) {
    return `${toSentenceCase(label || "Calibration path")} under-documented`;
  }

  if (row.deltaType === "added") {
    return `${toSentenceCase(label || "Key operations")} missing on carrier side`;
  }

  if (row.deltaType === "removed") {
    return `${toSentenceCase(label || "Carrier-only operation")} appears only on the carrier side`;
  }

  if (row.deltaType === "changed") {
    return `${toSentenceCase(label || "Key operation")} materially differs across estimates`;
  }

  return label ? toSentenceCase(label) : null;
}

function toSentenceCase(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function cleanOperationDisplayText(value?: string | null): string {
  if (!value) return "";

  const cleaned = value
    .replace(/^\s*#?\s*\d+\s+/i, "")
    .replace(/^\s*(?:proc|procedure|r&i|repl|rpr|blnd|subl|algn)\s+/i, "")
    .replace(/\b([a-z]{3,})\d[\d.]{5,}\b/gi, "$1")
    .replace(/\b[a-z]*\d[a-z\d.]{8,}\b/gi, (token) =>
      looksLikeCodeHeavyToken(token) ? "" : token
    )
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) return "";
  if (/^(?:proc|procedure)$/i.test(cleaned)) return "";

  const compact = cleaned.replace(/\s+/g, "");
  const attachedCodeMatch = compact.match(/^([a-z][a-z\s/&-]{2,}?)(\d[\d.]{5,})$/i);
  if (attachedCodeMatch?.[1]) {
    return attachedCodeMatch[1].trim();
  }

  return cleaned;
}

function looksLikeCodeHeavyToken(value: string): boolean {
  const digitCount = (value.match(/\d/g) ?? []).length;
  const alphaCount = (value.match(/[a-z]/gi) ?? []).length;
  return digitCount >= 5 && digitCount > alphaCount * 2;
}
