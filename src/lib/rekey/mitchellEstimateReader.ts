/**
 * Mitchell line-item reader.
 *
 * The shared estimate reader is built for the CCC print, where a row's columns
 * survive extraction as separate tokens. The Mitchell print does not extract
 * that way at all: a row arrives as one glued run with its operation and part
 * type WRAPPED across physical lines —
 *
 *     1201423Frt Bumper Cover AssyOverhaulBody1.6#Existing
 *     4201402Frt Bumper Under CoverRemove /
 *     Install
 *     BodyINCr#Existing
 *
 * Run through the shared reader, a real Mitchell estimate yielded almost no
 * line items and filled the sheet with fragments of its own totals pages. That
 * is why this exists: the two layouts are different documents, not two dialects
 * of one.
 *
 * The rows it returns are ordinary `EstimateDeltaRow`s, so everything
 * downstream — vocabulary translation, folding, grouping, verification — is
 * the same code that serves the CCC path.
 *
 * Nothing here keys on a carrier, shop, make or repair-order literal. The
 * anchors are the platform's own printed notation: a line number followed by a
 * Mitchell operation code, and the fixed operation / labor-type / part-type
 * vocabularies already carried in data/rekeyVocabulary.json.
 */

import type { EstimateDeltaRow } from "@/lib/reports/estimateDeltaMatcher";
import { normalizeOverprintText } from "@/lib/reports/overprintNormalize";
import VOCABULARY from "./data/rekeyVocabulary.json";
import { normalizeVocabularyText, resolveLaborType, resolveSectionGroup } from "./rekeyVocabulary";

/**
 * Row anchor: an optional supplement tag ("S1", "S2" — printed on a
 * supplement of record and welded to what follows), a 1-3 digit line number,
 * then the Mitchell operation code — six digits, or the literal the platform
 * prints when a line carries no database code — and then the description's
 * first character. On a real supplement (F-RK1b) every tagged row failed the
 * untagged anchor and was joined onto the row above it, which is how a
 * ledger came to carry a whole row inside another row's part number.
 */
const ROW_ANCHOR = /^(?:(S\d)\s*)?(\d{1,3})(\d{6}|AUTO)(?=[A-Za-z$(])/;

/** Coded rows that are notes to the reader, never keying rows (RK-05). */
const NOTE_CODES = new Set((VOCABULARY.noteCodes as string[]).map((code) => code.trim()));

/** Page furniture: producer boilerplate that repeats on every printed page. */
const FURNITURE = [
  /^page\s+\d+\s+of\s+\d+$/i,
  /^printed\s+on$/i,
  /^committed\s+on$/i,
  /^version$/i,
  /^profile(\s*\(modified\))?$/i,
  /^profile\s+version$/i,
  /^parts\s+profile(\s+version)?$/i,
  /^n\/a$/i,
  /^copyright\b/i,
  /^all\s+rights\s+reserved$/i,
  /^tm$/i,
  /^\d{1,2}\/\d{1,2}\/\d{4}$/,
  /^\d{1,2}:\d{2}\s*(?:am|pm)$/i,
  /^\d{1,3}\.\d$/,
  /^line\s*#/i,
  /^\s*labor\s+part\s*$/i,
  /^oem\s+[a-z]{3}_\d{2}_v/i,
  /^mitchell\b/i,
  /^system\s+profile$/i,
  /^\*+\s*judgment\s+item/i,
];

/**
 * RK-10: the page footer is a contiguous block, "Committed On" through
 * "Page N of M", and is cut STRUCTURALLY rather than line by line. A footer
 * line that no furniture pattern anticipated (the profile's own name, which
 * differs between shops) was reaching the section detector and became a
 * section on a real estimate.
 */
const FOOTER_START = /^committed\s+on$/i;
const FOOTER_END = /^page\s+\d+\s+of\s+\d+$/i;
/** The flag legend printed under the last page's rows ("** Judgment Item …",
 *  "dd Discontinued by Manufacturer …"). It runs to the totals block and is
 *  never row text; joined onto the last row it put legend words into that
 *  row's part type. */
const LEGEND_START = /^\*+\s*judgment\s+item/i;

/** Where the line-item region stops. */
const REGION_END = /^(?:parts?\s*vendors?|estimate\s+totals?|estima\s*te\s*to\s*ta\s*ls)/i;

/**
 * Labor-type column words, from the vocabulary rather than a fixed three.
 * A real estimate billed windshield, back-window and quarter-glass work as
 * "Glass" labor; a reader that knew only Body / Refinish / Mechanical dropped
 * those hours from the rows AND never read the "Glass Labor" totals row, so the
 * two sides agreed with each other and both were short.
 */
const LABOR_TYPE_WORDS: string[] = [
  ...new Set(
    (VOCABULARY.laborTypes as Array<{ aliases: string[] }>)
      .flatMap((entry) => entry.aliases)
      .map(normalizeVocabularyText)
      .filter((alias) => alias.length >= 4 && !alias.includes(" "))
  ),
];

/** Every word the part-type vocabulary spells, for skipping the column when
 *  the print repeats it (the type column and the number column both read
 *  "Sublet" on a sublet line). */
const PART_TYPE_WORDS = new Set(
  (VOCABULARY.partTypes as Array<{ aliases: string[] }>)
    .flatMap((entry) => entry.aliases)
    .flatMap((alias) => normalizeVocabularyText(alias).split(" "))
    .filter(Boolean)
);

const OPERATION_PHRASES: string[] = (VOCABULARY.operations as Array<{ aliases: string[] }>)
  .flatMap((entry) => entry.aliases)
  .concat(["ADDITIONAL COST", "ADDITIONAL OPERATION", "ADDITIONAL LABOR"])
  .map(normalizeVocabularyText)
  .filter((alias) => alias.split(" ").length >= 1)
  .sort((a, b) => b.length - a.length);

const PART_TYPE_PHRASES: string[] = (VOCABULARY.partTypes as Array<{ aliases: string[] }>)
  .flatMap((entry) => entry.aliases)
  .map(normalizeVocabularyText)
  .sort((a, b) => b.length - a.length);

function isFurniture(line: string): boolean {
  return FURNITURE.some((pattern) => pattern.test(line.trim()));
}

/**
 * True when the document prints Mitchell-shaped rows. Measured, not guessed:
 * three or more lines must open with the line-number + operation-code anchor.
 * One or two could be coincidence in any numeric table.
 */
export function looksLikeMitchellLayout(text: string): boolean {
  if (!text) return false;
  let anchors = 0;
  for (const line of splitLines(text)) {
    if (ROW_ANCHOR.test(line)) anchors += 1;
    if (anchors >= 3) return true;
  }
  return false;
}

function splitLines(text: string): string[] {
  return normalizeOverprintText(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Column keywords that the print welds onto the value that follows them
 * ("Body1.6", "New1", "Sublet1"). Splitting on a blanket letter-then-digit
 * rule would also break part numbers ("TA1228103" -> "TA 1228103"), so the
 * split is driven by this vocabulary instead.
 */
const GLUED_KEYWORD = new RegExp(
  `\\b(${[...LABOR_TYPE_WORDS, "INC"]
    .concat(PART_TYPE_PHRASES.flatMap((phrase) => phrase.split(" ")))
    .concat(["YES", "SUBLET"])
    .map((word) => word.replace(/[^A-Z0-9]/g, ""))
    // A one-letter word ("A", "M" from the A/M spelling) is too weak to anchor
    // a split on: it cut a part number's final group ("A1") in two.
    .filter((word) => word.length >= 2)
    .sort((a, b) => b.length - a.length)
    .join("|")})(?=\\d)`,
  "gi"
);

/** A flag letter welded onto the part-type column ("CExisting"). Driven by the
 *  part-type vocabulary so a description word starting with the same letter
 *  ("Cover") is never split. */
const FLAG_BEFORE_PART_TYPE = new RegExp(
  `([#*rCTA])(?=(?:${PART_TYPE_PHRASES.flatMap((phrase) => phrase.split(" "))
    // Words of one or two letters ("A", "M" from the A/M spelling) are too
    // weak to anchor a split on and would cut into ordinary description text.
    .filter((word) => word.length >= 3)
    .sort((a, b) => b.length - a.length)
    .join("|")})\\b)`,
  "gi"
);

/** A value welded to the column keyword that follows it. Vocabulary-driven for
 *  the same reason GLUED_KEYWORD is: a part number must survive intact. */
const VALUE_BEFORE_KEYWORD = new RegExp(
  `(\\d)(?=(?:${[...LABOR_TYPE_WORDS, "INC", "YES", "NO"]
    .concat(PART_TYPE_PHRASES.flatMap((phrase) => phrase.split(" ")))
    .map((word) => word.replace(/[^A-Z0-9]/g, ""))
    .filter((word) => word.length >= 2)
    .sort((a, b) => b.length - a.length)
    .join("|")})(?![a-z]))`,
  "gi"
);

/** Insert a space wherever the print glues two columns into one run. */
export function unglue(value: string): string {
  return value
    // "AssyOverhaul" -> "Assy Overhaul"; "CoverRemove" -> "Cover Remove"
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    // "COVERAdditional" -> "COVER Additional". The capitalised word that
    // follows must carry at least two lower-case letters: requiring only one
    // split the platform's own "INCr" marker into "IN Cr", which cost the row
    // its included-labor flag.
    .replace(/([A-Z]{2,})([A-Z][a-z]{2,})/g, "$1 $2")
    // "(Alum)Repair" -> "(Alum) Repair"
    .replace(/([)\]])([A-Za-z0-9])/g, "$1 $2")
    // "Cooling Unit Assy -MRemove" -> "-M Remove": the platform's one-letter
    // labor marker at the end of a description, welded to the operation. On
    // a real supplement this cost the row its operation.
    .replace(/(-[A-Z])([A-Z][a-z]{2,})/g, "$1 $2")
    // "1.6#Existing" -> "1.6# Existing"; "Mechanical*0.3*" -> "Mechanical *0.3*"
    .replace(/([#*])([A-Za-z])/g, "$1 $2")
    .replace(/([A-Za-z])([#*])/g, "$1 $2")
    // A value welded to the COLUMN WORD that follows it ("0.0New", "2.64Yes").
    // This was a blanket digit-then-letter split, which also cut every
    // alphanumeric part number in half ("15369-0P0101" -> "15369-0 P0101").
    // The debris then trailed into the section heading and cost the sheet its
    // sections as well as its part numbers.
    .replace(VALUE_BEFORE_KEYWORD, "$1 ")
    .replace(/(\S)(\$)/g, "$1 $2")
    // "Body1.6" -> "Body 1.6", but "TA1228103" untouched.
    // RS-4: a part number too long for its column wraps onto the next printed
    // line ("90467-" / "07049-23"). Joining on the digit-dash-digit seam puts
    // it back; nothing else in the row has that shape.
    .replace(/(\d)-\s+(\d)/g, "$1-$2")
    .replace(GLUED_KEYWORD, "$1 ")
    .replace(FLAG_BEFORE_PART_TYPE, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

interface MitchellBlock {
  lineNumber: number;
  /** Supplement-of-record tag printed ahead of the line number ("S1"). */
  supplementTag: string | null;
  operationCode: string;
  /** The row's own text, joined across the lines its columns wrapped over. */
  text: string;
  /** The same text with the physical line breaks kept, for the cases where a
   *  line boundary is the only evidence (a heading after a note row). */
  lines: string[];
}

/**
 * The column header, which differs between Mitchell prints.
 *
 * Some estimates carry a CEG column between Total Units and Type. Extraction
 * welds it onto the units cell ("2.6#2.6", "INC#0.2", "*0.0*0.0"), and a units
 * pattern that does not expect it matches nothing — which is how a real
 * estimate reached the sheet with 3.1 of its 24.6 body hours.
 */
const HEADER_LINE = /^line\s*#.*total\s*units/i;
/** The header is one glued run ("Total UnitsCEGType"), so CEG carries no word
 *  boundary; anchoring it to the column it follows is what makes it findable. */
const CEG_COLUMN = /UNITS\s*CEG/i;

/** A line that could be a section heading: short, no digits, no money. */
function isHeadingShaped(line: string): boolean {
  return Boolean(line) && !/\d/.test(line) && line.length <= 60;
}

/** Split the line-item region into one block per printed row. */
export function readMitchellBlocks(text: string): {
  blocks: MitchellBlock[];
  regionFound: boolean;
  openingHeading: string | null;
  hasCegColumn: boolean;
} {
  const lines = splitLines(text);
  const blocks: MitchellBlock[] = [];
  let current: MitchellBlock | null = null;
  let started = false;
  let openingHeading: string | null = null;
  let hasCegColumn = false;
  let inFooter = false;
  let inPageHead = false;
  let inLegend = false;

  for (const line of lines) {
    if (HEADER_LINE.test(line)) hasCegColumn = hasCegColumn || CEG_COLUMN.test(line);
    if (REGION_END.test(line)) {
      if (started) break;
      continue;
    }
    // RK-10: the footer is cut before anchors or sections are looked at.
    if (inFooter) {
      if (FOOTER_END.test(line)) {
        inFooter = false;
        inPageHead = true;
        inLegend = false;
      }
      continue;
    }
    if (FOOTER_START.test(line)) {
      inFooter = true;
      continue;
    }
    if (LEGEND_START.test(line)) {
      inLegend = true;
      continue;
    }
    if (isFurniture(line)) continue;
    const anchor = ROW_ANCHOR.exec(line);
    if (anchor) {
      if (current) blocks.push(current);
      started = true;
      inPageHead = false;
      inLegend = false;
      current = {
        lineNumber: Number(anchor[2]),
        supplementTag: anchor[1] ?? null,
        operationCode: anchor[3],
        text: line.slice(anchor[0].length),
        lines: [line.slice(anchor[0].length)],
      };
      continue;
    }
    // The page head (between "Page N of M" and the first row of the next page)
    // repeats the owner and vehicle line. It carries digits, so it can never
    // be a heading; joined onto the row above it, it hid that row's heading.
    if (inPageHead && /\d/.test(line)) continue;
    if (inLegend) continue;
    // Not an anchor: a wrapped continuation of the row being built, or a
    // section heading sitting between rows. Which one it is cannot be decided
    // here — it falls out of parsing, where anything left over after the row's
    // last column is the heading that follows it.
    if (current) {
      current.text += ` ${line}`;
      current.lines.push(line);
    } else if (!started && isHeadingShaped(line)) openingHeading = line;
  }
  if (current) blocks.push(current);
  return { blocks, regionFound: blocks.length > 0, openingHeading, hasCegColumn };
}

interface ParsedMitchellRow {
  row: EstimateDeltaRow;
  /** Text left after the row's last column — the next row's section heading. */
  trailing: string;
}

/**
 * EARLIEST known phrase at or after `from`, longest at that position.
 *
 * Position beats length. Scanning for the longest phrase anywhere in the block
 * read the heading that follows a row ("Additional Costs & Materials") as that
 * row's own operation, because it is a longer phrase than the operation the
 * row actually prints. The operation column sits immediately after the
 * description, so the first match going left to right is the right one.
 */
function findPhrase(
  tokens: string[],
  phrases: string[],
  from: number
): { start: number; end: number; phrase: string } | null {
  for (let start = from; start < tokens.length; start += 1) {
    for (const phrase of phrases) {
      const words = phrase.split(" ");
      if (start + words.length > tokens.length) continue;
      let hit = true;
      for (let offset = 0; offset < words.length; offset += 1) {
        if (tokens[start + offset] !== words[offset]) {
          hit = false;
          break;
        }
      }
      if (hit) return { start, end: start + words.length, phrase };
    }
  }
  return null;
}

/**
 * Remove a CEG value welded onto the end of the units cell.
 *
 * Only strips when what remains still reads as a units cell, so a plain
 * "2.6" is never mistaken for units "2" plus a CEG of ".6".
 */
export function stripCegSuffix(token: string): string {
  const split = /^(\*?\d+\.\d\*?[#*rCTA]*|INC[#*rCTA]*)(\d+\.\d)$/i.exec(token);
  return split ? split[1] : token;
}

const UNITS_TOKEN = /^\*?\d+\.\d|^INC/i;

function isLaborTypeWord(token: string | undefined): boolean {
  return Boolean(token) && LABOR_TYPE_WORDS.includes(token as string);
}

/**
 * The operation column. A candidate phrase is confirmed by what FOLLOWS it —
 * the labor-type column and then a units cell — because a description can
 * contain an operation word ("Pre Repair Scan"). A candidate followed by a
 * labor type alone is the next best evidence, and only when no candidate has
 * any does the first one stand in, which is what a row billing no time
 * ("Additional Cost / Paint Materials") looks like.
 */
function findOperation(
  tokens: string[],
  raw: string[]
): { start: number; end: number; phrase: string } | null {
  let fallback: { start: number; end: number; phrase: string } | null = null;
  let laborOnly: { start: number; end: number; phrase: string } | null = null;
  let from = 0;
  while (from < tokens.length) {
    const candidate = findPhrase(tokens, OPERATION_PHRASES, from);
    if (!candidate) break;
    if (!fallback) fallback = candidate;
    if (isLaborTypeWord(tokens[candidate.end])) {
      if (UNITS_TOKEN.test(raw[candidate.end + 1] ?? "")) return candidate;
      if (!laborOnly) laborOnly = candidate;
    }
    from = candidate.start + 1;
  }
  return laborOnly ?? fallback;
}

const MONEY_TOKEN = /^\$([\d,]+\.\d{2})\*?$/;
const TAX_TOKEN = /^(?:yes|no|y|n)$/i;
/** A token the Number column can print: alphanumerics, dashes, dots, slashes,
 *  with an optional leading marker the platform puts on a verified or
 *  substituted number. */
const NUMBER_COLUMN_TOKEN = /^[*~#]?[A-Za-z0-9][A-Za-z0-9./-]*$/;

/**
 * RK-03 (text lane): read the Number / Qty / Total Price / Tax band.
 *
 * The header's x-positions are not available to a text extraction, so the
 * band is defined by the columns that BOUND it: it opens after the part type
 * and closes at the Total Price column, which is the first money token on
 * the row after the description. Everything between is the Number and Qty
 * cells, however the print spaced them — a part number printed as several
 * spaced groups, a quantity standing alone, or a quantity welded onto the
 * number's last group. Nothing after the price is a part number.
 *
 * A real estimate printed its OEM numbers as spaced groups; a reader that
 * required one unbroken token stopped at the first group, and every part
 * number AND every price on the sheet was lost against a printed parts total
 * of thousands of dollars.
 */
function readPartBand(
  raw: string[],
  tokens: string[],
  from: number,
  declaredQty: number | null
): {
  cursor: number;
  partNumber: string | null;
  partNumberSource: string | null;
  qty: number | null;
  price: number | null;
  taxed: boolean;
  qtyStoodAlone: boolean;
  flags: string[];
} {
  const flags: string[] = [];
  let priceIndex = -1;
  for (let index = from; index < raw.length; index += 1) {
    if (MONEY_TOKEN.test(raw[index])) {
      priceIndex = index;
      break;
    }
    // A token the Number column cannot print closes the band without a
    // price: what follows is the next heading, not this row's columns.
    if (!NUMBER_COLUMN_TOKEN.test(raw[index]) && !PART_TYPE_WORDS.has(tokens[index])) break;
  }

  if (priceIndex === -1) {
    return {
      cursor: from,
      partNumber: null,
      partNumberSource: null,
      qty: null,
      price: null,
      taxed: false,
      qtyStoodAlone: false,
      flags,
    };
  }

  // Number and Qty cells: the tokens between the part type and the price,
  // with a repeated part-type column ("Sublet Sublet") stepped over.
  let band = raw.slice(from, priceIndex);
  let bandTokens = tokens.slice(from, priceIndex);
  while (band.length > 0 && PART_TYPE_WORDS.has(bandTokens[0])) {
    band = band.slice(1);
    bandTokens = bandTokens.slice(1);
  }

  let qty: number | null = null;
  let qtyStoodAlone = false;
  // A bare integer standing last in the band IS the quantity column, which
  // also proves it was NOT welded onto the part number.
  if (band.length > 0 && /^\d{1,3}$/.test(band[band.length - 1])) {
    qty = Number(band[band.length - 1]);
    qtyStoodAlone = true;
    band = band.slice(0, -1);
  }

  // Price, then the columns after it: a second price column when the print
  // carries one (the LAST money before the tax marker is the total), and the
  // tax marker itself.
  let cursor = priceIndex;
  let price: number | null = null;
  let taxed = false;
  let priceCount = 0;
  while (cursor < raw.length) {
    const money = MONEY_TOKEN.exec(raw[cursor]);
    if (money) {
      price = Number(money[1].replace(/,/g, ""));
      priceCount += 1;
      cursor += 1;
      continue;
    }
    if (TAX_TOKEN.test(raw[cursor])) {
      taxed = /^y/i.test(raw[cursor]);
      cursor += 1;
      break;
    }
    if (/^[#*rCTA]+$/.test(raw[cursor])) {
      cursor += 1;
      continue;
    }
    break;
  }
  if (priceCount > 1) flags.push("two prices printed on this line — the last one was taken as the total; verify");

  // The part number: every remaining band token, verbatim, with a leading
  // marker removed for the keyed form. A group the Number column could not
  // have printed is still carried, flagged, rather than dropped — the value
  // must come from the document, and the estimator sees it as printed.
  let partNumber: string | null = null;
  let partNumberSource: string | null = null;
  if (band.length > 0) {
    const cleaned = band.map((token) => token.replace(/^[*~#]+/, ""));
    if (band.some((token) => /^[*~#]/.test(token))) {
      flags.push("part number printed with a marker — verify the number and price against the source");
    }
    if (band.some((token) => !NUMBER_COLUMN_TOKEN.test(token))) {
      flags.push("part number column could not be read cleanly — verify");
    }
    const joined = cleaned.join("");
    const alphanumerics = joined.replace(/[^A-Za-z0-9]/g, "");
    if (/\d/.test(alphanumerics) && alphanumerics.length >= 4) {
      partNumberSource = cleaned.join(" ");
      partNumber = cleaned.length === 1 ? cleaned[0] : cleaned.join(" ");
    } else {
      flags.push(`number column read as "${band.join(" ")}" — verify`);
    }
  }

  // Separate the quantity the print welds onto the part number. Every branch
  // is driven by something the document states; where it states nothing the
  // token is left as printed and flagged.
  if (partNumber !== null && !qtyStoodAlone) {
    if (declaredQty !== null) {
      const suffix = String(declaredQty);
      if (partNumber.endsWith(suffix) && partNumber.length > suffix.length) {
        partNumber = partNumber.slice(0, -suffix.length);
        partNumberSource = partNumber;
      }
      qty = declaredQty;
    } else if (/\d$/.test(partNumber) && partNumber.length > 1) {
      // No declaration means a single unit — the print spells out any larger
      // quantity — so the one trailing digit is that quantity.
      qty = qty ?? 1;
      partNumber = partNumber.slice(0, -1);
      partNumberSource = partNumber;
      flags.push("part number and quantity printed together — verify");
    }
  }
  if (declaredQty !== null && qty === null) qty = declaredQty;

  return { cursor, partNumber, partNumberSource, qty, price, taxed, qtyStoodAlone, flags };
}

function parseBlock(
  block: MitchellBlock,
  section: string | null,
  hasCegColumn: boolean
): ParsedMitchellRow | null {
  // Punctuation-only tokens are dropped from BOTH streams in step, so the
  // separator the print puts inside an operation ("Remove / Replace") cannot
  // break the phrase, while the raw stream still spells the description as
  // printed.
  const raw: string[] = [];
  const tokens: string[] = [];
  for (const token of unglue(block.text).split(" ").filter(Boolean)) {
    const normalized = normalizeVocabularyText(token);
    if (!normalized) continue;
    raw.push(token);
    tokens.push(normalized);
  }
  if (tokens.length === 0) return null;

  // 1. Operation — the first column whose vocabulary is fixed, so it is what
  //    separates the free-text description from the value columns.
  //
  //    When no operation phrase is known, the labor-type column is the next
  //    fixed vocabulary on the row, so the row is anchored there instead and
  //    carried with its operation UNMAPPED. Dropping it lost the row and,
  //    with it, the section heading printed after it.
  const operation = findOperation(tokens, raw);
  let descriptionEnd: number;
  let cursor: number;
  if (operation) {
    descriptionEnd = operation.start;
    cursor = operation.end;
  } else {
    const laborIndex = tokens.findIndex(
      (token, index) => index > 0 && isLaborTypeWord(token) && UNITS_TOKEN.test(raw[index + 1] ?? "")
    );
    if (laborIndex === -1) return null;
    descriptionEnd = laborIndex;
    cursor = laborIndex;
  }

  // RK-07: the print spells a multi-quantity line in the description
  // ("Frt Bumper Clip (2 @ $1.98)"), which is the only place the quantity
  // appears in full when the Number and Qty columns weld together.
  const perUnit = /\((\d{1,3})\s*@\s*\$([\d,]+\.\d{2})\)/.exec(block.text);
  const declaredQty = perUnit ? Number(perUnit[1]) : null;
  const declaredUnit = perUnit ? Number(perUnit[2].replace(/,/g, "")) : null;
  const description = raw
    .slice(0, descriptionEnd)
    .join(" ")
    .replace(/\s*\(\s*\d{1,3}\s*@?\s*\$?[\d,]+\.\d{2}\s*\)/, "")
    .trim();
  if (!description) return null;

  // 2. Labor type, when the row bills time.
  let laborWord: string | null = null;
  if (cursor < tokens.length && isLaborTypeWord(tokens[cursor])) {
    laborWord = tokens[cursor];
    cursor += 1;
  }

  // 3. Units: a decimal, or the platform's "included" marker. Judgment
  //    asterisks and note flags ride on the same token.
  let units: number | null = null;
  let included = false;
  if (cursor < tokens.length) {
    // On a print with a CEG column the two cells arrive as one token, so the
    // trailing CEG value is removed before the units are read. CEG is the
    // guide's own time and is not what the estimate bills.
    const token = hasCegColumn ? stripCegSuffix(raw[cursor]) : raw[cursor];
    const numeric = /^\*?(\d+\.\d)\*?[#*rCTA]*$/.exec(token);
    const inc = /^INC[#*rCTA]*$/i.test(token);
    if (numeric) {
      units = Number(numeric[1]);
      cursor += 1;
    } else if (inc) {
      included = true;
      cursor += 1;
    }
  }
  // Step over what trails the units cell: stray flag tokens printed apart from
  // the value ("0.8 C"), and the CEG value where ungluing split it off rather
  // than leaving it welded ("INC" then "#2.6", "0.1" then "r" then "#0.1").
  // Both shapes are unambiguous here — a part type is alphabetic, a quantity a
  // bare integer, a price opens with a currency mark.
  while (
    cursor < tokens.length &&
    (/^[#*rCTA]+$/.test(raw[cursor]) || (hasCegColumn && /^[#*rCTA]*\d+\.\d$/.test(raw[cursor])))
  ) {
    cursor += 1;
  }

  // 4. Part type.
  const partType = findPhrase(tokens, PART_TYPE_PHRASES, cursor);
  if (partType) cursor = partType.end;

  // 5. Number, quantity, price and tax marker — the band between the part
  //    type and the price column.
  const band = readPartBand(raw, tokens, cursor, declaredQty);
  cursor = band.cursor;
  const unitPrice =
    declaredUnit ?? (band.price !== null && (band.qty ?? 1) > 1 ? band.price / (band.qty ?? 1) : band.price);

  const trailing = raw.slice(cursor).join(" ").trim();

  const laborCode = laborWord ? resolveLaborType(laborWord) : null;
  const isRefinish = laborCode === "LAR";
  const row: EstimateDeltaRow = {
    lineNumber: block.lineNumber,
    opCode: null,
    // The operation is carried at the head of the description, which is where
    // the shared vocabulary resolver expects to read it — the same path the
    // CCC print takes when it prints the operation inline.
    description: operation
      ? `${raw.slice(operation.start, operation.end).join(" ")} ${description}`
      : description,
    descriptionTokens: [],
    partNumber: band.partNumber,
    section,
    qty: band.qty,
    price: unitPrice,
    labor: isRefinish ? null : units,
    laborIncluded: isRefinish ? false : included,
    paint: isRefinish ? units : null,
    paintIncluded: isRefinish ? included : false,
    // Body is the default category and carries no marker; mechanical keeps the
    // letter the shared reader uses; any other type is carried by its word so
    // the vocabulary resolves it ("Glass" -> LAG).
    laborType: laborCode === "LAM" ? "M" : laborCode && laborCode !== "LAB" && !isRefinish ? laborWord : null,
    partSource: partType ? [partType.phrase] : [],
    // Keeping the row's own printed text lets the judgment-marker and tax
    // readers work off the source rather than off this parse.
    rawText: `${block.supplementTag ?? ""}${block.lineNumber}${block.operationCode}${block.text}${
      band.taxed ? " T" : ""
    }${band.flags.map((flag) => ` [${flag}]`).join("")}`,
    pageNumber: null,
    supplementTag: block.supplementTag,
  };

  return { row, trailing };
}

/** The last physical line of a block, when it reads as a KNOWN section
 *  heading. Used where the block itself cannot be parsed into columns (a note
 *  row, an unreadable row), so the heading printed after it is not lost. */
function trailingKnownHeading(block: MitchellBlock): string | null {
  const last = block.lines[block.lines.length - 1]?.trim() ?? "";
  if (block.lines.length < 2 || !isHeadingShaped(last)) return null;
  return resolveSectionGroup({ section: last }).mapped ? last : null;
}

export interface MitchellEstimateRead {
  rows: EstimateDeltaRow[];
  /** Coded note rows, keyed to the line they follow (RK-05). */
  notes: Map<number, string[]>;
  /** Printed line numbers whose block could not be read into a row. */
  unreadable: number[];
}

/**
 * Read a Mitchell estimate's line items.
 *
 * Section headings are recovered from what is left over after a row's last
 * column: the heading is printed between rows, so it joins the block above it
 * and falls out once that row's columns are consumed.
 */
export function readMitchellEstimate(text: string): MitchellEstimateRead {
  const { blocks, openingHeading, hasCegColumn } = readMitchellBlocks(text);
  const rows: EstimateDeltaRow[] = [];
  const notes = new Map<number, string[]>();
  const unreadable: number[] = [];
  let section: string | null = openingHeading;
  let lastRowLine: number | null = null;

  for (const block of blocks) {
    // RK-05: a coded note is an instruction to the person keying, never a
    // keying row. It is attached to the row it follows. A heading printed
    // after it is the note's last physical line when that line names a
    // known section.
    if (NOTE_CODES.has(block.operationCode)) {
      const heading = trailingKnownHeading(block);
      const prose = (heading ? block.lines.slice(0, -1) : block.lines).join(" ").replace(/\s+/g, " ").trim();
      if (prose && lastRowLine !== null) notes.set(lastRowLine, [...(notes.get(lastRowLine) ?? []), prose]);
      if (heading) section = heading;
      continue;
    }
    const parsed = parseBlock(block, section, hasCegColumn);
    if (!parsed) {
      unreadable.push(block.lineNumber);
      const heading = trailingKnownHeading(block);
      if (heading) section = heading;
      continue;
    }
    rows.push(parsed.row);
    lastRowLine = block.lineNumber;
    if (parsed.trailing && isHeadingShaped(parsed.trailing)) {
      section = parsed.trailing;
    }
  }
  return { rows, notes, unreadable };
}

export function parseMitchellEstimateRows(text: string): EstimateDeltaRow[] {
  return readMitchellEstimate(text).rows;
}

/**
 * RK-11: the vehicle line, from the header block.
 *
 * The header prints the vehicle on its own line immediately above the
 * "Exterior Color" label. A year-anchored search over the whole document
 * matched a loss date first on a real estimate and put the inspection site's
 * name on the sheet as the vehicle.
 */
export function readMitchellVehicle(text: string): string | null {
  const lines = splitLines(text);
  for (let index = 1; index < lines.length; index += 1) {
    if (!/^exterior\s+colou?r$/i.test(lines[index])) continue;
    for (let back = index - 1; back >= Math.max(0, index - 3); back -= 1) {
      const candidate = lines[back];
      if (/^(?:19|20)\d{2}\s+[A-Za-z]/.test(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Mitchell totals block.
 *
 * The shared totals reader looks for the CCC basis line ("17.2 hrs @ $90.00
 * /hr"). Mitchell prints no basis words at all, prints every value TWICE, and
 * letter-spaces some of them ("$ 2 , 2 2 5 . 0 0"). Read with the CCC reader a
 * real Mitchell estimate produced no totals, so the sheet carried no profile
 * block and no target for the keyed estimate to reach — the two things the
 * estimator needs first.
 *
 * Values are recovered structurally, not by position: spaces are removed, then
 * CONSECUTIVE IDENTICAL values collapse to one. That is the same
 * printed-twice property the overprint normalizer already trades on, applied
 * at the value level instead of the character level, so it needs no knowledge
 * of how many times this particular print repeats a column.
 */
export interface MitchellTotalsCategory {
  category: string;
  hours: number | null;
  rate: number | null;
  cost: number | null;
  /** Dollars the category carries beyond hours x rate: the platform's sublet
   *  and additional-amount columns, which the row text cannot tell apart. */
  extra?: number | null;
}

export interface MitchellTotals {
  categories: MitchellTotalsCategory[];
  subtotal: number | null;
  tax: number | null;
  grandTotal: number | null;
  taxLanes: Array<{ label: string; amount: number }>;
  deductible: number | null;
}

const LABOR_CATEGORY = /^([A-Za-z]+)Labor(?![A-Za-z])/i;

function money(value: string): number {
  return Number(value.replace(/[$,]/g, ""));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Collapse runs of the same printed value to a single occurrence. */
function dedupeConsecutive(values: string[]): string[] {
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}

export function parseMitchellEstimateTotals(text: string): MitchellTotals | null {
  if (!text) return null;
  const lines = splitLines(text).map((line) =>
    line
      .replace(/\s+/g, "")
      // An hours value printed twice runs together into one number
      // ("11.411.4"), which no numeric pattern can read. Collapsing the
      // repetition first is what makes the units column readable at all.
      .replace(/(\d{1,3}\.\d)\1(?!\d)/g, "$1")
  );

  const totals: MitchellTotals = {
    categories: [],
    subtotal: null,
    tax: null,
    grandTotal: null,
    taxLanes: [],
    deductible: null,
  };
  let materialsRate: number | null = null;
  let seenTotalsBlock = false;
  // A cost label that wrapped onto its own line(s) ahead of its values.
  let pendingLabel: string | null = null;

  for (const line of lines) {
    if (/^estimatetotals/i.test(line)) {
      seenTotalsBlock = true;
      continue;
    }
    if (!seenTotalsBlock) continue;

    const values = dedupeConsecutive(line.match(/\$[\d,]+\.\d{2}|(?<![\d.$])\d{1,3}\.\d(?![\d%])/g) ?? []);

    // Every labor category the page prints, not a fixed three: the word before
    // "Labor" must be a labor type the vocabulary knows, which is what keeps
    // the "Total Labor" row out.
    const labor = LABOR_CATEGORY.exec(line);
    if (labor && values.length >= 2 && resolveLaborType(labor[1]) !== null) {
      const hours = /^\d/.test(values[0]) ? Number(values[0]) : null;
      const amounts = values.filter((value) => value.startsWith("$")).map(money);
      const rate = amounts.length > 0 ? amounts[0] : null;
      // The last money on the row is the category total; a middle one is the
      // sublet the platform books into this labor category.
      const cost = amounts.length > 0 ? amounts[amounts.length - 1] : null;
      totals.categories.push({
        category: `${labor[1].replace(/^./, (c) => c.toUpperCase())} Labor`,
        hours,
        rate,
        cost,
        extra:
          hours !== null && rate !== null && cost !== null && Math.abs(cost - hours * rate) >= 0.005
            ? round2(cost - hours * rate)
            : null,
      });
      pendingLabel = null;
      continue;
    }
    if (/^taxableparts/i.test(line) && values.length > 0) {
      totals.categories.push({ category: "Parts", hours: null, rate: null, cost: money(values[0]) });
      continue;
    }
    if (/^partsadjustments/i.test(line) && values.length > 0) {
      totals.categories.push({ category: "Parts Adjustments", hours: null, rate: null, cost: money(values[0]) });
      continue;
    }
    if (/^paintmaterials\$/i.test(line) && values.length > 0) {
      totals.categories.push({ category: "Paint Materials", hours: null, rate: null, cost: money(values[0]) });
      continue;
    }
    if (/^shopmaterials\$/i.test(line) && values.length > 0) {
      totals.categories.push({ category: "Shop Materials", hours: null, rate: null, cost: money(values[0]) });
      continue;
    }
    if (/^otheradditional(?:costs)?\$/i.test(line) && values.length > 0) {
      totals.categories.push({ category: "Other Additional Costs", hours: null, rate: null, cost: money(values[0]) });
      continue;
    }
    if (/^otheradditional(?:costs)?$/i.test(line) || (pendingLabel && /^costs$/i.test(line))) {
      pendingLabel = "Other Additional Costs";
      continue;
    }
    if (pendingLabel && /^\$/.test(line) && values.length > 0) {
      totals.categories.push({ category: pendingLabel, hours: null, rate: null, cost: money(values[0]) });
      pendingLabel = null;
      continue;
    }
    pendingLabel = null;
    if (/^-?rate:/i.test(line) && values.length > 0) {
      materialsRate = money(values[0]);
      continue;
    }
    const tax = /^tax(\d+\.\d+)%/i.exec(line);
    if (tax && values.length > 0) {
      const amount = money(values[0]);
      if (amount > 0) {
        totals.tax = (totals.tax ?? 0) + amount;
        totals.taxLanes.push({ label: `Tax ${tax[1]}%`, amount });
      }
      continue;
    }
    if (/^grosstotal/i.test(line) && values.length > 0) {
      totals.grandTotal = money(values[0]);
      continue;
    }
    if (/^deductible/i.test(line) && values.length > 0) {
      totals.deductible = money(values[0]);
      continue;
    }
    if (/^taxable\$/i.test(line) && values.length > 0) {
      // The last taxable base printed is the gross one.
      totals.subtotal = money(values[0]);
      continue;
    }
  }

  // The materials rate is printed apart from the materials amount; attach it so
  // the profile block can state it as printed rather than deriving it.
  if (materialsRate !== null) {
    const materials = totals.categories.find((entry) => entry.category === "Paint Materials");
    if (materials) materials.rate = materialsRate;
  }

  return totals.categories.length > 0 || totals.grandTotal !== null ? totals : null;
}
