import { resolveStateFromZip } from "@/lib/policyLegal/stateFromZip";

// Owner/insured ZIP extraction for the market preview stage.
//
// A 5-digit token is only a ZIP candidate when it carries address context:
// either it directly follows a US state abbreviation ("DEVON, PA 19333") or it
// sits on a line that reads like an address ("Address: 123 Lancaster Ave").
// Bare numbers never qualify — RO/claim/estimate numbers routinely fall inside
// valid ZIP ranges (RO 22047 resolves to VA) and must not be mistaken for the
// owner's location.

const US_STATE_ABBREVIATIONS = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA",
  "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS",
  "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY",
]);

// Identifier labels that disqualify the number that follows them, regardless of
// any other context ("RO 22047", "Claim #: 19333", "Workfile ID: 22047").
const ID_LABEL_BEFORE_TOKEN =
  /\b(?:r\.?\s*o\.?|repair\s+order|work\s*file|claim|estimate|supplement|policy|job|invoice|stock|control|ref(?:erence)?|file)\s*(?:number|no\.?|num|id)?\s*[:#]*\s*$/i;

// Labeled identifier values collected across the document; these values need
// the strongest context (adjacent state abbreviation) to count as a ZIP.
const ID_LABEL_VALUE_PATTERN =
  /\b(?:r\.?\s*o\.?|repair\s+order|work\s*file|claim|estimate|supplement|policy|job|invoice)\s*(?:number|no\.?|num|id)?\s*[:#]*\s*(\d{5})\b/gi;

const ADDRESS_LINE_CONTEXT =
  /\b(?:address|zip|postal|city|state|p\.?o\.?\s*box|street|st|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|pl|place|cir|circle|hwy|highway|pike|pkwy|parkway|way|ter|terrace|trl|trail|suite|ste|apt|unit)\b/i;

const CITY_STATE_ZIP_PATTERN =
  /\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/;

function collectLabeledIdentifierValues(text: string): Set<string> {
  const values = new Set<string>();
  for (const match of text.matchAll(ID_LABEL_VALUE_PATTERN)) {
    values.add(match[1]);
  }
  return values;
}

function adjacentStateBefore(text: string, index: number): string | undefined {
  const before = text.slice(Math.max(0, index - 12), index);
  const state = before.match(/(?:^|[\s,.(])([A-Z]{2})[.,]?\s+$/)?.[1];
  return state && US_STATE_ABBREVIATIONS.has(state) ? state : undefined;
}

function isOnAddressLine(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const lineEnd = text.indexOf("\n", index);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  return ADDRESS_LINE_CONTEXT.test(line);
}

export function selectOwnerOrInsuredZip(text: string): string | undefined {
  const identifierValues = collectLabeledIdentifierValues(text);
  const candidates: Array<{ zip: string; score: number; index: number }> = [];
  const regex = /\b\d{5}(?:-\d{4})?\b/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const zip = match[0].slice(0, 5);
    if (!resolveStateFromZip(zip)) continue;
    const index = match.index;

    const before = text.slice(Math.max(0, index - 32), index);
    if (ID_LABEL_BEFORE_TOKEN.test(before)) continue;

    const adjacentState = adjacentStateBefore(text, index);
    // A value that also appears as a labeled RO/claim/estimate number is only
    // trusted when it directly follows a state abbreviation.
    if (identifierValues.has(zip) && !adjacentState) continue;
    if (!adjacentState && !isOnAddressLine(text, index)) continue;

    const context = text.slice(Math.max(0, index - 180), Math.min(text.length, index + 180)).toLowerCase();
    let score = 10;
    if (adjacentState) score += 25;
    if (/\b(owner|insured|claimant|customer|vehicle owner|policyholder)\b/.test(context)) score += 100;
    if (/\b(repair facility|repair shop|body shop|collision center|appraiser|estimator|supplement|facility)\b/.test(context)) score -= 75;
    if (/\b(zip|postal|address|city|state)\b/.test(context)) score += 10;
    candidates.push({ zip, score, index });
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  return candidates[0]?.zip;
}

export function extractMarketPreviewState(text: string, zip?: string): string | undefined {
  if (zip) {
    const fromZip = resolveStateFromZip(zip);
    if (fromZip) return fromZip;
  }

  return text.match(CITY_STATE_ZIP_PATTERN)?.[1];
}
