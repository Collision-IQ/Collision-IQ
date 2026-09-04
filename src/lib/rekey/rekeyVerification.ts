/**
 * Module B — verification pass (WO-RK1 §4).
 *
 * Proves the rekeyed estimate matches the source estimate it was keyed from,
 * line by line and to the penny. It is READ-ONLY against whatever the shop
 * produced: an EMS export of the rekeyed workfile, or a printed/exported copy
 * of the shop's estimate.
 *
 * Both inputs are reduced to the SAME shape before comparison. A shop estimate
 * document is run through the rekey ledger builder first, so both sides speak
 * CCC vocabulary and the comparison is like-for-like rather than a second,
 * differently-tuned parser.
 *
 * Fails closed. A VIN or claim-number disagreement is not a degraded report,
 * it is a comparison of two different vehicles — so it produces no findings at
 * all, only a blocked-comparison message.
 */

import { canonKey, detectSide } from "@/lib/reports/deltaEngine/estimateNormalize";
import VOCABULARY from "./data/rekeyVocabulary.json";
import {
  NOMENCLATURE_MATCH_THRESHOLD,
  UNMAPPED,
  canonicalizeNomenclature,
  nomenclatureOverlap,
  normalizeVocabularyText,
} from "./rekeyVocabulary";
import { buildRekeySheet } from "./rekeyLedger";
import { looksLikeMitchellLayout } from "./mitchellEstimateReader";
import { gateEmsEstimate, normalizeEmsEstimate, type EmsBundle, type EmsEstimate } from "./emsReader";
import type { RekeyLedgerRow, RekeySheet } from "./rekeyTypes";

const TOTALS_CATEGORIES = VOCABULARY.totalsCategories as Array<{
  ems: string;
  label: string;
  unit: "hours" | "amount";
  aliases: string[];
}>;

/**
 * RK-08: the part-number key.
 *
 * The two platforms print the same part differently — Mitchell writes
 * "53101-06650", a CCC EMS export writes "5310106650" — so any key that keeps
 * punctuation matches nothing. On a real pair this alone accounted for every
 * one of 24 identical parts failing to pair.
 */
export function partNumberKey(value: string | null | undefined): string | null {
  const key = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return key.length >= 4 ? key : null;
}

const MONEY_TOLERANCE = 0.005;
const HOURS_TOLERANCE = 0.05;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sameMoney(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < MONEY_TOLERANCE;
}

function sameHours(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < HOURS_TOLERANCE;
}

export interface KeyedLine {
  id: string;
  lineNumber: number | null;
  description: string | null;
  partNumber: string | null;
  partType: string | null;
  qty: number | null;
  price: number | null;
  labor: Array<{ type: string | null; hours: number; included: boolean }>;
  misc: { amount: number; sublet: boolean; taxable: boolean | null } | null;
  group: string | null;
  operation: string | null;
}

export interface KeyedProfile {
  laborRates: Array<{ code: string; rate: number | null }>;
  materialsRate: number | null;
  partsMarkups: Array<{ code: string; markupPct: number | null }>;
}

export interface KeyedEstimate {
  origin: "ems" | "document";
  sourceFile: string;
  estimatingSystem: string | null;
  vin: string | null;
  claimNumber: string | null;
  lines: KeyedLine[];
  totals: {
    /** Keyed by EMS category code where one is known, else the printed name. */
    categories: Array<{ code: string; label: string; hours: number | null; amount: number | null }>;
    tax: number | null;
    grandTotal: number | null;
  };
  profile: KeyedProfile | null;
  notes: string[];
}

/** Map a printed totals-category name onto its EMS code. Unknown names keep
 *  their printed form as the code so nothing is silently discarded. */
export function totalsCategoryCode(name: string): { code: string; label: string; unit: "hours" | "amount" } {
  const normalized = normalizeVocabularyText(name);
  for (const entry of TOTALS_CATEGORIES) {
    if (entry.aliases.some((alias) => normalizeVocabularyText(alias) === normalized)) {
      return { code: entry.ems, label: entry.label, unit: entry.unit };
    }
  }
  for (const entry of TOTALS_CATEGORIES) {
    if (entry.aliases.some((alias) => normalized.startsWith(normalizeVocabularyText(alias)))) {
      return { code: entry.ems, label: entry.label, unit: entry.unit };
    }
  }
  return { code: normalized || "UNKNOWN", label: name.trim() || "Unknown category", unit: "amount" };
}

export function keyedEstimateFromEms(bundle: EmsBundle, sourceFile: string): {
  ok: true;
  estimate: KeyedEstimate;
  raw: EmsEstimate;
} | { ok: false; reason: string } {
  const raw = normalizeEmsEstimate(bundle);
  const gate = gateEmsEstimate(raw);
  if (!gate.ok) return { ok: false, reason: gate.reason ?? "The export could not be verified." };

  const lines: KeyedLine[] = raw.lines.map((line, index) => ({
    id: `ems-${index + 1}`,
    lineNumber: line.lineNumber,
    description: line.description,
    partNumber: line.partNumber ? line.partNumber.replace(/\s+/g, "") : null,
    partType: line.partType,
    qty: line.qty,
    price: line.price,
    labor: line.labor
      .filter((entry) => entry.hours !== null || entry.included !== null)
      .map((entry) => ({
        type: entry.type,
        hours: entry.hours ?? 0,
        included: entry.included === true,
      })),
    misc: line.misc,
    group: null,
    operation: line.labor.find((entry) => entry.opCode)?.opCode ?? null,
  }));

  return {
    ok: true,
    raw,
    estimate: {
      origin: "ems",
      sourceFile,
      estimatingSystem: raw.estimatingSystem,
      vin: raw.vin,
      claimNumber: raw.claimNumber,
      lines,
      totals: {
        categories: raw.subtotals.map((entry) => {
          const known = TOTALS_CATEGORIES.find((candidate) => candidate.ems === entry.code);
          return {
            code: entry.code,
            label: known?.label ?? entry.code,
            hours: entry.hours,
            amount: entry.amount,
          };
        }),
        tax: raw.totals.tax,
        grandTotal: raw.totals.grandTotal,
      },
      profile: {
        laborRates: raw.profile.laborRates,
        materialsRate: raw.profile.materialsRate,
        partsMarkups: raw.profile.partsMarkups,
      },
      notes: bundle.errors,
    },
  };
}

/**
 * Reduce a shop estimate DOCUMENT to the same keyed shape, by translating it
 * with the same ledger builder used for the source. Reusing the builder is the
 * point: a second parser tuned differently would produce differences that are
 * artifacts of the reader rather than of the keying.
 */
export function keyedEstimateFromDocument(params: { text: string; sourceFile: string }): {
  ok: true;
  estimate: KeyedEstimate;
  sheet: RekeySheet;
} | { ok: false; reason: string } {
  const sheet = buildRekeySheet({ text: params.text, sourceFile: params.sourceFile });
  if (sheet.rows.length === 0) {
    return {
      ok: false,
      reason: "No line items could be read from the second document, so there is nothing to verify against.",
    };
  }
  const lines: KeyedLine[] = sheet.rows
    .filter((row) => row.keyable)
    .map((row) => ({
      id: `doc-${row.id}`,
      lineNumber: row.sourceLine,
      description: row.descriptionCcc,
      partNumber: row.partNumber,
      partType: row.partTypeCcc,
      qty: row.qty,
      price: row.price,
      labor: row.labor.map((entry) => ({ type: entry.type, hours: entry.hours, included: entry.included })),
      misc: row.misc ? { amount: row.misc.amount, sublet: row.misc.sublet, taxable: row.misc.taxable } : null,
      group: row.sectionCcc,
      operation: row.operationCcc,
    }));

  const profileRate = (field: string) => sheet.profile.find((entry) => entry.field === field)?.value ?? null;

  return {
    ok: true,
    sheet,
    estimate: {
      origin: "document",
      sourceFile: params.sourceFile,
      estimatingSystem: null,
      vin: sheet.identity.vin,
      claimNumber: sheet.identity.claimNumber,
      lines,
      totals: {
        categories: (sheet.expectedTotals?.categories ?? []).map((entry) => {
          const mapped = totalsCategoryCode(entry.category);
          return { code: mapped.code, label: entry.category, hours: entry.hours, amount: entry.cost };
        }),
        tax: sheet.expectedTotals?.tax ?? null,
        grandTotal: sheet.expectedTotals?.grandTotal ?? null,
      },
      profile: {
        laborRates: [
          { code: "LAB", rate: profileRate("Body rate (LAB)") },
          { code: "LAR", rate: profileRate("Paint rate (LAR)") },
          { code: "LAM", rate: profileRate("Mechanical rate (LAM)") },
        ],
        materialsRate: profileRate("Paint supplies rate (MAPA)"),
        partsMarkups: [],
      },
      notes: sheet.warnings,
    },
  };
}

/**
 * RV-7: why a second estimate DOCUMENT is not run through verification.
 *
 * Verification exists to prove a rekey closed to $0.00 against its source,
 * and the only artifact that states what was keyed is the EMS export of the
 * rekeyed CCC workfile. A second estimate document for the same VIN — the
 * shop's own estimate against the carrier's — is a shop-versus-carrier
 * comparison: the Estimate Delta report, not a rekey verification. Run
 * through this module it can only ever fail, and every "finding" would be a
 * scope difference reported as a keying error.
 */
export function explainDocumentIsNotVerification(params: { keyedText: string }): string {
  const platform = looksLikeMitchellLayout(params.keyedText) ? "a Mitchell estimate" : "an estimate document";
  return `The second upload is ${platform}, so no verification was produced. Verification proves a rekey closed against its source and takes the EMS export (ZIP) of the rekeyed CCC workfile as the keyed side. Two estimates for the same vehicle are a shop-versus-carrier comparison — run them through the Estimate Delta report instead. The rekey sheet above is complete and unaffected.`;
}

export type RekeyLineResolution = "exact" | "value_delta" | "missing_in_keyed" | "unmatched";

export interface RekeyFieldDelta {
  field: string;
  expected: string;
  found: string;
}

export interface RekeyLineFinding {
  resolution: RekeyLineResolution;
  sourceLine: number | null;
  supplementTag: string | null;
  group: string;
  operation: string;
  description: string;
  partNumber: string | null;
  matchedBy: "part number" | "description" | "nomenclature" | "misc amount" | null;
  deltas: RekeyFieldDelta[];
}

export interface RekeyExtraLine {
  lineNumber: number | null;
  description: string;
  partNumber: string | null;
  price: number | null;
}

export interface RekeyTotalsRow {
  code: string;
  label: string;
  unit: "hours" | "amount";
  source: number | null;
  keyed: number | null;
  delta: number | null;
  matches: boolean;
}

export interface RekeyProfileFinding {
  field: string;
  expected: string;
  found: string;
}

export interface RekeyVerification {
  blocked: boolean;
  blockedReason: string | null;
  identity: {
    sourceVin: string | null;
    keyedVin: string | null;
    sourceClaim: string | null;
    keyedClaim: string | null;
    verdict: "match" | "unverified" | "conflict";
    detail: string;
  };
  profileFindings: RekeyProfileFinding[];
  totals: RekeyTotalsRow[];
  lineFindings: RekeyLineFinding[];
  extraLines: RekeyExtraLine[];
  subletNormalization: Array<{ group: string; description: string; amount: number; laborType: string }>;
  summary: {
    keyableRows: number;
    exact: number;
    valueDelta: number;
    missing: number;
    unmatched: number;
    extra: number;
    totalsRowsOff: number;
    pass: boolean;
  };
  notes: string[];
}

/**
 * Normalized description keys: canonical wording plus the side token, so a
 * left part can never match its right-hand twin.
 *
 * TWO keys, tried in that order. The operation is the field most likely to be
 * spelled differently by the two platforms — one prints "Additional Cost"
 * where the other prints "Add", and a materials or diagnostics line often
 * carries no operation word at all — so an operation-free key backs the strict
 * one up. Without it the SAME line is reported twice, once as never keyed and
 * once as keyed but not in the source, which is the failure mode the report
 * exists to prevent. A real operation difference is not lost: it surfaces as a
 * field delta on the matched pair, where the estimator can act on it.
 */
function descriptionKeys(
  description: string | null,
  group: string | null,
  operation: string | null
): { withOperation: string; withoutOperation: string; withoutGroup: string } {
  const canon = canonKey(description ?? "");
  const side = detectSide(description ?? "");
  const grouped = [normalizeVocabularyText(group ?? ""), side, canon.key].join("|");
  const ungrouped = [side, canon.key].join("|");
  return {
    withOperation: `${normalizeVocabularyText(operation ?? "")}|${grouped}`,
    withoutOperation: grouped,
    // RV-3: the two platforms group work differently BY DESIGN, so a source
    // row whose group did not map could never match anything while group
    // equality was a precondition. It is a tie-breaker: tried first, then
    // dropped, with the side token still keeping a left part off its right
    // twin.
    withoutGroup: ungrouped,
  };
}

/**
 * Operations that can name the same physical line.
 *
 * Two databases can book one operation under different words — a panel
 * replacement that carries its own refinish, a sublet booked as a manual
 * charge — so the nomenclature pass treats those as compatible rather than as
 * evidence the lines are different. An unmapped or unread operation on either
 * side is a gap in the READING, never a difference in the keying, so it never
 * blocks a pair; the difference, if there is one, still surfaces as a field
 * delta on the matched pair where the estimator can act on it.
 */
function operationsCompatible(row: RekeyLedgerRow, keyed: KeyedLine): boolean {
  const keyedOperation = (keyed.operation ?? "").trim();
  if (!keyedOperation) return true;
  // An EMS export speaks labor-op CODES, so compare in that vocabulary.
  if (/^OP\d+$/i.test(keyedOperation)) {
    if (!row.laborOpCode) return true;
    return row.laborOpCode.toUpperCase() === keyedOperation.toUpperCase();
  }
  const left = normalizeVocabularyText(row.operationCcc);
  const right = normalizeVocabularyText(keyedOperation);
  if (!left || !right || left === UNMAPPED || right === UNMAPPED) return true;
  if (left === right) return true;
  return EQUIVALENT_OPERATION_SETS.some((set) => set.has(left) && set.has(right));
}

const EQUIVALENT_OPERATION_SETS: ReadonlyArray<Set<string>> = [
  new Set(["REPL", "REFN", "SUBL"]),
  new Set(["RPR", "ALGN"]),
];

/**
 * The numbers on both sides already agree.
 *
 * A nomenclature pair is a claim about NAMING, and the strongest evidence
 * that two differently-named lines are one line is that their money and hours
 * already match. It is not required — a line can be renamed AND mis-keyed,
 * which is exactly what the report exists to catch — but where the operation
 * words disagree it is what carries the pair.
 */
function numbersAgree(row: RekeyLedgerRow, keyed: KeyedLine): boolean {
  if (row.price !== null && keyed.price !== null && sameMoney(row.price, keyed.price)) return true;
  if (row.misc && keyed.misc && sameMoney(row.misc.amount, keyed.misc.amount)) return true;
  const expected = laborByType(row.labor);
  const found = laborByType(keyed.labor);
  if (expected.size === 0 || expected.size !== found.size) return false;
  for (const [type, entry] of expected) {
    if (!sameHours(entry.hours, found.get(type)?.hours ?? null)) return false;
  }
  return true;
}

function laborByType(entries: Array<{ type: string | null; hours: number; included: boolean }>): Map<string, { hours: number; included: boolean }> {
  const map = new Map<string, { hours: number; included: boolean }>();
  for (const entry of entries) {
    const type = (entry.type ?? "LAB").toUpperCase();
    const existing = map.get(type);
    map.set(type, {
      hours: round2((existing?.hours ?? 0) + (entry.included ? 0 : entry.hours)),
      included: (existing?.included ?? false) || entry.included,
    });
  }
  return map;
}

/**
 * Field-by-field comparison of one matched pair.
 *
 * RV-10: a difference is only reported where BOTH sides made a claim. A
 * quantity the source never printed against a keyed 1 is the platform's
 * default, not a keying error; a manual source line carries no operation of
 * its own, so the operation the estimator keyed it under is not a difference.
 */
export function compareRekeyFields(row: RekeyLedgerRow, keyed: KeyedLine): RekeyFieldDelta[] {
  const deltas: RekeyFieldDelta[] = [];
  const showMoney = (value: number | null) => (value === null ? "not keyed" : `$${value.toFixed(2)}`);
  const showHours = (value: number | null) => (value === null ? "not keyed" : `${value.toFixed(1)} h`);

  if (!sameMoney(row.price, keyed.price)) {
    deltas.push({ field: "price", expected: showMoney(row.price), found: showMoney(keyed.price) });
  }
  const sourceQty = row.qty ?? null;
  const keyedQty = keyed.qty ?? null;
  const defaultQuantity = (sourceQty === null && keyedQty === 1) || (keyedQty === null && sourceQty === 1);
  if (sourceQty !== keyedQty && !defaultQuantity) {
    deltas.push({
      field: "quantity",
      expected: sourceQty === null ? "not printed" : String(sourceQty),
      found: keyedQty === null ? "not keyed" : String(keyedQty),
    });
  }
  if (row.partNumber && keyed.partNumber && row.partNumber !== keyed.partNumber) {
    deltas.push({ field: "part number", expected: row.partNumber, found: keyed.partNumber });
  }
  // Part type is compared on the CCC term OR its EMS code, because the two
  // inputs speak different halves of the same vocabulary.
  if (row.partNumber && keyed.partType) {
    const keyedType = normalizeVocabularyText(keyed.partType);
    const expected = [row.partTypeCcc, row.partTypeEms].filter(Boolean).map(normalizeVocabularyText);
    if (expected.length > 0 && !expected.includes(keyedType)) {
      deltas.push({
        field: "part type",
        expected: [row.partTypeCcc, row.partTypeEms].filter(Boolean).join(" / "),
        found: keyed.partType,
      });
    }
  }

  // Operation, compared in whichever vocabulary both sides actually speak: an
  // EMS export carries the labor-operation CODE, a document carries the CCC
  // operation name. An unmapped operation on either side is a gap in the
  // reading, not a difference in the keying, so it is never reported here.
  const keyedOperation = keyed.operation ?? null;
  if (keyedOperation && /^OP\d+$/i.test(keyedOperation)) {
    if (row.laborOpCode && row.laborOpCode.toUpperCase() !== keyedOperation.toUpperCase()) {
      deltas.push({ field: "operation", expected: row.laborOpCode, found: keyedOperation });
    }
  } else if (keyedOperation && row.operationMapped && row.operationCcc !== "UNMAPPED" && row.operationCcc !== "Manual") {
    if (normalizeVocabularyText(row.operationCcc) !== normalizeVocabularyText(keyedOperation)) {
      deltas.push({ field: "operation", expected: row.operationCcc, found: keyedOperation });
    }
  }

  const expectedLabor = laborByType(row.labor);
  const keyedLabor = laborByType(keyed.labor);
  for (const type of new Set([...expectedLabor.keys(), ...keyedLabor.keys()])) {
    const expected = expectedLabor.get(type);
    const found = keyedLabor.get(type);
    if (!sameHours(expected?.hours ?? null, found?.hours ?? null)) {
      deltas.push({
        field: `${type} hours`,
        expected: showHours(expected?.hours ?? null),
        found: showHours(found?.hours ?? null),
      });
    } else if ((expected?.included ?? false) !== (found?.included ?? false)) {
      deltas.push({
        field: `${type} included flag`,
        expected: expected?.included ? "Incl." : "billed",
        found: found?.included ? "Incl." : "billed",
      });
    }
  }

  if (!sameMoney(row.misc?.amount ?? null, keyed.misc?.amount ?? null)) {
    deltas.push({
      field: "miscellaneous amount",
      expected: showMoney(row.misc?.amount ?? null),
      found: showMoney(keyed.misc?.amount ?? null),
    });
  } else if ((row.misc?.sublet ?? false) !== (keyed.misc?.sublet ?? false)) {
    deltas.push({
      field: "sublet flag",
      expected: row.misc?.sublet ? "sublet" : "not sublet",
      found: keyed.misc?.sublet ? "sublet" : "not sublet",
    });
  }
  // Tax is only compared when BOTH sides print it; an absent marker is not a
  // claim that the line is untaxed.
  if (row.taxable !== null && keyed.misc?.taxable !== null && keyed.misc?.taxable !== undefined) {
    if (row.taxable !== keyed.misc.taxable) {
      deltas.push({
        field: "tax flag",
        expected: row.taxable ? "taxable" : "not taxable",
        found: keyed.misc.taxable ? "taxable" : "not taxable",
      });
    }
  }

  return deltas;
}

/** Claim numbers agree when their digits agree after a revision suffix is
 *  dropped — the same tolerance the existing claim-identity gate applies. */
function sameClaimTolerant(a: string, b: string): boolean {
  const core = (value: string) =>
    value.toUpperCase().replace(/[\s./-]+\d{1,3}\s*$/, "").replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
  const left = core(a);
  const right = core(b);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

export function verifyRekey(params: { sheet: RekeySheet; keyed: KeyedEstimate }): RekeyVerification {
  const { sheet, keyed } = params;
  const notes: string[] = [...keyed.notes];

  // §4.2 identity gate — hard precondition, evaluated before anything else.
  const sourceVin = sheet.identity.vin;
  const keyedVin = keyed.vin;
  const sourceClaim = sheet.identity.claimNumber;
  const keyedClaim = keyed.claimNumber;
  let verdict: "match" | "unverified" | "conflict" = "unverified";
  let detail = "Neither document prints a VIN or claim number that could be compared.";

  if (sourceVin && keyedVin) {
    if (sourceVin.toUpperCase() === keyedVin.toUpperCase()) {
      verdict = "match";
      detail = `Both documents carry VIN ${sourceVin.toUpperCase()}.`;
    } else {
      verdict = "conflict";
      detail = `The documents carry different VINs (${sourceVin.toUpperCase()} and ${keyedVin.toUpperCase()}).`;
    }
  } else if (sourceClaim && keyedClaim) {
    if (sameClaimTolerant(sourceClaim, keyedClaim)) {
      verdict = "match";
      detail = `Both documents carry claim ${sourceClaim}.`;
    } else {
      verdict = "conflict";
      detail = `The documents carry different claim numbers (${sourceClaim} and ${keyedClaim}).`;
    }
  } else if (sourceVin || keyedVin || sourceClaim || keyedClaim) {
    detail =
      "Only one of the two documents prints a VIN or claim number, so the pair could not be confirmed as the same vehicle.";
  }

  // RV-9: the claim number is compared whenever both sides print one, even
  // after the VIN has settled the pair; when only one side prints one, the
  // gate says so instead of silently skipping the comparison.
  if (verdict === "match" && sourceVin && keyedVin) {
    if (sourceClaim && keyedClaim) {
      if (sameClaimTolerant(sourceClaim, keyedClaim)) {
        detail += ` Claim ${sourceClaim} agrees.`;
      } else {
        detail += ` The claim numbers differ (${sourceClaim} and ${keyedClaim}).`;
        notes.push(
          `The VIN matches but the claim numbers differ (${sourceClaim} and ${keyedClaim}). Confirm the keyed estimate belongs to this claim before relying on the findings.`
        );
      }
    } else if (sourceClaim && !keyedClaim) {
      detail += " The keyed side prints no claim number, so the claim was not compared.";
    } else if (keyedClaim && !sourceClaim) {
      detail += " The source prints no claim number, so the claim was not compared.";
    }
  }

  const identity = { sourceVin, keyedVin, sourceClaim, keyedClaim, verdict, detail };

  if (verdict === "conflict") {
    return {
      blocked: true,
      blockedReason: `${detail} No verification was produced — comparing two different vehicles would fabricate every finding.`,
      identity,
      profileFindings: [],
      totals: [],
      lineFindings: [],
      extraLines: [],
      subletNormalization: [],
      summary: {
        keyableRows: 0,
        exact: 0,
        valueDelta: 0,
        missing: 0,
        unmatched: 0,
        extra: 0,
        totalsRowsOff: 0,
        pass: false,
      },
      notes,
    };
  }
  if (verdict === "unverified") {
    notes.push(
      "Vehicle identity could not be confirmed from the documents themselves. Confirm the pair before relying on the findings."
    );
  }

  // §4.6 profile check — reported first, because a wrong profile explains
  // every downstream number.
  const profileFindings: RekeyProfileFinding[] = [];
  const expectRate = (field: string, code: string) => {
    const expected = sheet.profile.find((entry) => entry.field === field);
    if (!expected || expected.value === null) return;
    const found = keyed.profile?.laborRates.find((entry) => entry.code === code)?.rate ?? null;
    if (found === null) return;
    if (!sameMoney(expected.value, found)) {
      profileFindings.push({
        field,
        expected: `$${expected.value.toFixed(2)}`,
        found: `$${found.toFixed(2)}`,
      });
    }
  };
  expectRate("Body rate (LAB)", "LAB");
  expectRate("Paint rate (LAR)", "LAR");
  expectRate("Mechanical rate (LAM)", "LAM");

  const expectedMaterials = sheet.profile.find((entry) => entry.field === "Paint supplies rate (MAPA)");
  if (
    expectedMaterials?.value !== null &&
    expectedMaterials?.value !== undefined &&
    keyed.profile?.materialsRate !== null &&
    keyed.profile?.materialsRate !== undefined &&
    !sameMoney(expectedMaterials.value, keyed.profile.materialsRate)
  ) {
    profileFindings.push({
      field: "Paint supplies rate (MAPA)",
      expected: `$${expectedMaterials.value.toFixed(2)}`,
      found: `$${keyed.profile.materialsRate.toFixed(2)}`,
    });
  }
  for (const markup of keyed.profile?.partsMarkups ?? []) {
    if (markup.markupPct !== null && markup.markupPct !== 0) {
      // A real CCC export writes the markup as a fraction ("0.2500" for 25%,
      // F-RK1a); a value below one is read that way, so the finding does not
      // say "0.25%" for a quarter markup.
      const percent = Math.abs(markup.markupPct) < 1 ? markup.markupPct * 100 : markup.markupPct;
      profileFindings.push({
        field: `Parts markup (${markup.code})`,
        expected: "0%",
        found: `${Number(percent.toFixed(2))}%`,
      });
    }
  }

  // §4.3 line matching, in priority order.
  const keyable = sheet.rows.filter((row) => row.keyable);
  const remaining = new Map<string, KeyedLine>(keyed.lines.map((line) => [line.id, line]));

  const byPartNumber = new Map<string, string[]>();
  const byOperationDescription = new Map<string, string[]>();
  const byDescription = new Map<string, string[]>();
  const byDescriptionNoGroup = new Map<string, string[]>();
  const byMisc = new Map<string, string[]>();
  const append = (index: Map<string, string[]>, key: string, id: string) => {
    index.set(key, [...(index.get(key) ?? []), id]);
  };
  for (const line of keyed.lines) {
    const partKey = partNumberKey(line.partNumber);
    if (partKey) append(byPartNumber, partKey, line.id);
    const keys = descriptionKeys(line.description, line.group, line.operation);
    append(byOperationDescription, keys.withOperation, line.id);
    append(byDescription, keys.withoutOperation, line.id);
    append(byDescriptionNoGroup, keys.withoutGroup, line.id);
    if (line.misc) {
      append(byMisc, `${normalizeVocabularyText(line.group ?? "")}|${line.misc.amount.toFixed(2)}`, line.id);
    }
  }

  const takeFirstAvailable = (ids: string[] | undefined): KeyedLine | null => {
    for (const id of ids ?? []) {
      const line = remaining.get(id);
      if (line) return line;
    }
    return null;
  };

  const lineFindings: RekeyLineFinding[] = [];
  for (const row of keyable) {
    let match: KeyedLine | null = null;
    let matchedBy: RekeyLineFinding["matchedBy"] = null;

    const rowPartKey = partNumberKey(row.partNumber);
    if (rowPartKey) {
      match = takeFirstAvailable(byPartNumber.get(rowPartKey));
      if (match) matchedBy = "part number";
    }
    if (!match) {
      const keys = descriptionKeys(row.descriptionCcc, row.sectionCcc, row.operationCcc);
      match = takeFirstAvailable(byOperationDescription.get(keys.withOperation));
      if (!match) match = takeFirstAvailable(byDescription.get(keys.withoutOperation));
      if (!match) match = takeFirstAvailable(byDescriptionNoGroup.get(keys.withoutGroup));
      if (match) matchedBy = "description";
    }
    // §4.3d nomenclature — the same line under the other database's name.
    // Scored, not keyed: MOTOR's "Side support" and CEG's "Frt Bumper Cover
    // Support" share no key, so the only way to pair them is to compare their
    // canonicalized names against every line the exact passes left over. The
    // gates below are what keep a score from becoming a guess.
    if (!match) {
      const rowSide = detectSide(row.descriptionCcc ?? "");
      const rowGroup = normalizeVocabularyText(row.sectionCcc);
      let best: { line: KeyedLine; score: number } | null = null;
      // RV-8: the two platforms group work differently BY DESIGN, so the
      // group is a tie-breaker, not a precondition. Same-group candidates are
      // tried first; a candidate in another group is accepted only when its
      // numbers already agree, which is the stronger evidence a cross-group
      // pair needs.
      for (const pass of ["same group", "any group"] as const) {
        for (const line of remaining.values()) {
          const group = normalizeVocabularyText(line.group ?? "");
          const sameGroup = group === rowGroup || group === UNMAPPED || rowGroup === UNMAPPED;
          if (pass === "same group" && !sameGroup) continue;
          if (pass === "any group" && (sameGroup || !numbersAgree(row, line))) continue;
          // Side: a left part is never its right-hand twin. One side unprinted
          // is not a disagreement — Mitchell prints some sided parts unsided.
          const lineSide = detectSide(line.description ?? "");
          if (rowSide && lineSide && rowSide !== lineSide) continue;
          // Operation, or failing that the numbers. Requiring one of the two is
          // what stops two unrelated leftovers from pairing on a shared word.
          if (!operationsCompatible(row, line) && !numbersAgree(row, line)) continue;
          const score = nomenclatureOverlap(
            canonicalizeNomenclature(row.descriptionCcc, row.sectionCcc, line.group),
            canonicalizeNomenclature(line.description, line.group, row.sectionCcc)
          );
          if (score >= NOMENCLATURE_MATCH_THRESHOLD && (best === null || score > best.score)) {
            best = { line, score };
          }
        }
        if (best) break;
      }
      if (best) {
        match = best.line;
        matchedBy = "nomenclature";
      }
    }
    if (!match && row.misc) {
      const key = `${normalizeVocabularyText(row.sectionCcc)}|${row.misc.amount.toFixed(2)}`;
      match = takeFirstAvailable(byMisc.get(key));
      if (match) matchedBy = "misc amount";
    }

    const base = {
      sourceLine: row.sourceLine,
      supplementTag: row.supplementTag,
      group: row.sectionCcc,
      operation: row.operationCcc,
      description: row.descriptionCcc,
      partNumber: row.partNumber,
    };

    if (!match) {
      // An UNMAPPED group means the row's identity was never established, so
      // absence cannot be reported as an omission — it is unmatched, not
      // missing. (The existing MISSING-precondition rule, applied here.)
      lineFindings.push({
        ...base,
        resolution: row.sectionCcc === "UNMAPPED" ? "unmatched" : "missing_in_keyed",
        matchedBy: null,
        deltas: [],
      });
      continue;
    }

    remaining.delete(match.id);
    const deltas = compareRekeyFields(row, match);
    lineFindings.push({
      ...base,
      resolution: deltas.length === 0 ? "exact" : "value_delta",
      matchedBy,
      deltas,
    });
  }

  const extraLines: RekeyExtraLine[] = [...remaining.values()].map((line) => ({
    lineNumber: line.lineNumber,
    description: line.description ?? "(no description)",
    partNumber: line.partNumber,
    price: line.price,
  }));

  // §4.5 totals reconciliation. The keyed side is indexed by EMS code so a
  // document and an export reconcile against the same rows.
  const keyedByCode = new Map<string, { hours: number | null; amount: number | null; label: string }>();
  for (const category of keyed.totals.categories) {
    const existing = keyedByCode.get(category.code);
    keyedByCode.set(category.code, {
      label: category.label,
      hours: category.hours ?? existing?.hours ?? null,
      amount:
        category.amount === null
          ? (existing?.amount ?? null)
          : round2((existing?.amount ?? 0) + category.amount),
    });
  }

  const totals: RekeyTotalsRow[] = [];
  const seenCodes = new Set<string>();
  for (const category of sheet.expectedTotals?.categories ?? []) {
    const mapped = totalsCategoryCode(category.category);
    seenCodes.add(mapped.code);
    const found = keyedByCode.get(mapped.code);
    const source = mapped.unit === "hours" ? (category.hours ?? category.cost) : category.cost;
    const keyedValue = mapped.unit === "hours" ? (found?.hours ?? found?.amount ?? null) : (found?.amount ?? null);
    const matches =
      mapped.unit === "hours" ? sameHours(source, keyedValue) : sameMoney(source, keyedValue);
    totals.push({
      code: mapped.code,
      label: category.category,
      unit: mapped.unit,
      source,
      keyed: keyedValue,
      delta: source !== null && keyedValue !== null ? round2(keyedValue - source) : null,
      matches,
    });
    // A labor category also carries a dollar amount; report it as its own row
    // so an hours match with a rate error cannot pass silently.
    if (mapped.unit === "hours" && category.cost !== null) {
      const keyedAmount = found?.amount ?? null;
      totals.push({
        code: `${mapped.code}$`,
        label: `${category.category} — amount`,
        unit: "amount",
        source: category.cost,
        keyed: keyedAmount,
        delta: keyedAmount !== null ? round2(keyedAmount - category.cost) : null,
        matches: sameMoney(category.cost, keyedAmount),
      });
    }
  }
  for (const [code, value] of keyedByCode) {
    if (seenCodes.has(code)) continue;
    totals.push({
      code,
      label: value.label,
      unit: value.amount !== null ? "amount" : "hours",
      source: null,
      keyed: value.amount ?? value.hours,
      delta: null,
      matches: false,
    });
  }
  totals.push({
    code: "TAX",
    label: "Tax",
    unit: "amount",
    source: sheet.expectedTotals?.tax ?? null,
    keyed: keyed.totals.tax,
    delta:
      sheet.expectedTotals?.tax !== null && sheet.expectedTotals?.tax !== undefined && keyed.totals.tax !== null
        ? round2(keyed.totals.tax - sheet.expectedTotals.tax)
        : null,
    matches: sameMoney(sheet.expectedTotals?.tax ?? null, keyed.totals.tax),
  });
  totals.push({
    code: "GROSS",
    label: "Gross total",
    unit: "amount",
    source: sheet.expectedTotals?.grandTotal ?? null,
    keyed: keyed.totals.grandTotal,
    delta:
      sheet.expectedTotals?.grandTotal !== null &&
      sheet.expectedTotals?.grandTotal !== undefined &&
      keyed.totals.grandTotal !== null
        ? round2(keyed.totals.grandTotal - sheet.expectedTotals.grandTotal)
        : null,
    matches: sameMoney(sheet.expectedTotals?.grandTotal ?? null, keyed.totals.grandTotal),
  });

  // Sublet is booked under miscellaneous by CCC and under labor by the source.
  // Both views are reported rather than silently reconciled either way.
  const subletNormalization = keyable
    .filter((row) => row.misc?.sublet)
    .map((row) => ({
      group: row.sectionCcc,
      description: row.descriptionCcc,
      amount: row.misc?.amount ?? 0,
      laborType: row.labor[0]?.type ?? "LAB",
    }));
  if (subletNormalization.length > 0) {
    notes.push(
      "Sublet amounts are booked under miscellaneous on one platform and under labor on the other. The totals table reports each side as printed; the sublet rows are listed separately so the difference is visible rather than absorbed."
    );
  }

  const exact = lineFindings.filter((finding) => finding.resolution === "exact").length;
  const valueDelta = lineFindings.filter((finding) => finding.resolution === "value_delta").length;
  const missing = lineFindings.filter((finding) => finding.resolution === "missing_in_keyed").length;
  const unmatched = lineFindings.filter((finding) => finding.resolution === "unmatched").length;
  const totalsRowsOff = totals.filter((row) => !row.matches).length;

  return {
    blocked: false,
    blockedReason: null,
    identity,
    profileFindings,
    totals,
    lineFindings,
    extraLines,
    subletNormalization,
    summary: {
      keyableRows: keyable.length,
      exact,
      valueDelta,
      missing,
      unmatched,
      extra: extraLines.length,
      totalsRowsOff,
      pass:
        valueDelta === 0 &&
        missing === 0 &&
        extraLines.length === 0 &&
        totalsRowsOff === 0 &&
        profileFindings.length === 0,
    },
    notes,
  };
}
