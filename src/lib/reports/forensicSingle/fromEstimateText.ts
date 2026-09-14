/**
 * Adapter: an estimate's extracted text -> NormalizedEstimate.
 *
 * The platform has no whole-estimate normalizer; what it has are the
 * per-platform row and totals readers the delta pipeline already trusts
 * (`parseEstimateRowsForPlatform`, `parseEstimateTotalsForPlatform`) and
 * the identity reader the claim gate uses. This module composes those and
 * adds only what the single-estimate rules need and nothing else reads:
 * the CCC taxed-charge marker, the manual-entry marker, per-line notes,
 * the sales-tax basis, and the header fields (point of impact, owner
 * state, writer, days to repair, certification text).
 *
 * Nothing here keys on a carrier, a shop, or an RO — every pattern is a
 * label the estimating platform itself prints.
 */
import { readClaimIdentity } from "../claimIdentityGate";
import {
  detectEstimatePlatform,
  parseEstimateRowsForPlatform,
  parseEstimateTotalsForPlatform,
} from "../estimatePlatform";
import type { EstimateDeltaRow } from "../estimateDeltaMatcher";
import {
  emptyRowParseDiagnostics,
  parseEstimateRows,
  parseTotalsFromWords,
  type EstimateRow,
  type Word as DeltaEngineWord,
} from "../deltaEngine/rowCluster";
import { pdfWordsToEnginePages } from "../annotatedCitationDensityEstimate";
import type { PdfWord } from "../citationDensityRowAnchors";
import { extractMarketPreviewState, selectOwnerOrInsuredZip } from "@/lib/ai/marketPreviewOwnerZip";
import type {
  EstimateHeader,
  EstimateLine,
  EstimatingSystem,
  LaborCategoryTotal,
  LaborType,
  NormalizedEstimate,
  Operation,
  PrintedTotals,
} from "./types";

const OPER: Record<string, Operation> = {
  repl: "REPL", replace: "REPL", rpr: "RPR", repair: "RPR", "r&i": "R&I", "r&r": "R&R",
  refn: "REFN", refinish: "REFN", blnd: "BLND", blend: "BLND", subl: "SUBL", sublet: "SUBL",
  algn: "ALGN", align: "ALGN", sect: "SECT", "o/h": "OH", add: "ADD",
};
const LABOR: Record<string, LaborType> = { b: "BODY", p: "REFINISH", m: "MECH", s: "STRUCT", f: "FRAME", e: "ELEC", g: "GLASS", d: "DIAG" };

/** CCC prints "T" (taxed) / "X" (non-taxed) directly after a miscellaneous charge amount. */
const TAXED_MARKER = /\d\.\d{2}\s*T(?![A-Za-z0-9])/;
/** Manual entry marker prints between the line number and the operation ("101#Pre wash"). */
const MANUAL_MARKER = /^\s*\d{1,3}\s*#/;
const GOV = /township|borough|county|city of|commonwealth|state of|police|sheriff|school district|authority|municipal|dept\.? of|department of/i;

export interface FromEstimateTextOptions {
  fileName?: string | null;
}

export type NormalizeLane = "pdf" | "text";

export interface NormalizedEstimateRead {
  estimate: NormalizedEstimate;
  /** Which reader produced the line grid. */
  lane: NormalizeLane;
  warnings: string[];
}

/**
 * Text lane: the flattened text layer only. Column identity is inferred
 * from token shape, so a paint-column figure on a glued producer can land
 * in the labor column. Used when no measured word layer is available.
 */
export function buildNormalizedEstimateFromText(
  rawText: string,
  options: FromEstimateTextOptions = {}
): NormalizedEstimate {
  const text = (rawText ?? "").replace(/\r\n?/g, "\n");
  const platform = detectEstimatePlatform(text);
  const read = parseEstimateRowsForPlatform(text);
  const notesByLine = collectNotesByLine(text, read.notes);
  const lines = read.rows.map((row) => toEstimateLine(row, notesByLine));
  const totals = buildPrintedTotals(text);
  const header = buildHeader(text, platform, options.fileName ?? null);
  return { header, lines, totals, boilerplate: collectBoilerplate(text) };
}

/**
 * Measured-word lane: the delta engine's row parser, which types every value
 * cell by the column bands measured from THIS page's header row (the same
 * reader the two-estimate Forensic Estimate Analysis trusts). Falls back to
 * the text lane when the word layer yields no rows or is a Mitchell print
 * (welded columns, no SUBTOTALS row — the platform reader stands there).
 */
export function buildNormalizedEstimate(input: {
  text: string;
  words?: PdfWord[] | null;
  fileName?: string | null;
}): NormalizedEstimateRead {
  const text = (input.text ?? "").replace(/\r\n?/g, "\n");
  const platform = detectEstimatePlatform(text);
  const warnings: string[] = [];
  const fromText = () => ({
    estimate: buildNormalizedEstimateFromText(text, { fileName: input.fileName }),
    lane: "text" as const,
    warnings,
  });
  if (!input.words?.length || platform === "mitchell") return fromText();

  const byPage = pdfWordsToEnginePages(input.words);
  const diag = emptyRowParseDiagnostics();
  const rows = parseEstimateRows(byPage, diag);
  if (rows.length === 0) {
    warnings.push("The measured word layer yielded no line-item rows; the text layer was read instead.");
    return fromText();
  }
  if (diag.rejectedStubRows.length) {
    warnings.push(`${diag.rejectedStubRows.length} row(s) had a line number and operation but no recoverable description and were not read.`);
  }
  const notesByLine = collectNotesByLine(text, new Map());
  const lines = rows.map((row) => engineRowToEstimateLine(row, byPage, notesByLine));
  const measuredTotals = parseTotalsFromWords(byPage).map((row) => ({
    category: row.category,
    hours: row.hours,
    rate: row.rate,
    cost: row.amount,
  }));
  const totals = buildPrintedTotals(text, measuredTotals.length ? measuredTotals : undefined);
  const header = buildHeader(text, platform, input.fileName ?? null);
  return { estimate: { header, lines, totals, boilerplate: collectBoilerplate(text) }, lane: "pdf", warnings };
}

const OP_PREFIX = /^\s*(?:[#*]\s*)*(Repl|Rpr|R&I|R&R|Refn|Blnd|Subl|Algn|Sect|O\/H|Add|Rpl)\b\.?\s*/i;
const LABOR_CLASS: Record<string, LaborType> = { M: "MECH", S: "STRUCT", F: "FRAME", E: "ELEC", G: "GLASS", D: "DIAG", P: "REFINISH" };

function engineRowToEstimateLine(
  row: EstimateRow,
  byPage: Map<number, DeltaEngineWord[]>,
  notesByLine: Map<number, string[]>
): EstimateLine {
  const raw = (row.rawDesc ?? "").replace(/\s+/g, " ").trim();
  const manual = /^\s*(?:\*\s*)?#/.test(raw);
  const opMatch = OP_PREFIX.exec(raw);
  const opToken = opMatch ? opMatch[1].toLowerCase().replace(/\s+/g, "") : "";
  const desc = raw.replace(OP_PREFIX, "").replace(/^[#*\s]+/, "").trim();
  let oper: Operation;
  if (opToken === "add") oper = "ADD";
  else if (opToken && OPER[opToken]) oper = OPER[opToken];
  else if (manual) oper = "MANUAL";
  else if (row.price === null && row.labor === null && row.paint === null) oper = "NOTE";
  else oper = "UNKNOWN";
  const laborType: LaborType = LABOR_CLASS[(row.laborClass ?? "").toUpperCase()] ?? (row.labor === null && row.paint !== null ? "REFINISH" : "BODY");
  const rowNotes = [
    ...(row.note ? [row.note.replace(/^note\s*:?\s*/i, "").trim()] : []),
    ...(notesByLine.get(row.line) ?? []),
  ].filter((note, index, list) => note && list.indexOf(note) === index);
  return {
    lineNo: row.line,
    section: (row.sectionLabel ?? row.section ?? "").toUpperCase(),
    oper,
    desc,
    partNo: row.part ?? undefined,
    qty: row.qty ?? undefined,
    price: row.price,
    laborHrs: row.labor,
    laborType,
    paintHrs: row.paint,
    included: /\bincl\.?\b/i.test(raw),
    manual,
    notes: rowNotes.length ? rowNotes : undefined,
    taxed: hasTaxedMarker(row, byPage),
    side: sideFromRow(String(row.side ?? ""), desc),
  };
}

function sideFromRow(side: string, desc: string): EstimateLine["side"] {
  const upper = side.toUpperCase();
  if (upper === "L" || upper === "LT" || upper === "LEFT") return "LT";
  if (upper === "R" || upper === "RT" || upper === "RIGHT") return "RT";
  return /\bRT\b/i.test(desc) ? "RT" : /\bLT\b/i.test(desc) ? "LT" : null;
}

/**
 * CCC prints the taxed-charge marker ("T") as its own word directly to the
 * right of the extended price, on the same baseline. Measured, not assumed:
 * the marker must sit within a few points of the price cell's right edge.
 */
function hasTaxedMarker(row: EstimateRow, byPage: Map<number, DeltaEngineWord[]>): boolean {
  const price = row.cells.price;
  if (!price) return false;
  const words = byPage.get(row.page) ?? [];
  const mid = (price.top + price.bottom) / 2;
  return words.some(
    (word) =>
      // "T" alone, or "T" glued to the MOTOR component symbol that follows
      // it ("T m", "T s") when the extractor merged the two runs.
      /^T(?:\s+[ms])?$/.test(word.text.trim()) &&
      word.x0 >= price.x1 - 1 &&
      word.x0 <= price.x1 + 14 &&
      word.top <= mid &&
      word.bottom >= mid
  );
}

/* ------------------------------------------------------------------ */
/* Lines                                                               */
/* ------------------------------------------------------------------ */

function toEstimateLine(row: EstimateDeltaRow, notesByLine: Map<number, string[]>): EstimateLine {
  const raw = row.rawText ?? "";
  const oper = resolveOperation(row, raw);
  const desc = (row.description ?? "").replace(/\s+/g, " ").trim();
  const laborType = LABOR[String(row.laborType ?? "b").toLowerCase()] ?? "BODY";
  const notes = row.lineNumber !== null ? notesByLine.get(row.lineNumber) : undefined;
  return {
    lineNo: row.lineNumber,
    section: (row.section ?? "").toUpperCase(),
    oper,
    desc,
    partNo: row.partNumber ?? undefined,
    qty: row.qty ?? undefined,
    price: row.price,
    laborHrs: row.laborIncluded ? null : row.labor,
    laborType,
    paintHrs: row.paintIncluded ? null : row.paint,
    included: row.laborIncluded || row.paintIncluded,
    manual: MANUAL_MARKER.test(raw) || oper === "MANUAL",
    notes: notes && notes.length ? notes : undefined,
    taxed: TAXED_MARKER.test(raw),
    side: /\bRT\b/i.test(desc) ? "RT" : /\bLT\b/i.test(desc) ? "LT" : null,
  };
}

function resolveOperation(row: EstimateDeltaRow, raw: string): Operation {
  const code = (row.opCode ?? "").toLowerCase().replace(/\s+/g, "");
  if (code && OPER[code]) return OPER[code];
  if (MANUAL_MARKER.test(raw)) return "MANUAL";
  if (!code && row.description && row.price === null && row.labor === null && row.paint === null) return "NOTE";
  return code ? "UNKNOWN" : "MANUAL";
}

/**
 * CCC prints "Note: …" prose on the line(s) directly below the row it
 * belongs to; the row reader drops those on purpose (a note is never a
 * row). Harvest them here keyed by the preceding line number. Mitchell
 * notes arrive already keyed from the platform reader.
 */
function collectNotesByLine(text: string, platformNotes: Map<number, string[]>): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const [line, notes] of platformNotes) out.set(line, [...notes]);
  const lines = text.split("\n").map((line) => line.replace(/\s+/g, " ").trim());
  let current: number | null = null;
  let openNote: number | null = null;
  for (const line of lines) {
    if (!line) continue;
    const rowStart = /^(\d{1,3})\s*[#*]?\s*(?:[A-Za-z&/]{2,}|\*\*)/.exec(line);
    if (rowStart && !/^note\b/i.test(line)) {
      current = Number(rowStart[1]);
      openNote = null;
      continue;
    }
    if (/^note\s*:?/i.test(line) && current !== null) {
      const body = line.replace(/^note\s*:?\s*/i, "").trim();
      if (!out.has(current)) out.set(current, []);
      out.get(current)!.push(body);
      openNote = current;
      continue;
    }
    // A wrapped note continuation: prose with no digits-as-values shape,
    // directly after a Note line.
    if (openNote !== null && /^[a-z(]/i.test(line) && !/\d\.\d/.test(line) && !/^[A-Z ]{6,}$/.test(line)) {
      const list = out.get(openNote)!;
      list[list.length - 1] = `${list[list.length - 1]} ${line}`;
      continue;
    }
    openNote = null;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Totals                                                              */
/* ------------------------------------------------------------------ */

const CATEGORY: Array<[RegExp, LaborCategoryTotal["category"]]> = [
  [/^body/i, "BODY"],
  [/^(paint|refinish)\s*labor/i, "REFINISH"],
  [/^mech/i, "MECH"],
  [/^struct/i, "STRUCT"],
  [/^frame/i, "FRAME"],
  [/^elec/i, "ELEC"],
  [/^glass/i, "GLASS"],
  [/^diag/i, "DIAG"],
];

function buildPrintedTotals(
  text: string,
  measuredCategories?: Array<{ category: string; hours: number | null; rate: number | null; cost: number | null }>
): PrintedTotals {
  const parsed = parseEstimateTotalsForPlatform(text);
  const summary = parsed
    ? measuredCategories
      ? { ...parsed, categories: measuredCategories }
      : parsed
    : measuredCategories
      ? { categories: measuredCategories, subtotal: null, salesTax: null, grandTotal: null, taxLanes: [], deductible: null }
      : null;
  const labor: LaborCategoryTotal[] = [];
  let parts = 0;
  let misc = 0;
  let other = 0;
  let paintSupplies: PrintedTotals["paintSupplies"];
  for (const category of summary?.categories ?? []) {
    const label = category.category.trim();
    const cost = category.cost ?? 0;
    if (/paint\s*supplies|paint\s*materials/i.test(label)) {
      paintSupplies = { hours: category.hours ?? 0, rate: category.rate ?? 0, cost };
      continue;
    }
    if (/^parts/i.test(label)) { parts += cost; continue; }
    if (/^misc/i.test(label)) { misc += cost; continue; }
    if (/^other/i.test(label)) { other += cost; continue; }
    const mapped = CATEGORY.find(([re]) => re.test(label))?.[1];
    if (mapped) {
      labor.push({ category: mapped, hours: category.hours ?? 0, rate: category.rate ?? 0, cost });
      continue;
    }
    if (category.hours !== null && category.rate !== null) {
      labor.push({ category: "OTHER", hours: category.hours, rate: category.rate, cost });
    } else {
      other += cost;
    }
  }

  const taxLine = /Sales\s*Tax\s*\$?\s*([\d,]+\.\d{2})\s*@\s*([\d.]+)\s*%\s*\$?\s*([\d,]+\.\d{2})/i.exec(text);
  const salesTaxAmount = summary?.salesTax ?? (taxLine ? money(taxLine[3]) : null);
  const subtotal = summary?.subtotal ?? 0;
  const salesTax =
    salesTaxAmount !== null && salesTaxAmount !== 0
      ? {
          basis: taxLine ? money(taxLine[1]) : subtotal,
          ratePct: taxLine ? Number(taxLine[2]) : subtotal > 0 ? round2((salesTaxAmount / subtotal) * 100) : 0,
          amount: salesTaxAmount,
        }
      : null;

  const deductibleLine = /Deductible\s*-?\s*\$?\s*(-?[\d,]+\.\d{2})/i.exec(text);
  const netLine = /Net\s*Cost\s*(?:of\s*Repairs?)?\s*:?\s*(-?)\s*\$?\s*(-?[\d,]+\.\d{2})/i.exec(text);
  const deductible = summary?.deductible ?? (deductibleLine ? money(deductibleLine[1]) : null);
  const netCost = netLine ? money(netLine[2]) * (netLine[1] === "-" ? -1 : 1) : null;

  return {
    parts: round2(parts),
    labor,
    paintSupplies,
    misc: round2(misc),
    other: round2(other),
    subtotal: round2(subtotal),
    salesTax,
    grandTotal: round2(summary?.grandTotal ?? 0),
    deductible,
    netCost,
  };
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function buildHeader(text: string, platform: ReturnType<typeof detectEstimatePlatform>, fileName: string | null): EstimateHeader {
  const identity = readClaimIdentity(text);
  const system: EstimatingSystem =
    platform === "ccc" ? "CCC" : platform === "mitchell" ? "MITCHELL" : platform === "audatex" ? "AUDATEX" : "UNKNOWN";

  const documentTitle =
    /\b(Estimate of Record|Preliminary Estimate|Supplement of Record(?:\s+\d+)?|Supplement\s+\d+|Final Bill|Appraisal Report)\b/i.exec(text)?.[1] ??
    undefined;
  const workfileId = /Workfile\s*ID\s*:?[\s\S]{0,80}?\b([0-9a-f]{8})\b/i.exec(text)?.[1];
  const policyNo = /Policy\s*#\s*:?\s*(?!Claim)([A-Z0-9][A-Z0-9-]{3,})/i.exec(text)?.[1];
  const typeOfLoss = /Type\s*of\s*Loss\s*:?\s*([A-Za-z][A-Za-z /-]{2,30}?)(?=\s*(?:Date\s*of\s*Loss|Days|\n))/i.exec(text)?.[1]?.trim();
  const daysToRepairMatch = /Days\s*to\s*Repair\s*:?\s*(\d{1,3})\b/i.exec(text);
  const daysToRepair = daysToRepairMatch ? Number(daysToRepairMatch[1]) : null;
  const poi = /Point\s*of\s*Impact\s*:?\s*(\d{2})\s*([A-Za-z][^\n]{0,48})/i.exec(text);
  const pointOfImpact = poi ? { code: poi[1], label: poi[2].trim().replace(/\s+/g, " ") } : null;
  const writerMatch = /Written\s*By\s*:?\s*([A-Z][A-Za-z'.\- ]{2,60}?)(?:,\s*([A-Z0-9-]{4,}))?\s*(?=\n|Adjuster|Insured)/i.exec(text);
  const adjusterMatch = /Adjuster\s*:?\s*([A-Z][A-Za-z',.\- ]{2,60}?)(?=\s*(?:\(|\n|Insured|Owner|Claim))/i.exec(text);
  const adjusterPhone = adjusterMatch
    ? /\(\d{3}\)\s*\d{3}-\d{4}/.exec(text.slice(adjusterMatch.index, adjusterMatch.index + 120))?.[0]
    : undefined;
  const printedAt = /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}:\d{2}\s*[AP]M)/i.exec(text);
  const ownerName = identity.ownerTokens.length ? titleCase(identity.ownerTokens.join(" ")) : undefined;
  const ownerWindow = /\b(?:Owner|Insured)\s*:?\s*([^\n]{0,80})/i.exec(text)?.[1] ?? "";
  const ownerZip = selectOwnerOrInsuredZip(text);
  const ownerState = extractMarketPreviewState(text, ownerZip) ?? /\bState\s*:?\s*([A-Z]{2})\b/.exec(text)?.[1];
  const isGovernment = GOV.test(ownerWindow) || GOV.test(ownerName ?? "");

  const vehicleLine = identity.vehicle ?? "";
  const vehicleParts = /^((?:19|20)\d{2})\s+([A-Z][A-Z0-9-]*)\s+(.*)$/.exec(vehicleLine);
  const trim = vehicleParts?.[3] ?? "";
  const odometer = /Mileage\s*In\s*:?\s*([\d,]{2,7})\b/i.exec(text)?.[1];
  const exteriorColor = /Exterior\s*Color\s*:?\s*([A-Z][A-Za-z ]{2,20}?)(?=\s*(?:Mileage|Production|\n))/i.exec(text)?.[1]?.trim();
  const paintCode = /Paint\s*Code\s*:?\s*([A-Z0-9]{2,8})\b/i.exec(text)?.[1] ?? null;
  const interiorColor = /Interior\s*Color\s*:?\s*([A-Z][A-Za-z ]{2,20}?)(?=\s*(?:Mileage|Vehicle|\n))/i.exec(text)?.[1]?.trim() ?? null;
  const productionDate = /Production\s*Date\s*:?\s*(\d{1,2}\/\d{4})/i.exec(text)?.[1] ?? null;
  const options = collectOptions(text);
  const isPolice = /police|interceptor|pursuit/i.test(`${vehicleLine} ${fileName ?? ""}`);
  const isFleet = isPolice || /\bfleet\b/i.test(vehicleLine);

  const priorDamage = /Prior\s*Damage\s*:?\s*([^\n]{1,80})/i.exec(text)?.[1]?.trim() ?? null;
  const certificationText = /(I,\s+[^\n]{0,80}?\bcertify[\s\S]{0,400}?(?:\.|\n\n))/i.exec(text)?.[1]?.replace(/\s+/g, " ").trim() ?? null;

  return {
    system,
    documentTitle,
    claimNo: identity.claimNumber ?? undefined,
    workfileId,
    policyNo,
    typeOfLoss,
    dateOfLoss: identity.dateOfLoss ?? undefined,
    printedAt: printedAt ? `${printedAt[1]} ${printedAt[2]}` : undefined,
    daysToRepair,
    pointOfImpact,
    writer: writerMatch ? { name: writerMatch[1].trim(), license: writerMatch[2] } : undefined,
    adjuster: adjusterMatch ? { name: adjusterMatch[1].trim(), phone: adjusterPhone } : undefined,
    owner: ownerName || ownerState ? { name: ownerName, state: ownerState, isGovernment } : undefined,
    repairFacility: null,
    vehicle: {
      year: vehicleParts ? Number(vehicleParts[1]) : undefined,
      make: vehicleParts?.[2] ? normalizeMake(vehicleParts[2]) : undefined,
      model: trim ? trim.split(/\s+/).slice(0, 3).join(" ") : undefined,
      trim: trim || undefined,
      vin: identity.vin ?? undefined,
      odometer: odometer ? Number(odometer.replace(/,/g, "")) : undefined,
      exteriorColor,
      paintCode,
      interiorColor,
      productionDate,
      isFleet,
      isPolice,
      options,
    },
    priorDamageNote: priorDamage,
    certificationText,
  };
}

const MAKE_ALIASES: Record<string, string> = {
  LEXU: "Lexus", CHEV: "Chevrolet", TOYT: "Toyota", HOND: "Honda", NISS: "Nissan", HYUN: "Hyundai",
  VOLK: "Volkswagen", SUBA: "Subaru", MERZ: "Mercedes-Benz", MITS: "Mitsubishi", CHRY: "Chrysler",
  CADI: "Cadillac", LINC: "Lincoln", PONT: "Pontiac", PORS: "Porsche", INFI: "Infiniti", MAZD: "Mazda",
  ACUR: "Acura", VOLV: "Volvo", JAGU: "Jaguar", LNDR: "Land Rover", TESL: "Tesla", DODG: "Dodge",
};
function normalizeMake(token: string): string {
  const upper = token.toUpperCase();
  if (MAKE_ALIASES[upper]) return MAKE_ALIASES[upper];
  return upper.charAt(0) + upper.slice(1).toLowerCase();
}

function collectOptions(text: string): string[] {
  const wanted = [
    /blind spot/i, /side impact air bags?/i, /head\/curtain air bags?/i, /drivers? side air bag/i, /passenger air bag/i,
    /backup camera/i, /parking sensors?/i, /lane departure/i, /intelligent cruise/i, /xenon or l\.e\.d\. headlamps/i,
    /adaptive cruise/i, /collision warning/i, /360 camera/i, /surround view/i,
  ];
  const out: string[] = [];
  for (const re of wanted) {
    const match = re.exec(text);
    if (match) out.push(titleCase(match[0]));
  }
  return out;
}

function collectBoilerplate(text: string): string {
  const tail = text.slice(Math.max(0, text.length - 4000));
  return tail.replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */

const money = (value: string) => Number(value.replace(/[$,]/g, ""));
const round2 = (value: number) => Math.round(value * 100) / 100;
function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
