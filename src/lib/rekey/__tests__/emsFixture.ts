/**
 * Minimal dBase III writer used to build synthetic EMS tables in tests.
 *
 * The reader must take its layout from the file header rather than from
 * hardcoded offsets, so the fixture writer varies field widths and order
 * freely — a reader that assumed positions would fail against it.
 */

export type DbaseField = { name: string; type: "C" | "N" | "L"; length: number; decimals?: number };

export function writeDbaseTable(fields: DbaseField[], records: Array<Record<string, string | number | boolean | null>>): Uint8Array {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0);
  const bytes = new Uint8Array(headerLength + records.length * recordLength + 1);
  const view = new DataView(bytes.buffer);

  bytes[0] = 0x03;
  bytes[1] = 26;
  bytes[2] = 9;
  bytes[3] = 2;
  view.setUint32(4, records.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);

  fields.forEach((field, index) => {
    const offset = 32 + index * 32;
    for (let position = 0; position < Math.min(field.name.length, 10); position += 1) {
      bytes[offset + position] = field.name.charCodeAt(position);
    }
    bytes[offset + 11] = field.type.charCodeAt(0);
    bytes[offset + 16] = field.length;
    bytes[offset + 17] = field.decimals ?? 0;
  });
  bytes[32 + fields.length * 32] = 0x0d;

  records.forEach((record, index) => {
    let cursor = headerLength + index * recordLength;
    bytes[cursor] = 0x20;
    cursor += 1;
    for (const field of fields) {
      const value = record[field.name];
      let text: string;
      if (value === null || value === undefined) text = "";
      else if (typeof value === "boolean") text = value ? "T" : "F";
      else if (typeof value === "number") text = value.toFixed(field.decimals ?? 0);
      else text = value;
      const padded =
        field.type === "N" ? text.padStart(field.length, " ") : text.padEnd(field.length, " ");
      const clipped = padded.slice(0, field.length);
      for (let position = 0; position < field.length; position += 1) {
        bytes[cursor + position] = clipped.charCodeAt(position) || 0x20;
      }
      cursor += field.length;
    }
  });
  bytes[bytes.length - 1] = 0x1a;
  return bytes;
}

/** A synthetic EMS export of the keyed estimate that matches the source fixture. */
export function buildEmsExportFiles(overrides?: {
  vin?: string;
  claimNumber?: string;
  lines?: Array<Record<string, string | number | boolean | null>>;
  emptyLines?: boolean;
  partsMarkupPct?: number;
  estimatingSystem?: string;
}): Array<{ filename: string; bytes: Uint8Array }> {
  const env = writeDbaseTable(
    [
      { name: "EST_SYSTEM", type: "C", length: 20 },
      { name: "EMS_VER", type: "C", length: 8 },
    ],
    // "C" is the CIECA code a real CCC export writes (F-RK1a); verification is
    // only defined against a CCC workfile, so the synthetic export says so too.
    [{ EST_SYSTEM: overrides?.estimatingSystem ?? "C", EMS_VER: "2.01" }]
  );
  const veh = writeDbaseTable([{ name: "V_VIN", type: "C", length: 17 }], [
    { V_VIN: overrides?.vin ?? "1FTFW1E84PKE00000" },
  ]);
  const ad1 = writeDbaseTable([{ name: "CLM_NO", type: "C", length: 20 }], [
    { CLM_NO: overrides?.claimNumber ?? "TESTCLAIM0001" },
  ]);

  const linFields: DbaseField[] = [
    { name: "LINE_NO", type: "N", length: 4 },
    { name: "LINE_DESC", type: "C", length: 40 },
    { name: "PART_NO", type: "C", length: 20 },
    { name: "PART_TYPE", type: "C", length: 4 },
    { name: "QTY", type: "N", length: 5, decimals: 1 },
    { name: "PRICE", type: "N", length: 10, decimals: 2 },
    { name: "MOD_LBR_TY", type: "C", length: 4 },
    { name: "LBR_HRS", type: "N", length: 7, decimals: 1 },
    { name: "LBR_OP", type: "C", length: 5 },
    { name: "LBR_INC", type: "L", length: 1 },
    { name: "MISC_AMT", type: "N", length: 10, decimals: 2 },
    { name: "MISC_SUBLT", type: "L", length: 1 },
    { name: "MISC_TAX", type: "L", length: 1 },
  ];

  const defaultLines: Array<Record<string, string | number | boolean | null>> = [
    { LINE_NO: 1, LINE_DESC: "Hood Panel Alum", PART_NO: "FO1230344C", PART_TYPE: "PAN", QTY: 1, PRICE: 776, MOD_LBR_TY: "LAB", LBR_HRS: 1.6, LBR_OP: "OP11", LBR_INC: false },
    { LINE_NO: 1, LINE_DESC: "Hood Panel Alum", MOD_LBR_TY: "LAR", LBR_HRS: 7.0, LBR_OP: "OP11", LBR_INC: false },
    { LINE_NO: 2, LINE_DESC: "Bumper Cover", MOD_LBR_TY: "LAB", LBR_HRS: 0.8, LBR_OP: "OP2", LBR_INC: false },
  ];

  const lin = writeDbaseTable(linFields, overrides?.emptyLines ? [] : (overrides?.lines ?? defaultLines));

  const stl = writeDbaseTable(
    [
      { name: "TTL_TYPE", type: "C", length: 5 },
      { name: "T_HRS", type: "N", length: 8, decimals: 1 },
      { name: "TTL_AMT", type: "N", length: 12, decimals: 2 },
    ],
    [
      { TTL_TYPE: "LAB", T_HRS: 4.6, TTL_AMT: 280.6 },
      { TTL_TYPE: "LAR", T_HRS: 10.1, TTL_AMT: 616.1 },
      { TTL_TYPE: "PAT", T_HRS: 0, TTL_AMT: 1306.5 },
      { TTL_TYPE: "MAPA", T_HRS: 0, TTL_AMT: 701.4 },
    ]
  );
  const ttl = writeDbaseTable(
    [
      { name: "G_TAX", type: "N", length: 12, decimals: 2 },
      { name: "G_TTL_AMT", type: "N", length: 12, decimals: 2 },
    ],
    [{ G_TAX: 182.02, G_TTL_AMT: 3215.62 }]
  );
  const pfl = writeDbaseTable(
    [
      { name: "LBR_TYPE", type: "C", length: 5 },
      { name: "LBR_RATE", type: "N", length: 9, decimals: 2 },
    ],
    [
      { LBR_TYPE: "LAB", LBR_RATE: 61 },
      { LBR_TYPE: "LAR", LBR_RATE: 61 },
    ]
  );
  const pfm = writeDbaseTable(
    [
      { name: "MTL_TYPE", type: "C", length: 6 },
      { name: "CAL_LBRRTE", type: "N", length: 9, decimals: 2 },
    ],
    [{ MTL_TYPE: "MAPA", CAL_LBRRTE: 96.08 }]
  );
  const pfp = writeDbaseTable(
    [
      { name: "PART_TYPE", type: "C", length: 5 },
      { name: "PRT_MKUPP", type: "N", length: 7, decimals: 2 },
    ],
    [{ PART_TYPE: "PAL", PRT_MKUPP: overrides?.partsMarkupPct ?? 0 }]
  );

  return [
    { filename: "export.env", bytes: env },
    { filename: "export.veh", bytes: veh },
    { filename: "export.ad1", bytes: ad1 },
    { filename: "export.lin", bytes: lin },
    { filename: "export.stl", bytes: stl },
    { filename: "export.ttl", bytes: ttl },
    { filename: "export.pfl", bytes: pfl },
    { filename: "export.pfm", bytes: pfm },
    { filename: "export.pfp", bytes: pfp },
  ];
}
