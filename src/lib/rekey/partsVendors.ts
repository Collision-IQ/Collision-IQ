/**
 * Parts-vendors harvest (WO-RK1 §3.1, open decision 2 — default yes).
 *
 * CCC asks for a vendor when a non-OEM part is keyed, and the source estimate
 * prints them on its own parts-vendors pages. Those pages are NOT a line
 * source — nothing here creates, prices or scopes a row. They are read only to
 * attach a vendor NAME to a row that already exists.
 *
 * Two things keep this from becoming invention:
 *
 * 1. A vendor is attached only on an EXACT part-number join. A row whose part
 *    number appears nowhere on the vendors pages keeps `vendor: null`. Guessing
 *    a vendor from proximity would put a supplier's name against a part they
 *    never quoted.
 *
 * 2. The region is also returned VERBATIM, so the sheet can print what the
 *    source actually said next to whatever was joined. Every attachment is
 *    therefore checkable against the page it came from.
 *
 * Both printed layouts are handled by shape, not by producer: a table whose
 * vendor column follows the part number, and a grouped list under a vendor
 * heading. Neither is assumed — the tail is used when there is one, and the
 * heading above only when there is not.
 */

import { looksLikePartNumber } from "@/lib/reports/deltaEngine/estimateNormalize";
import { normalizeOverprintText } from "@/lib/reports/overprintNormalize";

/** Opens a parts-vendors region. */
const VENDORS_HEADING = /^parts?\s*(?:&|and)?\s*vendors?\b|^vendor\s+(?:list|information)\b/i;
/** Ends one: the next block that is certainly not vendor content. */
const REGION_END = /^(?:estimate\s+totals|supplement\s+summary|delta\s+report|estimate\s+recap)\b/i;
/** A column-header row, not a vendor name. Needs TWO column words so a real
 *  vendor name carrying one of them ("… PARTS INC") is never mistaken for it. */
const COLUMN_WORDS = /\b(line|ln|description|desc|part|parts|number|no|vendor|supplier|qty|quantity|price|cost|amount|status)\b/gi;
/** Money, a bare small integer (qty / line number), and a percentage. */
const VALUE_TOKEN = /^(?:\$?[\d,]+\.\d{2}|\d{1,3}|\d{1,3}(?:\.\d+)?%)$/;
/** Money or an hours cell — the columns an ESTIMATE line carries and a
 *  vendors listing does not. */
const CARRIES_ESTIMATE_VALUES = /\$\s?[\d,]+\.\d{2}|(?:^|\s)\d{1,3}\.\d(?:\s|$)/;
/** Below this a "line" is too short to identify anything by text. */
const MIN_SIGNATURE_LENGTH = 12;

export interface PartsVendorsIndex {
  /** The vendors pages exactly as printed, for the estimator to check against. */
  lines: string[];
  /** Whitespace-stripped, upper-cased part number -> vendor name. */
  byPartNumber: Map<string, string>;
  /**
   * Normalized text of every region line, so the ledger can drop a parsed row
   * that came OFF these pages. WO-RK1 §3.1: the vendors pages are not a line
   * source, and a listing that repeats a part number would otherwise reach the
   * sheet as a second keying row for work that is already on it.
   */
  signatures: Set<string>;
}

/** Case-folded, whitespace-collapsed, for text joins between the two passes. */
export function vendorLineSignature(value: string): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

function isColumnHeader(line: string): boolean {
  const matches = line.match(COLUMN_WORDS);
  return (matches?.length ?? 0) >= 2 && !/\d{4,}/.test(line);
}

/** A line that names a vendor and nothing else — the heading of a grouped list. */
function isVendorHeading(line: string): boolean {
  if (isColumnHeader(line)) return false;
  if ((line.match(/[A-Za-z]/g)?.length ?? 0) < 3) return false;
  if (/^(?:phone|fax|tel|email|e-mail|contact|address|attn)\b/i.test(line)) return false;
  return !line.split(/\s+/).some((token) => looksLikePartNumber(token));
}

function cleanVendorName(value: string): string | null {
  const cleaned = value
    .split(/\s+/)
    .filter((token) => !VALUE_TOKEN.test(token))
    .join(" ")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9).]+$/, "")
    .trim();
  if (cleaned.length < 3) return null;
  if ((cleaned.match(/[A-Za-z]/g)?.length ?? 0) < 2) return null;
  return cleaned;
}

export function harvestPartsVendors(text: string): PartsVendorsIndex {
  const index: PartsVendorsIndex = { lines: [], byPartNumber: new Map(), signatures: new Set() };
  if (!text) return index;

  const lines = normalizeOverprintText(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim());

  let inRegion = false;
  let heading: string | null = null;
  for (const line of lines) {
    if (!line) continue;
    if (VENDORS_HEADING.test(line)) {
      inRegion = true;
      heading = null;
      index.lines.push(line);
      continue;
    }
    if (!inRegion) continue;
    if (REGION_END.test(line)) {
      inRegion = false;
      heading = null;
      continue;
    }
    index.lines.push(line);
    if (line.length >= MIN_SIGNATURE_LENGTH) index.signatures.add(vendorLineSignature(line));

    const tokens = line.split(/\s+/);
    // The LAST part-number-shaped token: the vendor column follows the part
    // number, so anything after the last one is the vendor.
    let partIndex = -1;
    for (let position = tokens.length - 1; position >= 0; position -= 1) {
      if (looksLikePartNumber(tokens[position])) {
        partIndex = position;
        break;
      }
    }

    if (partIndex === -1) {
      if (isVendorHeading(line)) heading = line;
      continue;
    }

    const partNumber = tokens[partIndex].replace(/[.,]$/, "").replace(/\s+/g, "").toUpperCase();
    const tail = cleanVendorName(tokens.slice(partIndex + 1).join(" "));

    // The heading fallback is only safe on a line that carries no estimate
    // value columns. Where a region runs longer than the vendors pages
    // themselves — the heading that opens them is unambiguous, the one that
    // closes them is not — a real estimate line can fall inside it, and
    // attaching the last-seen supplier to it would invent a quote that page
    // never made. Such a line has hours or money; a vendors listing does not.
    const vendor = tail ?? (CARRIES_ESTIMATE_VALUES.test(line) ? null : heading);
    if (!vendor) continue;
    if (!index.byPartNumber.has(partNumber)) index.byPartNumber.set(partNumber, vendor);
  }

  return index;
}
