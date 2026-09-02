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
        description: pickString(record, ["LINE_DESC", "DESC", "LIN_DESC", "PART_DESC"]),
        partNumber: pickString(record, ["PART_NO", "PART_NUM", "OEM_PART_NO"]),
        partType: pickString(record, ["PART_TYPE", "PRT_TYPE"]),
        qty: pickNumber(record, ["QTY", "PART_QTY", "UNITS"]),
        price: pickNumber(record, ["PRICE", "PART_PRICE", "UNT_PRICE"]),
        labor: [],
        misc: null,
        recordCount: 0,
      };
      byLine.set(key, line);
      order.push(key);
    }
    line.recordCount += 1;

    const laborType = pickString(record, ["MOD_LBR_TY", "LBR_TYPE", "LBR_TY"]);
    const hours = pickNumber(record, ["LBR_HRS", "LABOR_HRS", "HRS"]);
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
    if (line.partNumber === null) line.partNumber = pickString(record, ["PART_NO", "PART_NUM", "OEM_PART_NO"]);
    if (line.price === null) line.price = pickNumber(record, ["PRICE", "PART_PRICE", "UNT_PRICE"]);
    if (line.qty === null) line.qty = pickNumber(record, ["QTY", "PART_QTY", "UNITS"]);
    if (line.partType === null) line.partType = pickString(record, ["PART_TYPE", "PRT_TYPE"]);
    if (line.description === null) {
      line.description = pickString(record, ["LINE_DESC", "DESC", "LIN_DESC", "PART_DESC"]);
    }
  }

  const subtotals = (bundle.tables.get("stl")?.records ?? []).map((record) => ({
    code: (pickString(record, ["TTL_TYPE", "STL_TYPE", "TYPE", "CATEGORY"]) ?? "").toUpperCase(),
    hours: pickNumber(record, ["T_HRS", "TTL_HRS", "HOURS"]),
    amount: pickNumber(record, ["TTL_AMT", "T_AMT", "AMOUNT"]),
  }));

  const ttl = bundle.tables.get("ttl")?.records[0];
  const profileLabor = (bundle.tables.get("pfl")?.records ?? []).map((record) => ({
    code: (pickString(record, ["LBR_TYPE", "MOD_LBR_TY", "TYPE"]) ?? "").toUpperCase(),
    rate: pickNumber(record, ["LBR_RATE", "CAL_LBRRTE", "RATE"]),
  }));
  const materialsRecord = (bundle.tables.get("pfm")?.records ?? []).find((record) =>
    /MAPA/i.test(pickString(record, ["MTL_TYPE", "TYPE", "MOD_LBR_TY"]) ?? "")
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
      taxRate: pickNumber(bundle.tables.get("pft")?.records[0], ["TAX_PCT", "TAX_RATE", "RATE"]),
    },
    recordCounts: Object.fromEntries([...bundle.tables].map(([name, table]) => [name, table.records.length])),
  };
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
  if (!estimate.emsVersion) {
    return { ok: false, reason: "The export does not carry an EMS version, so it cannot be verified." };
  }
  if (estimate.lines.length === 0) {
    return { ok: false, reason: "The export contains no estimate lines, so there is nothing to verify." };
  }
  return { ok: true };
}
