/**
 * Module B reader — CIECA EMS v2.01 export (WO-RK1 §4.1).
 *
 * An EMS export is a set of dBase III tables, one per extension (`.env`,
 * `.veh`, `.lin`, `.stl`, `.ttl`, …). The dBase header SELF-DESCRIBES its
 * fields, so nothing here hardcodes an offset or a column position: field
 * names and widths are read from the file. Producers vary in which optional
 * fields they write, so every field lookup takes a candidate list and reports
 * what it actually found.
 *
 * Read-only. Nothing in this module writes, imports, or generates a file for
 * any estimating system.
 *
 * Byte access is `Uint8Array`/`DataView` rather than `Buffer` so the same
 * reader runs unchanged in the browser and on the server.
 */

export type EmsValue = string | number | boolean | null;
export type EmsRecord = Record<string, EmsValue>;

export interface EmsTable {
  name: string;
  fields: Array<{ name: string; type: string; length: number; decimals: number }>;
  records: EmsRecord[];
}

export interface EmsBundle {
  tables: Map<string, EmsTable>;
  /** Tables present in the export, lowercased extension names. */
  tableNames: string[];
  errors: string[];
}

/**
 * Field-name candidates, in preference order.
 *
 * Every name here was read off a real CCC EMS v2.01 export. The guesses this
 * module shipped with matched almost none of them, so a line's part number,
 * price and hours all came back null even though the line itself collapsed
 * correctly. Order matters as much as spelling:
 *
 *   - ACT_PRICE is what the estimate BILLS, DB_PRICE what the database
 *     suggested; they differ wherever a price was overridden.
 *   - MOD_LB_HRS is the modified (billed) time, DB_HRS the database time. An
 *     included operation carries DB_HRS 4.6 with MOD_LB_HRS 0 and LBR_INC
 *     true, so reading DB_HRS would bill 4.6 hours the estimate never charged.
 */
const LINE_DESCRIPTION_FIELDS = ["LINE_DESC", "DESC", "LIN_DESC", "PART_DESC"];
const PART_NUMBER_FIELDS = ["OEM_PARTNO", "ALT_PARTNO", "PART_NO", "PART_NUM", "OEM_PART_NO"];
const PART_TYPE_FIELDS = ["PART_TYPE", "PRT_TYPE"];
const QTY_FIELDS = ["PART_QTY", "QTY", "UNITS"];
const PRICE_FIELDS = ["ACT_PRICE", "DB_PRICE", "PRICE", "PART_PRICE", "UNT_PRICE"];
const HOURS_FIELDS = ["MOD_LB_HRS", "LBR_HRS", "DB_HRS", "LABOR_HRS", "HRS"];

const DELETED_FLAG = 0x2a;
const FIELD_TERMINATOR = 0x0d;
const HEADER_FIELD_START = 32;
const FIELD_DESCRIPTOR_SIZE = 32;

/**
 * Parse one dBase III table.
 *
 * Returns null rather than throwing on a file that is not a dBase table: an
 * EMS export folder can carry a stray file, and one unreadable table must not
 * take the whole verification down.
 */
export function parseDbaseTable(name: string, bytes: Uint8Array): EmsTable | null {
  if (bytes.length < HEADER_FIELD_START + 1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  if (headerLength <= HEADER_FIELD_START || recordLength <= 0) return null;
  if (headerLength > bytes.length) return null;

  const fields: EmsTable["fields"] = [];
  let offset = HEADER_FIELD_START;
  while (offset + FIELD_DESCRIPTOR_SIZE <= headerLength) {
    if (bytes[offset] === FIELD_TERMINATOR) break;
    const rawName = bytes.subarray(offset, offset + 11);
    const terminator = rawName.indexOf(0);
    const fieldName = decodeLatin1(rawName.subarray(0, terminator === -1 ? 11 : terminator))
      .trim()
      .toUpperCase();
    if (!fieldName) break;
    fields.push({
      name: fieldName,
      type: String.fromCharCode(bytes[offset + 11]).toUpperCase(),
      length: bytes[offset + 16],
      decimals: bytes[offset + 17],
    });
    offset += FIELD_DESCRIPTOR_SIZE;
  }
  if (fields.length === 0) return null;

  const records: EmsRecord[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    if (start + recordLength > bytes.length) break;
    if (bytes[start] === DELETED_FLAG) continue;
    const record: EmsRecord = {};
    let cursor = start + 1;
    for (const field of fields) {
      const raw = decodeLatin1(bytes.subarray(cursor, cursor + field.length)).trim();
      cursor += field.length;
      record[field.name] = coerce(raw, field.type);
    }
    records.push(record);
  }

  return { name: name.toLowerCase(), fields, records };
}

/** dBase III stores single-byte characters; decode without a TextDecoder so
 *  the reader has no runtime-specific dependency. */
function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function coerce(raw: string, type: string): EmsValue {
  if (raw === "") return null;
  if (type === "N" || type === "F") {
    const value = Number(raw.replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
  }
  if (type === "L") {
    if (/^[TYty]$/.test(raw)) return true;
    if (/^[FNfn]$/.test(raw)) return false;
    return null;
  }
  return raw;
}

/**
 * Build a bundle from the files of an EMS export. Keys are the file extension
 * (the CIECA table name); a file with no recognizable dBase header is recorded
 * as an error and skipped.
 */
export function readEmsBundle(files: Array<{ filename: string; bytes: Uint8Array }>): EmsBundle {
  const tables = new Map<string, EmsTable>();
  const errors: string[] = [];
  for (const file of files) {
    const extension = (file.filename.split(".").pop() ?? "").toLowerCase();
    if (!extension || extension === file.filename.toLowerCase()) continue;
    // A .dbt is the dBase MEMO side-file, not a table. The EMS spec lists it
    // as optional and it carries no fields of its own, so skipping it is
    // normal and must not be reported as a fault in the export.
    if (extension === "dbt") continue;
    const table = parseDbaseTable(extension, file.bytes);
    if (!table) {
      errors.push(`${file.filename} is not a readable dBase table.`);
      continue;
    }
    // A repeated extension means duplicate exports in one bundle; the first
    // wins so the result is deterministic, and the collision is reported.
    if (tables.has(extension)) {
      errors.push(`More than one .${extension} table was supplied; the first was used.`);
      continue;
    }
    tables.set(extension, table);
  }
  return { tables, tableNames: [...tables.keys()].sort(), errors };
}

/** First present value among candidate field names, in order. */
export function pickField(record: EmsRecord | undefined, candidates: string[]): EmsValue {
  if (!record) return null;
  for (const candidate of candidates) {
    const value = record[candidate.toUpperCase()];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function pickNumber(record: EmsRecord | undefined, candidates: string[]): number | null {
  const value = pickField(record, candidates);
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function pickString(record: EmsRecord | undefined, candidates: string[]): string | null {
  const value = pickField(record, candidates);
  if (value === null) return null;
  return String(value).trim() || null;
}

export function pickBoolean(record: EmsRecord | undefined, candidates: string[]): boolean | null {
  const value = pickField(record, candidates);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^[TY]$/i.test(value)) return true;
    if (/^[FN]$/i.test(value)) return false;
  }
  return null;
}

/** One keyed line, with its labor records collapsed into a `labor[]` array —
 *  the inverse of the sheet's refinish folding. */
export interface EmsLine {
  lineNumber: number | null;
  description: string | null;
  partNumber: string | null;
  partType: string | null;
  qty: number | null;
  price: number | null;
  labor: Array<{ type: string | null; hours: number | null; included: boolean | null; opCode: string | null }>;
  misc: { amount: number; sublet: boolean; taxable: boolean | null } | null;
  /** Raw records this line collapsed, for evidence. */
  recordCount: number;
}

export interface EmsEstimate {
  estimatingSystem: string | null;
  emsVersion: string | null;
  vin: string | null;
  claimNumber: string | null;
  lines: EmsLine[];
  /** Subtotals by category code (LAB, LAR, LAM, PAT, MAPA, PAS…). */
  subtotals: Array<{ code: string; hours: number | null; amount: number | null }>;
  totals: { tax: number | null; grandTotal: number | null };
  profile: {
    laborRates: Array<{ code: string; rate: number | null }>;
    materialsRate: number | null;
    partsMarkups: Array<{ code: string; markupPct: number | null }>;
    taxRate: number | null;
  };
  recordCounts: Record<string, number>;
}

/**
 * Normalize a bundle into the shape the verification pass compares against.
 *
 * `lin` prints one record per labor type for a single estimate line (a replace
 * line becomes a LAB record and a LAR record), so records are collapsed on
 * line number.
 */
export function normalizeEmsEstimate(bundle: EmsBundle): EmsEstimate {
  const env = bundle.tables.get("env")?.records[0];
  const veh = bundle.tables.get("veh")?.records[0];
  const ad1 = bundle.tables.get("ad1")?.records[0];
  const linRecords = bundle.tables.get("lin")?.records ?? [];

  const byLine = new Map<string, EmsLine>();
  const order: string[] = [];
  for (const record of linRecords) {
    const lineNumber = pickNumber(record, ["LINE_NO", "LINE_NUM", "LIN_NO"]);
    const key = lineNumber === null ? `raw-${order.length}` : String(lineNumber);
    let line = byLine.get(key);
    if (!line) {
      line = {
        lineNumber,
        description: pickString(record, LINE_DESCRIPTION_FIELDS),
        partNumber: pickString(record, PART_NUMBER_FIELDS),
        partType: pickString(record, PART_TYPE_FIELDS),
        qty: pickNumber(record, QTY_FIELDS),
        price: pickNumber(record, PRICE_FIELDS),
        labor: [],
        misc: null,
        recordCount: 0,
      };
      byLine.set(key, line);
      order.push(key);
    }
    line.recordCount += 1;

    const laborType = pickString(record, ["MOD_LBR_TY", "LBR_TYPE", "LBR_TY"]);
    const hours = pickNumber(record, HOURS_FIELDS);
    const included = pickBoolean(record, ["LBR_INC", "LABOR_INC"]);
    const opCode = pickString(record, ["LBR_OP", "LABOR_OP", "OP_CODE"]);
    if (laborType || hours !== null || included !== null || opCode) {
      line.labor.push({ type: laborType, hours, included, opCode });
    }

    const miscAmount = pickNumber(record, ["MISC_AMT", "MISC_AMOUNT"]);
    if (miscAmount !== null) {
      line.misc = {
        amount: miscAmount,
        sublet: pickBoolean(record, ["MISC_SUBLT", "MISC_SUBLET"]) === true,
        taxable: pickBoolean(record, ["MISC_TAX", "MISC_TAXBL"]),
      };
    }
    // A later record may be the one carrying the part or price columns.
    if (line.partNumber === null) line.partNumber = pickString(record, PART_NUMBER_FIELDS);
    if (line.price === null) line.price = pickNumber(record, PRICE_FIELDS);
    if (line.qty === null) line.qty = pickNumber(record, QTY_FIELDS);
    if (line.partType === null) line.partType = pickString(record, PART_TYPE_FIELDS);
    if (line.description === null) line.description = pickString(record, LINE_DESCRIPTION_FIELDS);
  }

  // The subtotal table carries the GROUP in TTL_TYPE ("LA", "PA") and the
  // specific category in TTL_TYPECD ("LAB", "LAR", "PAT"). Reading the group
  // gave fourteen rows all labelled "LA", so body and refinish were
  // indistinguishable and nothing could reconcile against a source category.
  //
  // Rows whose hours and amount are both zero are dropped: a CCC export writes
  // the full grid of category codes whether or not the estimate uses them, and
  // on a real file that is 20-odd empty rows of noise in the totals table.
  const subtotals = (bundle.tables.get("stl")?.records ?? [])
    .map((record) => ({
      code: (pickString(record, ["TTL_TYPECD", "TTL_TYPE", "STL_TYPE", "TYPE", "CATEGORY"]) ?? "").toUpperCase(),
      hours: pickNumber(record, ["TTL_HRS", "T_HRS", "HOURS"]),
      amount: pickNumber(record, ["TTL_AMT", "T_AMT", "AMOUNT"]),
    }))
    .filter((entry) => entry.code && ((entry.hours ?? 0) !== 0 || (entry.amount ?? 0) !== 0));

  const ttl = bundle.tables.get("ttl")?.records[0];
  const profileLabor = (bundle.tables.get("pfl")?.records ?? []).map((record) => ({
    code: (pickString(record, ["LBR_TYPE", "MOD_LBR_TY", "TYPE"]) ?? "").toUpperCase(),
    rate: pickNumber(record, ["LBR_RATE", "CAL_LBRRTE", "RATE"]),
  }));
  // Paint materials sit under MATL_TYPE "MAPA" with the rate in CAL_LBRRTE.
  // The candidate list originally omitted MATL_TYPE, so on a real export the
  // record was never found and the materials rate — the setting §4.6 exists to
  // check — silently read as null.
  const materialsRecord = (bundle.tables.get("pfm")?.records ?? []).find((record) =>
    /MAPA/i.test(pickString(record, ["MATL_TYPE", "MTL_TYPE", "TYPE", "MOD_LBR_TY"]) ?? "")
  );
  const partsMarkups = (bundle.tables.get("pfp")?.records ?? []).map((record) => ({
    code: (pickString(record, ["PART_TYPE", "PRT_TYPE", "TYPE"]) ?? "").toUpperCase(),
    markupPct: pickNumber(record, ["PRT_MKUPP", "MKUP_PCT", "MARKUP"]),
  }));

  return {
    estimatingSystem: pickString(env, ["EST_SYSTEM", "ESTSYSTEM", "SYSTEM"]),
    emsVersion: pickString(env, ["EMS_VER", "EMSVER", "VERSION"]),
    vin: pickString(veh, ["V_VIN", "VIN"]),
    claimNumber: pickString(ad1, ["CLM_NO", "CLAIM_NO", "CLAIM"]),
    lines: order.map((key) => byLine.get(key)!),
    subtotals,
    totals: {
      tax: pickNumber(ttl, ["G_TAX", "TOT_TAX", "TAX"]),
      grandTotal: pickNumber(ttl, ["G_TTL_AMT", "GRAND_TTL", "TOTAL"]),
    },
    profile: {
      laborRates: profileLabor,
      materialsRate: pickNumber(materialsRecord, ["CAL_LBRRTE", "MTL_RATE", "RATE"]),
      partsMarkups,
      taxRate: readTaxRate(bundle.tables.get("pft")?.records[0]),
    },
    recordCounts: Object.fromEntries([...bundle.tables].map(([name, table]) => [name, table.records.length])),
  };
}

/**
 * Effective tax rate from the profile's tax table.
 *
 * The table is not a single percentage: it holds up to six tax TYPES, each
 * with five threshold tiers (TAX_TYPE1 / TY1_RATE1, TAX_TYPE2 / TY2_RATE1 …).
 * A jurisdiction that stacks a state and a county tax populates two of them,
 * so the rate that actually applies is the sum of the first-tier rates of
 * every populated type. Reading a "TAX_RATE" field that no export has
 * returned null on every real file.
 */
export function readTaxRate(record: EmsRecord | undefined): number | null {
  if (!record) return null;
  let total: number | null = null;
  for (let type = 1; type <= 6; type += 1) {
    if (!pickString(record, [`TAX_TYPE${type}`])) continue;
    const rate = pickNumber(record, [`TY${type}_RATE1`]);
    if (rate === null || rate === 0) continue;
    total = (total ?? 0) + rate;
  }
  return total ?? pickNumber(record, ["TAX_PCT", "TAX_RATE", "RATE"]);
}

export interface EmsGateResult {
  ok: boolean;
  reason?: string;
}

/**
 * Fail closed (WO-RK1 §4.1): no estimating system, no EMS version, or no line
 * records means no report at all. A verification built on an empty or
 * unidentified export would be a fabricated pass.
 */
export function gateEmsEstimate(estimate: EmsEstimate): EmsGateResult {
  if (!estimate.estimatingSystem) {
    return { ok: false, reason: "The export does not identify an estimating system, so it cannot be verified." };
  }
  // RV-7: verification proves a CCC rekey against its source, so the keyed
  // side must be the CCC workfile's own export. A real CCC export writes the
  // CIECA code "C" (F-RK1a); the platform name is accepted as well. An export
  // from another platform is a cross-platform comparison, not a rekey.
  if (!/^c$|ccc/i.test(estimate.estimatingSystem.trim())) {
    return {
      ok: false,
      reason: `The export was written by estimating system "${estimate.estimatingSystem.trim()}", not CCC ONE. Verification proves a CCC rekey against its source; an export from another platform is a cross-platform comparison, which is the Estimate Delta report.`,
    };
  }
  if (!estimate.emsVersion) {
    return { ok: false, reason: "The export does not carry an EMS version, so it cannot be verified." };
  }
  if (estimate.lines.length === 0) {
    return { ok: false, reason: "The export contains no estimate lines, so there is nothing to verify." };
  }
  return { ok: true };
}
