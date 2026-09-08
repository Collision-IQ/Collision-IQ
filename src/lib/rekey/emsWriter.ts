/**
 * Module B writer — a CIECA EMS v2.01 export built from a rekey sheet.
 *
 * WHAT THIS IS FOR. An EMS export is the open interchange form of the sheet's
 * own translation — the CCC group, the operation code, the labor type, the
 * part type, the price and the taxability — written into a format estimating
 * and appraisal systems already read, instead of being retyped by hand. That
 * much is certain: the format is published, and an IA platform consuming it is
 * a use this build serves today.
 *
 * WHETHER IT IMPORTS INTO CCC ONE IS NOT SETTLED, and this header used to say
 * it was. CCC's own pages disagree with each other: "Importing EMS Assignments
 * and Estimates" says assignments AND estimates import automatically and gives
 * an imported estimate its own Workfiles status, while "Overview - File Import
 * and Export Settings" lists what can be imported as "EMS files (assignments)"
 * and puts EMS 2.01 ESTIMATE files on the export side only. The shop's own
 * account matches the second: EMS out, AWF in. Nobody has run the test on a
 * machine with a CIECA/EMS import directory configured, so this module claims
 * only what it can: it writes a valid EMS 2.01 export. Where that export is
 * accepted is `docs/ccc-writeback-scope.md`'s open question, not this file's
 * assertion.
 *
 * WHAT IT IS NOT. It is pre-population, not a rekey. An EMS line this writer
 * produces carries no database reference and no database labor time, because
 * this build holds neither: those belong to the receiving system's own parts
 * and labor database, and inventing one would be fabricating evidence. Every
 * line lands as a manually entered line. `buildEmsExport` says so in its notes
 * rather than leaving the caller to discover it. See
 * `docs/ccc-writeback-scope.md`.
 *
 * NO AWF. WO-RK1 §1 stands: no workfile copy is generated, read, or
 * reverse-engineered here. EMS is an open CIECA interchange format, and the
 * table schemas are read from the field headers of a real export rather than
 * guessed — `data/emsTableSchema.json`, generated from
 * `tests/fixtures/ems-ccc-1259209948`.
 *
 * The acceptance test is a round trip: write the tables, read them back with
 * this repository's own EMS reader, and run the verification pass against the
 * sheet they came from. Zero findings, or the export is wrong.
 */

import SCHEMA from "./data/emsTableSchema.json";
import VOCABULARY from "./data/rekeyVocabulary.json";
import type { RekeyLedgerRow, RekeySheet } from "./rekeyTypes";
import { totalsCategoryCode } from "./rekeyVerification";

type SchemaField = [name: string, type: string, length: number, decimals: number];
const TABLE_SCHEMA = (SCHEMA as unknown as { tables: Record<string, SchemaField[]> }).tables;

/** The roll-up codes an export's subtotal table carries, and their members —
 *  the same table the reader and the verification read. */
const ROLL_UPS = (VOCABULARY.totalsCategories as Array<{ ems: string; rollUpOf?: string[] }>)
  .filter((entry) => entry.rollUpOf?.length)
  .map((entry) => ({ code: entry.ems, members: entry.rollUpOf as string[] }));

/**
 * The writer is ON, and can be turned off.
 *
 * It shipped opt-in because what it produces is handed to a live estimating
 * system and nothing here can prove what that system does with it. That is
 * still true — and it argues for saying so, not for withholding the file. A
 * build that cannot produce the export cannot be tested against any receiving
 * system at all, which is the position it was in: every download offered a PDF
 * to key from and a ledger, and no artifact any system reads.
 *
 * So the export is produced, and what is unproven is stated where it is read —
 * in the notes returned beside the download, and in this module's header.
 * `REKEY_EMS_WRITER_ENABLED=false` turns it off for a deployment that wants it
 * gone.
 */
export function isRekeyEmsWriterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REKEY_EMS_WRITER_ENABLED !== "false";
}

export type EmsWriterValue = string | number | boolean | Date | null | undefined;
export type EmsWriterRecord = Record<string, EmsWriterValue>;
export type EmsWriterFile = { filename: string; bytes: Uint8Array };

const DBASE_III = 0x03;
/** dBase with a memo file beside it — what a table declaring an M field must
 *  say it is, and what the reference export's own `.veh` says. */
const DBASE_WITH_MEMO = 0x8b;
const FIELD_TERMINATOR = 0x0d;
const FILE_TERMINATOR = 0x1a;
const HEADER_FIELD_START = 32;
const FIELD_DESCRIPTOR_SIZE = 32;

/** The estimate-version tag CCC writes on every line of a first estimate. */
const ESTIMATE_VERSION = "E01";
/** Transaction code on a LINE: this record is an addition. */
const TRANSACTION_ADD = "1";
/**
 * The envelope's own transaction fields, read off the reference export rather
 * than chosen: it writes TRANS_TYPE "E" and STATUS "F" on an estimate. This
 * writer wrote the line-level "1" into TRANS_TYPE, which is a code from a
 * different column — a receiving system switching on it finds a value the
 * reference never writes.
 */
const ENVELOPE_TRANS_TYPE = "E";
/** STATUS is a LOGICAL field, one byte, and the reference writes F in it. */
const ENVELOPE_STATUS = false;

function ascii(text: string, length: number, pad = 32): number[] {
  const out: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const code = index < text.length ? text.charCodeAt(index) : pad;
    // dBase III is single-byte. A character outside it is written as the pad
    // byte rather than as a truncated multi-byte sequence that would shift the
    // fixed-width record and corrupt every field after it.
    out.push(code > 0 && code < 256 ? code : pad);
  }
  return out;
}

/** Format one value for its declared field, right-aligned for numbers and
 *  left-aligned for text, exactly as dBase III stores them. */
export function formatDbaseValue(value: EmsWriterValue, field: SchemaField): string {
  const [, type, length, decimals] = field;
  if (value === null || value === undefined || value === "") return " ".repeat(length);
  if (type === "N" || type === "F") {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return " ".repeat(length);
    const text = numeric.toFixed(decimals);
    return text.length > length ? "*".repeat(length) : text.padStart(length, " ");
  }
  if (type === "L") {
    if (typeof value === "boolean") return value ? "T" : "F";
    return " ".repeat(length);
  }
  if (type === "D") {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return " ".repeat(length);
    const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(
      date.getUTCDate()
    ).padStart(2, "0")}`;
    return stamp.padEnd(length, " ").slice(0, length);
  }
  return String(value).padEnd(length, " ").slice(0, length);
}

/**
 * The memo side-file a table with an M field points into.
 *
 * This writer carries no memo content — the memo pointers it writes are blank,
 * which is how dBase says "this record has none" — but a table that DECLARES a
 * memo field and has no `.dbt` beside it is a broken set. So the file is
 * written with its header block and nothing else: the next free block is 1,
 * because no memo has been allocated, and the stem names the set it belongs
 * to, exactly as the reference export's own header block does.
 */
export function writeMemoFile(stem: string): Uint8Array {
  const BLOCK = 512;
  const bytes = new Uint8Array(BLOCK);
  new DataView(bytes.buffer).setUint32(0, 1, true);
  bytes.set(ascii(stem.toLowerCase().slice(0, 8), 8), 8);
  return bytes;
}

/**
 * Write one dBase III table. Fields come from the schema, so a field this
 * writer has no value for is written blank at its declared width rather than
 * omitted — a fixed-width record with a missing field is not a table.
 */
export function writeDbaseTable(params: {
  fields: SchemaField[];
  records: EmsWriterRecord[];
  now?: Date;
}): Uint8Array {
  const { fields, records } = params;
  const now = params.now ?? new Date();
  const recordLength = 1 + fields.reduce((total, field) => total + field[2], 0);
  const headerLength = HEADER_FIELD_START + fields.length * FIELD_DESCRIPTOR_SIZE + 1;
  const bytes = new Uint8Array(headerLength + records.length * recordLength + 1);
  const view = new DataView(bytes.buffer);

  bytes[0] = fields.some((field) => field[1] === "M") ? DBASE_WITH_MEMO : DBASE_III;
  bytes[1] = now.getUTCFullYear() - 1900;
  bytes[2] = now.getUTCMonth() + 1;
  bytes[3] = now.getUTCDate();
  view.setUint32(4, records.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);

  let offset = HEADER_FIELD_START;
  for (const field of fields) {
    const [name, type, length, decimals] = field;
    // A field NAME is null-terminated and null-padded, not space-padded — the
    // one place in a dBase III file where the pad byte is 0x00. Padding it
    // with spaces writes the name as "INS_CO_ID  ", and a reader that takes
    // the descriptor at its word has a field whose name matches nothing. Our
    // own reader trims, which is exactly why this survived a round trip:
    // measured against the reference export, every descriptor differed in
    // those trailing bytes and in nothing else.
    const label = ascii(name.toUpperCase(), 11, 0);
    bytes.set(label, offset);
    bytes[offset + 11] = type.charCodeAt(0);
    bytes[offset + 16] = length;
    bytes[offset + 17] = decimals;
    offset += FIELD_DESCRIPTOR_SIZE;
  }
  bytes[offset] = FIELD_TERMINATOR;
  offset += 1;

  for (const record of records) {
    bytes[offset] = 32; // not deleted
    offset += 1;
    for (const field of fields) {
      const text = formatDbaseValue(record[field[0]], field);
      bytes.set(ascii(text, field[2]), offset);
      offset += field[2];
    }
  }
  bytes[offset] = FILE_TERMINATOR;
  return bytes;
}

/** The labor types an EMS line can bill, in the order a sheet lists them. */
function laborRecords(row: RekeyLedgerRow): Array<{ type: string; hours: number; included: boolean }> {
  return row.labor.map((entry: RekeyLedgerRow["labor"][number]) => ({
    type: entry.type,
    hours: entry.included ? 0 : entry.hours,
    included: entry.included,
  }));
}

/** Every group the sheet keys, in keying order, with its rows. */
function groupsOf(sheet: RekeySheet): Array<{ group: string; rows: RekeyLedgerRow[] }> {
  return sheet.groups.map((group) => ({
    group: group.group,
    rows: group.rows.filter((row) => row.keyable),
  }));
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round1 = (value: number) => Math.round(value * 10) / 10;

function profileValue(sheet: RekeySheet, field: string): number | null {
  return sheet.profile.find((entry) => entry.field === field)?.value ?? null;
}

/**
 * Build the EMS export.
 *
 * Returns the files an estimating system's import folder expects, plus the
 * notes that must travel with them — what was written, and what no export
 * built from a translated estimate can carry.
 */
export function buildEmsExport(params: {
  sheet: RekeySheet;
  /** The 8-character file stem an EMS export shares across its tables. */
  stem?: string;
  /**
   * The CIECA code in `.env EST_SYSTEM` — the estimating system the file
   * presents itself as coming from, which is what a receiving system reads to
   * decide how to interpret the file. Both real exports here carry "C".
   *
   * Nothing is defaulted. This build is not an estimating system and has no
   * code of its own, so asserting one would be a claim about provenance that
   * nobody made; left unset, the field is blank and the notes say the file
   * identifies no producer. The caller decides what the file claims to be.
   */
  estimatingSystem?: string | null;
  now?: Date;
}): { files: EmsWriterFile[]; notes: string[]; lineCount: number } {
  const { sheet } = params;
  const now = params.now ?? new Date();
  const stem = (params.stem ?? "rekey001").slice(0, 8);
  const notes: string[] = [];

  // §4.1 .lin — one record per labor type on a line, and a heading record per
  // group, which is how the reference export carries the group taxonomy.
  const lin: EmsWriterRecord[] = [];
  let lineNumber = 0;
  let sequence = 0;
  for (const { group, rows } of groupsOf(sheet)) {
    if (rows.length === 0) continue;
    lineNumber += 1;
    sequence += 1;
    lin.push({
      LINE_NO: lineNumber,
      LINE_IND: ESTIMATE_VERSION,
      TRAN_CODE: TRANSACTION_ADD,
      UNQ_SEQ: sequence,
      LINE_DESC: group,
    });
    for (const row of rows) {
      lineNumber += 1;
      sequence += 1;
      const base: EmsWriterRecord = {
        LINE_NO: lineNumber,
        LINE_IND: ESTIMATE_VERSION,
        TRAN_CODE: TRANSACTION_ADD,
        UNQ_SEQ: sequence,
        LINE_DESC: row.descriptionTarget,
        PART_TYPE: row.partTypeEms,
        OEM_PARTNO: row.partNumber,
        PART_QTY: row.qty,
        DB_PRICE: row.price,
        ACT_PRICE: row.price,
        PRICE_INC: row.labor.some((entry) => entry.included) ? true : null,
        TAX_PART: row.price !== null ? row.taxable : null,
        MISC_AMT: row.misc?.amount ?? null,
        MISC_SUBLT: row.misc ? row.misc.sublet : null,
        MISC_TAX: row.misc ? row.misc.taxable : null,
        LBR_OP: row.laborOpCode,
      };
      const labor = laborRecords(row);
      if (labor.length === 0) {
        lin.push(base);
        continue;
      }
      for (const entry of labor) {
        lin.push({
          ...base,
          MOD_LBR_TY: entry.type,
          MOD_LB_HRS: entry.hours,
          LBR_INC: entry.included ? true : null,
          LBR_TAX: entry.hours > 0 ? row.taxable : null,
        });
      }
    }
  }

  // §4.5 .stl — the category subtotals, from the sheet's own derived totals so
  // the export states what the rows add up to rather than a second arithmetic.
  //
  // An export's subtotal table is built of MEMBERS and the roll-ups over them:
  // on both real exports here, PAT = PAN + PAO + PAS, LAT = LAB + LAR + LAM and
  // MAT = MAPA + MASH + MA2S + MABL. A print states the member figure — its
  // "Parts" line excludes the sublet it prints below — so writing that figure
  // under the roll-up code would claim a total that includes money it does not.
  // Each printed category is written under its own code, a category that maps
  // to a roll-up is written under that roll-up's first member instead, and the
  // roll-ups are then summed from what was written.
  const byCode = new Map<string, { hours: number | null; amount: number | null }>();
  for (const category of sheet.derivedTotals?.categories ?? []) {
    const mapped = totalsCategoryCode(category.category);
    if (!mapped.comparable) continue;
    const rollUp = ROLL_UPS.find((entry) => entry.code === mapped.code);
    const code = rollUp ? rollUp.members[0] : mapped.code;
    const existing = byCode.get(code);
    byCode.set(code, {
      hours: category.hours ?? existing?.hours ?? null,
      amount: round2((existing?.amount ?? 0) + category.cost),
    });
  }
  for (const { code, members } of ROLL_UPS) {
    const present = members.map((member) => byCode.get(member)).filter(Boolean) as Array<{
      hours: number | null;
      amount: number | null;
    }>;
    if (present.length === 0) continue;
    byCode.set(code, {
      hours: present.some((entry) => entry.hours !== null)
        ? round1(present.reduce((total, entry) => total + (entry.hours ?? 0), 0))
        : null,
      amount: round2(present.reduce((total, entry) => total + (entry.amount ?? 0), 0)),
    });
  }
  const stl: EmsWriterRecord[] = [...byCode].map(([code, value]) => ({
    TTL_TYPECD: code,
    T_HRS: value.hours,
    T_AMT: value.amount,
    TTL_HRS: value.hours,
    TTL_AMT: value.amount,
  }));

  const ttl: EmsWriterRecord[] = [
    {
      G_TTL_AMT: sheet.derivedTotals?.grandTotal ?? sheet.expectedTotals?.grandTotal ?? null,
      N_TTL_AMT: sheet.derivedTotals?.grandTotal ?? sheet.expectedTotals?.grandTotal ?? null,
      G_TAX: sheet.derivedTotals?.tax ?? sheet.expectedTotals?.tax ?? null,
    },
  ];

  const env: EmsWriterRecord[] = [
    {
      EST_SYSTEM: params.estimatingSystem ?? null,
      ESTFILE_ID: stem,
      EST_CTRY: "USA",
      UNQFILE_ID: stem,
      RO_ID: sheet.identity.roNumber,
      SUPP_NO: ESTIMATE_VERSION,
      TRANS_TYPE: ENVELOPE_TRANS_TYPE,
      STATUS: ENVELOPE_STATUS,
      CREATE_DT: now,
      CREATE_TM: `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(
        now.getUTCSeconds()
      ).padStart(2, "0")}`,
      // The transmission stamp is left blank, as the reference leaves it: this
      // file was written, not transmitted, and nothing here knows when or
      // whether it will be.
      TRANSMT_DT: null,
      INCL_ADMIN: true,
      INCL_VEH: true,
      INCL_EST: true,
      INCL_PROFL: true,
      INCL_TOTAL: true,
      // The include flags say which tables are in the set, and the vendor
      // table is now one of them.
      INCL_VENDR: true,
      // SW_VERSION, DB_VERSION and DB_DATE stay blank on purpose. They name
      // the software and the parts-and-labor database that produced a file;
      // writing the reference's values would claim this export came out of
      // that system's release, which is a lie about provenance rather than a
      // format detail. TOP_SECRET is that system's own workfile identifier and
      // means nothing coming from here.
      EMS_VER: "2.01",
    },
  ];

  const veh: EmsWriterRecord[] = [{ V_VIN: sheet.identity.vin, V_MODEL: sheet.identity.vehicle }];
  const ad1: EmsWriterRecord[] = [{ CLM_NO: sheet.identity.claimNumber }];

  // §4.6 the profile — the settings the sheet tells the estimator to set before
  // keying, written so the receiving system starts from them.
  const laborRates: Array<[string, string]> = [
    ["LAB", "Body rate (LAB)"],
    ["LAR", "Paint rate (LAR)"],
    ["LAM", "Mechanical rate (LAM)"],
  ];
  const pfl: EmsWriterRecord[] = laborRates
    .filter(([, field]) => profileValue(sheet, field) !== null)
    .map(([code, field]) => ({ LBR_TYPE: code, LBR_RATE: profileValue(sheet, field) }));
  const materialsRate = profileValue(sheet, "Paint supplies rate (MAPA)");
  const pfm: EmsWriterRecord[] =
    materialsRate === null ? [] : [{ MATL_TYPE: "MAPA", CAL_LBRRTE: materialsRate }];
  const subletMarkup = profileValue(sheet, "Sublet parts markup");
  const pfp: EmsWriterRecord[] = subletMarkup === null ? [] : [{ PRT_TYPE: "PAS", PRT_MKUPP: subletMarkup }];
  const taxRate = sheet.derivedTotals?.taxRate?.rate ?? null;
  const pft: EmsWriterRecord[] = taxRate === null ? [] : [{ TAX_TYPE1: "LS", TY1_TIER1: 1, TY1_RATE1: taxRate * 100 }];

  // §4.7 the four tables the sheet has no values for, written anyway.
  //
  // The reference export of this same claim carries fourteen tables; this
  // writer carried ten, and an importer reading a set by extension would find
  // four of them missing. They are written STRUCTURALLY: one record, every
  // field at its declared width, every value blank — which is not a
  // degradation of them, because the system that wrote the reference export
  // left `.ad2` and `.ven` entirely blank itself.
  //
  // Blank rather than borrowed, deliberately. `.pfo` holds tow and storage tax
  // settings and `.ad2` the estimator, inspection and repair-facility record;
  // a rekey sheet states none of them, and the reference specimen's values are
  // another shop's profile. `.pfh` holds general tax settings, and the tax
  // this build did derive is already written once, in `.pft` — writing it
  // twice invites the two to disagree. Everything blank here is governed by
  // the receiving profile, which is what the notes have always said.
  const emptyRecord: EmsWriterRecord[] = [{}];

  const written: Array<[string, EmsWriterRecord[]]> = [
    ["env", env],
    ["veh", veh],
    ["ad1", ad1],
    ["lin", lin],
    ["stl", stl],
    ["ttl", ttl],
    ["pfl", pfl],
    ["pfm", pfm],
    ["pfp", pfp],
    ["pft", pft],
    ["ad2", emptyRecord],
    ["pfh", emptyRecord],
    ["pfo", emptyRecord],
    ["ven", emptyRecord],
  ];

  // Every table in the set is written, whatever the sheet knows. A table whose
  // values the sheet does not state is written with one blank record rather
  // than left out: an importer that reads a set by extension finds a short set
  // missing, not empty, and cannot tell the difference between "this estimate
  // states no sublet markup" and "this file is incomplete".
  const files = written.map(([extension, records]) => ({
    filename: `${stem}.${extension}`,
    bytes: writeDbaseTable({
      fields: TABLE_SCHEMA[extension],
      records: records.length > 0 ? records : emptyRecord,
      now,
    }),
  }));
  // A set whose tables declare a memo field carries the memo file those
  // pointers refer to, even when every pointer in it is blank.
  if (written.some(([extension]) => TABLE_SCHEMA[extension].some((field) => field[1] === "M"))) {
    files.push({ filename: `${stem}.dbt`, bytes: writeMemoFile(stem) });
  }

  notes.push(
    "Every line in this export imports as a MANUALLY ENTERED line. It carries no database reference and no database labor time, because a translated estimate has neither: those belong to the receiving system's own parts and labor database. Re-select the database entry on any line that needs the receiving system's own times or price updates."
  );
  notes.push(
    "The file set is the fourteen tables a real export of this format carries. Four of them — the estimator and repair-facility record, the general tax settings, the tow and storage tax settings, and the vendor record — are written with their fields present and blank, because a rekey sheet states none of them and borrowing another estimate's values would be inventing a profile. What is blank is governed by the receiving profile.",
    "The profile tables carry only the settings the sheet states — labor rates, the paint materials rate, the sublet markup and the tax rate. Every other profile setting stays whatever the receiving profile already holds."
  );
  if (sheet.rows.some((row) => !row.keyable)) {
    const held = sheet.rows.filter((row) => !row.keyable).length;
    notes.push(
      `${held} row${held === 1 ? "" : "s"} the sheet marks "do not key" ${held === 1 ? "is" : "are"} not in this export; ${held === 1 ? "it belongs" : "they belong"} in the profile block instead.`
    );
  }
  if (sheet.identity.vin === null) notes.push("The source printed no VIN, so the export carries none.");
  if (!params.estimatingSystem) {
    notes.push(
      "The export identifies no estimating system in EST_SYSTEM. This build is not an estimating system and has no CIECA code of its own; set the code the receiving system expects before importing."
    );
  }

  return { files, notes, lineCount: lineNumber };
}
