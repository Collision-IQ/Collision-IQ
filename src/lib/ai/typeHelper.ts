// Type Helper ("Fix typos") — pure logic for the chat-composer spell/typo
// assistant. Corrects the user's UNSENT draft only; it never touches estimate
// data, uploaded documents, reports, citations, or MOTOR sandbox logic.

export const TYPE_HELPER_MAX_CHARS = 6000;

export const TYPE_HELPER_SYSTEM_PROMPT = [
  "You are a spelling and typing assistant for a collision repair/insurance app.",
  "Correct typos, punctuation, grammar, capitalization, duplicated words, and minor clarity issues only.",
  "Preserve all technical terms, VINs, claim numbers, estimate line numbers, money amounts, labor hours,",
  "part numbers, acronyms (RTA, DV, ADAS, OEM, LKQ, R&I, R&R, CCC, MOTOR, DEG, SCRS), insurer/shop/OEM names,",
  "vehicle year/make/model, legal/appraisal terminology, and the user's intent exactly as written.",
  "Do not add new facts. Do not answer the message. Return only the corrected text with no preamble,",
  "no quotes, and no code fences.",
].join(" ");

// Acronyms that must survive correction byte-for-byte.
const PROTECTED_ACRONYMS = ["RTA", "DV", "ADAS", "OEM", "LKQ", "R&I", "R&R", "CCC", "MOTOR", "DEG", "SCRS"] as const;

/**
 * Extract the strings that must appear unchanged in the corrected draft:
 * VINs, dollar amounts, labor hours, any bare numbers (line numbers, years),
 * part/claim-style alphanumeric tokens, and protected acronyms.
 */
export function extractProtectedTokens(text: string): string[] {
  const tokens = new Set<string>();
  const collect = (re: RegExp) => {
    for (const match of text.matchAll(re)) {
      if (match[0]) tokens.add(match[0]);
    }
  };

  // VIN-shaped tokens (17 chars, no I/O/Q).
  collect(/\b[A-HJ-NPR-Z0-9]{17}\b/g);
  // Dollar amounts.
  collect(/\$\s?\d[\d,]*(?:\.\d+)?/g);
  // Labor hours with units.
  collect(/\b\d+(?:\.\d+)?\s?(?:hrs?|hours?)\b/gi);
  // Part/claim-style tokens: mixed letters+digits, length >= 5.
  collect(/\b(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9-]{4,}\b/g);
  // Dashed numeric identifiers (claim numbers like 22-04871).
  collect(/\b\d+(?:-\d+)+\b/g);
  // Any bare number (estimate line numbers, years, quantities, hours).
  collect(/\b\d+(?:\.\d+)?\b/g);

  for (const acronym of PROTECTED_ACRONYMS) {
    const re = new RegExp(`(?<![A-Za-z0-9&])${acronym.replace(/&/g, "\\&")}(?![A-Za-z0-9&])`, "g");
    if (re.test(text)) tokens.add(acronym);
  }

  return [...tokens];
}

/** True when every protected token from the original survives in the corrected text. */
export function protectedTokensPreserved(original: string, corrected: string): boolean {
  return extractProtectedTokens(original).every((token) => corrected.includes(token));
}

/** Strip accidental wrapping (code fences / surrounding quotes) from model output. */
export function normalizeCorrectedText(raw: string): string {
  let text = raw.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(text);
  if (fence) text = fence[1].trim();
  if (text.length >= 2 && /^["'“]/.test(text) && /["'”]$/.test(text)) {
    const inner = text.slice(1, -1);
    // Only unquote when the original wasn't itself quoted content.
    if (!inner.includes('"')) text = inner;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Inline typo underlining: word-level diff between the draft and the corrected
// text. Only clean 1:1 word substitutions become spans (typos); insertions,
// deletions, and large rewrites are ignored so we never underline half the box.
// ---------------------------------------------------------------------------

export type TypoSpan = {
  /** Character offsets into the ORIGINAL draft. */
  start: number;
  end: number;
  original: string;
  suggestion: string;
};

type DiffToken = { text: string; start: number; end: number };

function tokenizeWithOffsets(text: string): DiffToken[] {
  return Array.from(text.matchAll(/\S+/g), (match) => ({
    text: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

export function diffTypoSpans(original: string, corrected: string, maxSpans = 24): TypoSpan[] {
  if (!original || !corrected || original === corrected) return [];
  const a = tokenizeWithOffsets(original);
  const b = tokenizeWithOffsets(corrected);
  if (a.length === 0 || b.length === 0 || a.length > 600 || b.length > 600) return [];

  // LCS table over exact token text.
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i].text === b[j].text
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const spans: TypoSpan[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].text === b[j].text) {
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j + 1] === dp[i][j]) {
      // Pairing both mismatched tokens is optimal → 1:1 substitution (a typo).
      spans.push({ start: a[i].start, end: a[i].end, original: a[i].text, suggestion: b[j].text });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1; // deletion — not underlined
    } else {
      j += 1; // insertion — not underlined
    }
  }

  // A flood of substitutions means a rewrite, not typo fixes — show nothing.
  if (spans.length > maxSpans) return [];
  return spans;
}

export type TypeHelperClientResult =
  | { status: "empty" }
  | { status: "unchanged" }
  | { status: "fixed"; correctedText: string }
  | { status: "error" };

type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/**
 * Client-side "Fix typos" request. Never called on keystrokes — only on click.
 * Empty drafts never hit the network; failures leave the draft untouched.
 * Never sends the message.
 */
export async function requestTypoFix(
  draft: string,
  fetcher: FetchLike = fetch
): Promise<TypeHelperClientResult> {
  if (!draft.trim()) {
    return { status: "empty" };
  }

  try {
    const res = await fetcher("/api/type-helper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: draft }),
    });
    if (!res.ok) {
      return { status: "error" };
    }
    const data = (await res.json()) as { correctedText?: unknown } | null;
    const correctedText = typeof data?.correctedText === "string" ? data.correctedText : "";
    if (!correctedText || correctedText === draft) {
      return { status: "unchanged" };
    }
    return { status: "fixed", correctedText };
  } catch {
    return { status: "error" };
  }
}
