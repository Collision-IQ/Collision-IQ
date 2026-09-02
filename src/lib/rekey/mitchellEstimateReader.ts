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
import { normalizeVocabularyText } from "./rekeyVocabulary";

/**
 * Row anchor: a 1-3 digit line number followed by the Mitchell operation code
 * — six digits, or the literal the platform prints when a line carries no
 * database code — and then the description's first letter.
 */
const ROW_ANCHOR = /^(\d{1,3})(\d{6}|AUTO)(?=[A-Za-z$])/;

/** Page furniture: producer boilerplate that repeats on every printed page. */
const FURNITURE = [
  /^page\s+\d+\s+of\s+\d+$/i,
  /^\s*page\s+\d+\s+of\s+\d+\s*$/i,
  /^printed\s+on$/i,
  /^committed\s+on$/i,
  /^version$/i,
  /^profile(\s*\(modified\))?$/i,
  /^profile\s+version$/i,
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
  /^\*+\s*judgment\s+item/i,
  /^[a-z]{2}\s+[a-z]+\s+all\s+part\s+types$/i,
];

/** Where the line-item region stops. */
const REGION_END = /^(?:parts?\s*vendors?|estimate\s+totals?|estima\s*te\s*to\s*ta\s*ls)/i;

const LABOR_TYPES = ["BODY", "REFINISH", "MECHANICAL"] as const;

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
  `\\b(${[...LABOR_TYPES, "INC"]
    .concat(PART_TYPE_PHRASES.flatMap((phrase) => phrase.split(" ")))
    .concat(["YES", "SUBLET"])
    .map((word) => word.replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean)
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
    // "1.6#Existing" -> "1.6# Existing"; "Mechanical*0.3*" -> "Mechanical *0.3*"
    .replace(/([#*])([A-Za-z])/g, "$1 $2")
    .replace(/([A-Za-z])([#*])/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/(\S)(\$)/g, "$1 $2")
    // "Body1.6" -> "Body 1.6", but "TA1228103" untouched.
    .replace(GLUED_KEYWORD, "$1 ")
    .replace(FLAG_BEFORE_PART_TYPE, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

interface MitchellBlock {
  lineNumber: number;
  operationCode: string;
  /** The row's own text, joined across the lines its columns wrapped over. */
  text: string;
}

/** Split the line-item region into one block per printed row. */
export function readMitchellBlocks(text: string): {
  blocks: MitchellBlock[];
  regionFound: boolean;
  openingHeading: string | null;
} {
  const lines = splitLines(text);
  const blocks: MitchellBlock[] = [];
  let current: MitchellBlock | null = null;
  let started = false;
  let openingHeading: string | null = null;

  for (const line of lines) {
    if (REGION_END.test(line)) {
      if (started) break;
      continue;
    }
    if (isFurniture(line)) continue;
    const anchor = ROW_ANCHOR.exec(line);
    if (anchor) {
      if (current) blocks.push(current);
      started = true;
      current = {
        lineNumber: Number(anchor[1]),
        operationCode: anchor[2],
        text: line.slice(anchor[0].length),
      };
      continue;
    }
    // Not an anchor: a wrapped continuation of the row being built, or a
    // section heading sitting between rows. Which one it is cannot be decided
    // here — it falls out of parsing, where anything left over after the row's
    // last column is the heading that follows it.
    if (current) current.text += ` ${line}`;
    else if (!started && !/\d/.test(line) && line.length <= 60) openingHeading = line;
  }
  if (current) blocks.push(current);
  return { blocks, regionFound: blocks.length > 0, openingHeading };
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

function findOperation(tokens: string[]): { start: number; end: number; phrase: string } | null {
  let fallback: { start: number; end: number; phrase: string } | null = null;
  let from = 0;
  while (from < tokens.length) {
    const candidate = findPhrase(tokens, OPERATION_PHRASES, from);
    if (!candidate) break;
    if (!fallback) fallback = candidate;
    const next = tokens[candidate.end];
    if (next && LABOR_TYPES.includes(next as (typeof LABOR_TYPES)[number])) return candidate;
    from = candidate.start + 1;
  }
  return fallback;
}

function parseBlock(block: MitchellBlock, section: string | null): ParsedMitchellRow | null {
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
  //    Position alone is not enough: a description can contain an operation
  //    word ("Pre Repair Scan" carries "Repair" three tokens before the row's
  //    real operation, "Additional Operation"). What settles it is the column
  //    that FOLLOWS: the operation is succeeded by the labor-type column. So
  //    the first candidate followed by a labor type wins, and only if none is
  //    does the first candidate of any kind stand in — which is what a row
  //    billing no time ("Additional Cost / Paint Materials") looks like.
  const operation = findOperation(tokens);
  if (!operation) return null;
  const description = raw.slice(0, operation.start).join(" ").trim();
  if (!description) return null;

  let cursor = operation.end;

  // 2. Labor type, when the row bills time.
  let laborType: string | null = null;
  if (cursor < tokens.length && LABOR_TYPES.includes(tokens[cursor] as (typeof LABOR_TYPES)[number])) {
    laborType = tokens[cursor];
    cursor += 1;
  }

  // 3. Units: a decimal, or the platform's "included" marker. Judgment
  //    asterisks and note flags ride on the same token.
  let units: number | null = null;
  let included = false;
  if (cursor < tokens.length) {
    const token = raw[cursor];
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
  // Stray flag tokens printed apart from the units ("0.8 C").
  while (cursor < tokens.length && /^[#*rCTA]+$/.test(raw[cursor])) cursor += 1;

  // 4. Part type.
  const partType = findPhrase(tokens, PART_TYPE_PHRASES, cursor);
  if (partType) cursor = partType.end;

  // 5. Part number, quantity, price, tax marker — each optional.
  let partNumber: string | null = null;
  let qty: number | null = null;
  let price: number | null = null;
  let taxed = false;
  let glued = false;
  while (cursor < tokens.length) {
    const token = raw[cursor];
    const money = /^\$([\d,]+\.\d{2})\*?$/.exec(token);
    if (money) {
      price = Number(money[1].replace(/,/g, ""));
      cursor += 1;
      continue;
    }
    if (/^yes$/i.test(token)) {
      taxed = true;
      cursor += 1;
      continue;
    }
    // A repeated part-type column sits between the type and the price on a
    // sublet line; stepping over it is what lets the price be read at all.
    if (PART_TYPE_WORDS.has(tokens[cursor])) {
      cursor += 1;
      continue;
    }
    if (/^\d{1,3}$/.test(token) && qty === null) {
      qty = Number(token);
      cursor += 1;
      continue;
    }
    // A part number carries digits and is not a bare quantity or a decimal.
    if (partNumber === null && /\d/.test(token) && /^[A-Za-z0-9][A-Za-z0-9-]{4,}$/.test(token)) {
      // The print welds the quantity column onto the part number
      // ("1694511-00-C1" is part 1694511-00-C, quantity 1). Splitting it is
      // only safe when what remains still ends in a non-digit; on
      // "TA12281031" the same split could mean quantity 1 or 31, so the token
      // is kept exactly as printed and the row is flagged instead of guessing.
      const split = /^(.*[A-Za-z-])(\d{1,2})$/.exec(token);
      if (split) {
        partNumber = split[1];
        if (qty === null) qty = Number(split[2]);
      } else {
        partNumber = token;
        if (/\d$/.test(token)) glued = true;
      }
      cursor += 1;
      continue;
    }
    break;
  }

  const trailing = raw.slice(cursor).join(" ").trim();

  const isRefinish = laborType === "REFINISH";
  const isMechanical = laborType === "MECHANICAL";
  const row: EstimateDeltaRow = {
    lineNumber: block.lineNumber,
    opCode: null,
    // The operation is carried at the head of the description, which is where
    // the shared vocabulary resolver expects to read it — the same path the
    // CCC print takes when it prints the operation inline.
    description: `${raw.slice(operation.start, operation.end).join(" ")} ${description}`,
    descriptionTokens: [],
    partNumber,
    section,
    qty,
    price,
    labor: isRefinish ? null : units,
    laborIncluded: isRefinish ? false : included,
    paint: isRefinish ? units : null,
    paintIncluded: isRefinish ? included : false,
    laborType: isMechanical ? "M" : null,
    partSource: partType ? [partType.phrase] : [],
    // Keeping the row's own printed text lets the judgment-marker and tax
    // readers work off the source rather than off this parse.
    rawText: `${block.lineNumber}${block.operationCode}${block.text}${taxed ? " T" : ""}${
      glued ? " [part number and quantity printed together — verify]" : ""
    }`,
    pageNumber: null,
    supplementTag: null,
  };

  return { row, trailing };
}

/**
 * Read a Mitchell estimate's line items.
 *
 * Section headings are recovered from what is left over after a row's last
 * column: the heading is printed between rows, so it joins the block above it
 * and falls out once that row's columns are consumed.
 */
export function parseMitchellEstimateRows(text: string): EstimateDeltaRow[] {
  const { blocks, openingHeading } = readMitchellBlocks(text);
  const rows: EstimateDeltaRow[] = [];
  let section: string | null = openingHeading;

  for (const block of blocks) {
    const parsed = parseBlock(block, section);
    if (!parsed) continue;
    rows.push(parsed.row);
    if (parsed.trailing && !/\d/.test(parsed.trailing) && parsed.trailing.length <= 60) {
      section = parsed.trailing;
    }
  }
  return rows;
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
export interface MitchellTotals {
  categories: Array<{ category: string; hours: number | null; rate: number | null; cost: number | null }>;
  subtotal: number | null;
  tax: number | null;
  grandTotal: number | null;
  taxLanes: Array<{ label: string; amount: number }>;
  deductible: number | null;
}

const LABOR_CATEGORY = /^(Body|Refinish|Mechanical)Labor/i;

function money(value: string): number {
  return Number(value.replace(/[$,]/g, ""));
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

  for (const line of lines) {
    if (/^estimatetotals/i.test(line)) {
      seenTotalsBlock = true;
      continue;
    }
    if (!seenTotalsBlock) continue;

    const values = dedupeConsecutive(line.match(/\$[\d,]+\.\d{2}|(?<![\d.$])\d{1,3}\.\d(?![\d%])/g) ?? []);

    const labor = LABOR_CATEGORY.exec(line);
    if (labor && values.length >= 2) {
      const hours = /^\d/.test(values[0]) ? Number(values[0]) : null;
      const amounts = values.filter((value) => value.startsWith("$")).map(money);
      totals.categories.push({
        category: `${labor[1].replace(/^./, (c) => c.toUpperCase())} Labor`,
        hours,
        rate: amounts.length > 0 ? amounts[0] : null,
        // The last money on the row is the category total; a middle one is the
        // sublet the platform books into this labor category.
        cost: amounts.length > 0 ? amounts[amounts.length - 1] : null,
      });
      continue;
    }
    if (/^taxableparts/i.test(line) && values.length > 0) {
      totals.categories.push({ category: "Parts", hours: null, rate: null, cost: money(values[0]) });
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
