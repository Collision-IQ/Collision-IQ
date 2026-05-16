export type NarrativeNormalizationMode =
  | "UMPIRING"
  | "CUSTOMER_SUMMARY"
  | "REPORT"
  | "SNAPSHOT"
  | "CHAT_EXPORT";

const SECTION_LABEL_PATTERN =
  /\b(Appraisal Recommendation|Award Posture|Recommendation|Rationale|Why the selected posture is better supported|Why this posture is better supported|Vulnerabilities|Specific line\/item vulnerabilities|Unresolved Evidence|What remains not final-award confidence|Final Posture|Whether final award is ready or deferred)\s*:\s*/gi;

const MARKDOWN_SECTION_PATTERN =
  /(\*\*(?:Appraisal Recommendation|Award Posture|Why the selected posture is better supported|What remains not final-award confidence|Specific line\/item vulnerabilities|Whether final award is ready or deferred|Recommendation|Rationale|Vulnerabilities|Unresolved Evidence|Final Posture)\*\*)/gi;

const SENTENCE_STARTERS =
  /\b(Based on|Because|However|Therefore|This means|The carrier|The shop|The reviewed file|Final award|Support remains|Unresolved evidence|Carrier vulnerabilities|Shop vulnerabilities|Safety\/OEM\/completion support)\b/g;

const REPAIR_OPERATION_PHRASES = [
  "quarter replacement path",
  "rear bumper replacement/overhaul",
  "rear bumper replacement",
  "rear bumper overhaul",
  "tail lamp pocket",
  "fuel pocket",
  "blind spot radar replacement",
  "blind spot radar",
  "related calibration activity",
  "calibration activity",
  "post-repair scan",
  "pre-repair scan",
  "structural verification",
  "structural measurement",
  "alignment verification",
  "alignment printout",
  "test-fit verification",
  "road-test verification",
  "corrosion protection",
  "cavity protection",
  "bumper cover overhaul",
  "tail lamp replacement",
].sort((left, right) => right.length - left.length);

export function normalizeNarrativeProse(
  value: string | null | undefined,
  mode: NarrativeNormalizationMode = "REPORT"
): string {
  const original = value ?? "";
  if (!original.trim()) return "";

  const protectedLines = original
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeLine(line, mode));

  return protectedLines
    .join("\n")
    .replace(MARKDOWN_SECTION_PATTERN, "\n\n$1\n")
    .replace(SECTION_LABEL_PATTERN, "\n\n$1:\n")
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n{2,}/)
    .map((paragraph) => normalizeParagraph(paragraph, mode))
    .filter(Boolean)
    .join("\n\n")
    .replace(/^(Appraisal Recommendation|Award Posture|Recommendation|Rationale|Why the selected posture is better supported|Why this posture is better supported|Vulnerabilities|Specific line\/item vulnerabilities|Unresolved Evidence|What remains not final-award confidence|Final Posture|Whether final award is ready or deferred):\s+/gim, "$1:\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizeLine(line: string, mode: NarrativeNormalizationMode): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed) || /^\*\*[^*]+\*\*$/.test(trimmed)) {
    return trimmed;
  }
  return normalizeParagraph(trimmed, mode);
}

function normalizeParagraph(paragraph: string, mode: NarrativeNormalizationMode): string {
  const trimmed = paragraph.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed) || /^\*\*[^*]+\*\*$/.test(trimmed)) {
    return trimmed;
  }

  const sentenceBoundaryText = normalizeRepairOperationChains(addSentenceBoundaries(trimmed));
  const semicolonLimited = sentenceBoundaryText
    .split(/(?<=[.!?])\s+/)
    .map(limitSemicolonClauses)
    .join(" ");

  return ensureTerminalPunctuation(semicolonLimited, mode)
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([.!?])([A-Z])/g, "$1 $2")
    .replace(/([.!?]\s+)([a-z])/g, (_match, boundary: string, letter: string) => `${boundary}${letter.toUpperCase()}`)
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeRepairOperationChains(value: string): string {
  const escaped = REPAIR_OPERATION_PHRASES.map(escapeRegExp).join("|");
  const phrasePattern = new RegExp(`\\b(?:${escaped})\\b`, "gi");
  const matches = [...value.matchAll(phrasePattern)];
  if (matches.length < 3) return value;

  const matchStarts = new Set(matches.slice(1).map((match) => match.index ?? -1));
  let operationIndex = 0;

  return value
    .replace(/\b(tail lamp pocket)\/(fuel pocket)\b/gi, "$1, $2")
    .replace(phrasePattern, (match, offset: number, full: string) => {
      operationIndex += 1;
      if (operationIndex === 1 || !matchStarts.has(offset)) return match;

      const previous = full.slice(Math.max(0, offset - 3), offset);
      if (/[,.;:\n]\s*$/.test(previous)) return match;
      return `, ${match}`;
    })
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/,\s+(and\s+)?related calibration activity\b/gi, ", and related calibration activity");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addSentenceBoundaries(value: string): string {
  return value
    .replace(/\s+-\s+(?=[A-Z][a-z])/g, ". ")
    .replace(/\s+(?=(?:Recommendation|Rationale|Vulnerabilities|Unresolved Evidence|Final Posture):)/g, "\n\n")
    .replace(SENTENCE_STARTERS, (match, _starter, offset, full) => {
      if (offset === 0) return match;
      const previous = full.slice(Math.max(0, offset - 3), offset);
      if (/[.!?\n]\s*$/.test(previous)) return match;
      if (/[:,;]\s*$/.test(previous)) return match;
      return `. ${match}`;
    })
    .replace(/\b(and|but)\s+(The carrier|The shop|The reviewed file|Final award)\b/g, "$1. $2");
}

function limitSemicolonClauses(sentence: string): string {
  let count = 0;
  return sentence.replace(/;/g, () => {
    count += 1;
    return count <= 2 ? ";" : ".";
  });
}

function ensureTerminalPunctuation(value: string, mode: NarrativeNormalizationMode): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/[:.!?]$/.test(trimmed)) return trimmed;
  if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) return trimmed;
  if (mode === "CUSTOMER_SUMMARY" && trimmed.length < 40) return trimmed;
  return `${trimmed}.`;
}
