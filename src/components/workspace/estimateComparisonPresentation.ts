import type {
  EstimateComparisonRow,
  WorkspaceEstimateComparisons,
} from "@/types/workspaceTypes";
import { normalizeWorkspaceEstimateComparisons } from "@/lib/workspace/estimateComparisons";
import {
  normalizeEstimateOperationLabel,
  sanitizeEstimateLine,
} from "@/lib/ui/presentationText";

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
    .filter(rowHasUsableEstimateLabel)
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
      .map((note) => sanitizeComparisonNote(note, row))
      .filter((note): note is string => Boolean(note))
      .map((note) => {
        const duplicateOf = seenNotes.find((existing) => notesLookDuplicated(existing, note));
        if (!duplicateOf) {
          seenNotes.push(note);
          return note;
        }

        return `Related estimate rationale: ${shortenComparisonNote(note)}`;
      });

    return notes.join(" ") === row.notes.join(" ") ? row : { ...row, notes };
  });
}

export function getEstimateComparisonLabel(row: EstimateComparisonRow): string {
  return normalizeEstimateOperationLabel({
    operation: row.operation,
    partName: row.partName,
    category: row.category,
  }) || "Comparison";
}

export function formatEstimateComparisonValue(
  value: string | number | null | undefined
): string {
  if (value === null || value === undefined || `${value}`.trim() === "") {
    return "Not shown";
  }

  if (typeof value === "number") return `${value}`;

  const cleaned = sanitizeComparisonDisplayText(value);
  return cleaned || "Not shown";
}

export function formatEstimateComparisonDelta(row: EstimateComparisonRow): string {
  if (typeof row.delta === "number") {
    const lhs = formatEstimateComparisonValue(row.lhsValue);
    const rhs = formatEstimateComparisonValue(row.rhsValue);
    return `${lhs} → ${rhs} (${row.delta > 0 ? "+" : ""}${row.delta})`;
  }

  if (row.delta) {
    return row.delta.replace(/!['’]/g, "→").replace(/\s*->\s*/g, " → ");
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

function sanitizeComparisonNote(value: string, row: EstimateComparisonRow): string | null {
  let cleaned = sanitizeComparisonDisplayText(value);
  if (!cleaned) return null;

  cleaned = removeDuplicatedLeadingTitle(cleaned, getEstimateComparisonLabel(row));
  cleaned = shortenComparisonNote(cleaned);
  return cleaned ? cleaned : null;
}

function sanitizeComparisonDisplayText(value: string): string {
  let cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  cleaned = removeInternalEvidenceReferences(cleaned);
  cleaned = removeRepeatedUploadedDocumentNoise(cleaned);
  cleaned = removeInternalEvidenceIds(cleaned);
  cleaned = cleaned
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned || isInternalOnlyEvidenceText(cleaned)) return "";
  return cleaned;
}

function removeInternalEvidenceReferences(value: string): string {
  return value
    .replace(/\bEvidence references?:\s*(?:[,; ]*(?:cmp[a-z0-9-]{6,}|[a-f0-9]{24,}|[a-f0-9-]{32,}))+\.?/gi, "")
    .replace(/\bEvidence references?:\s*\.?/gi, "");
}

function removeRepeatedUploadedDocumentNoise(value: string): string {
  return value
    .replace(/\buploaded document:\s*(?:uploaded document\s*,?\s*){2,}/gi, "supporting evidence: ")
    .replace(/\b(?:uploaded document\s*,\s*){2,}uploaded document\b/gi, "supporting evidence")
    .replace(/\buploaded document\b/gi, "supporting evidence");
}

function removeInternalEvidenceIds(value: string): string {
  return value.replace(/\b(?:cmp[a-z0-9-]{6,}|[a-f0-9]{24,}|[a-f0-9]{8}-[a-f0-9-]{27,})\b/gi, "");
}

function removeDuplicatedLeadingTitle(value: string, title: string): string {
  const cleanedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").trim();
  if (!cleanedTitle) return value;

  return value
    .replace(new RegExp(`^(${cleanedTitle})\\s+\\1\\s*:?\\s*`, "i"), "$1: ")
    .replace(new RegExp(`^(${cleanedTitle})\\s*:\\s*\\1\\s*:?\\s*`, "i"), "$1: ")
    .trim();
}

function isInternalOnlyEvidenceText(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^\w\s/-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return true;

  return /^(?:evidence references?|supporting evidence|current file evidence|source references?)$/i.test(normalized);
}

function shortenComparisonNote(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 500) {
    return cleaned;
  }

  const truncated = cleaned.slice(0, 500);
  const sentenceEnd = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("!"),
    truncated.lastIndexOf("?")
  );
  return sentenceEnd > 120 ? truncated.slice(0, sentenceEnd + 1).trim() : `${truncated.trimEnd()}.`;
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
  const label = normalizeEstimateOperationLabel({
    operation: row.operation,
    partName: row.partName,
    category: row.category,
  });

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

function rowHasUsableEstimateLabel(row: EstimateComparisonRow): boolean {
  const candidates = [row.operation, row.partName, row.category].filter(Boolean) as string[];
  if (candidates.length === 0) return true;
  return candidates.some((value) => {
    const sanitized = sanitizeEstimateLine(value);
    return !sanitized.malformed || !sanitized.hideFromCustomer;
  });
}

function toSentenceCase(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function cleanOperationDisplayText(value?: string | null): string {
  if (!value) return "";
  const sanitized = sanitizeEstimateLine(value);
  if (sanitized.malformed) return sanitized.hideFromCustomer ? "" : sanitized.cleaned;
<<<<<<< HEAD

  const cleaned = sanitizeComparisonDisplayText(value)
    .replace(/([A-Za-z)])\d(\d\.\d)\b/g, "$1 $2")
    .replace(/([A-Za-z])(\d{2,}(?:\.\d{2})?)(Incl\.?|Included)\b/gi, "$1 $2 $3")
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
=======
  return normalizeEstimateOperationLabel(value);
>>>>>>> 29d8ddc (Normalize estimate delta and scrubber operation labels)
}
