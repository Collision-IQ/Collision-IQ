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
