/**
 * Claim identity gate — a hard precondition on any two-document comparison.
 *
 * Everything downstream is worthless if the pair is wrong, so this runs before
 * extraction and can only pass or block. A delta report that compares two
 * different vehicles is not a degraded report; it is a fabricated one.
 *
 * Two rules the RO 22059 pair forced, both of which a naive implementation
 * gets wrong:
 *
 * 1. FIELDS ARE FOUND BY SHAPE, NOT BY POSITION. CCC prints the header as a
 *    stacked label/value block — all labels, then all values:
 *
 *        Claim #:
 *        Workfile ID:
 *        012283486000000800001
 *        cbf21b7c
 *
 *    so `Claim #:\s*(\S+)` yields "Workfile". Candidates are therefore scanned
 *    forward from every label occurrence and accepted on the shape of the
 *    value, never on adjacency alone.
 *
 * 2. NAMES ARE COMPARED AS TOKEN SETS. The same person is "REARDON,
 *    CHRISTOPHER" on the shop estimate and "Christopher Reardon" on the
 *    carrier's supplement — different order and different case.
 *
 * A filename NEVER establishes identity. It orders candidates and nothing more;
 * when filename and content disagree that is itself worth reporting, because it
 * usually means a misfiled document.
 */

/** Identity keys read off a document's own text. Any field may be absent — an
 *  absent field can never prove a mismatch. */
export interface ClaimIdentity {
  vin: string | null;
  claimNumber: string | null;
  roNumber: string | null;
  ownerTokens: string[];
  vehicle: string | null;
  /** Printed date of loss, when the document carries one. Advisory only. */
  dateOfLoss?: string | null;
}

export type IdentityKey = "vin" | "claim number" | "RO number" | "owner" | "vehicle";

export interface IdentityVerdict {
  /** False only on POSITIVE disagreement — never on absent evidence. */
  blocked: boolean;
  /** Keys both documents carry and which agree. */
  agreed: IdentityKey[];
  /** Keys both documents carry and which disagree. These block. */
  conflicting: IdentityKey[];
  /** True when no key was comparable on both sides, so nothing was proven. */
  unverified: boolean;
  /** CR-0: which strong key established identity, when one did. */
  basis?: "claim number" | "vin" | null;
  /** CR-0: advisory lines to render where the BLOCKED box renders today —
   *  e.g. "claims differ, proceeding on VIN match". Never block on these. */
  warnings?: string[];
}

/** A VIN is 17 chars from a 33-letter alphabet — I, O and Q are excluded so
 *  they can never be confused with 1 and 0.
 *
 *  Word boundaries are useless here: CCC prints "VIN:    5YJSA1E65NF488007
 *  Interior Color:WHITE" with the VIN welded to the next label, so a trailing
 *  \b never matches. Slide a 17-character window instead and let the ISO 3779
 *  check digit do the accepting — that is what it is for. */
const VIN_ALPHABET = /^[A-HJ-NPR-Z0-9]{17}$/;

const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** ISO 3779 check digit. A 17-character run that fails this is text that
 *  happens to be 17 characters long, not a VIN. */
export function isValidVin(candidate: string): boolean {
  const vin = candidate.toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const char = vin[i];
    const value = /\d/.test(char) ? Number(char) : VIN_TRANSLITERATION[char];
    if (value === undefined) return false;
    sum += value * VIN_WEIGHTS[i];
  }
  const remainder = sum % 11;
  const expected = remainder === 10 ? "X" : String(remainder);
  return vin[8] === expected;
}

/** A claim/RO value: alphanumeric, long enough not to be a label, and carrying
 *  a numeric core. "Workfile" and "ID:" both fail it; "012283486000000800001"
 *  passes, and so does a dash-grouped carrier format. */
function looksLikeReferenceNumber(token: string, minDigits: number): boolean {
  const value = token.replace(/[.,;:]+$/, "");
  if (!/^[A-Za-z0-9-]+$/.test(value)) return false;
  if (value.length < minDigits) return false;
  return (value.match(/\d/g) ?? []).length >= minDigits;
}

/**
 * Scan forward from every occurrence of `label` and return the first following
 * token whose SHAPE qualifies. Tolerates the stacked label/value block by
 * simply stepping over tokens that do not qualify.
 */
function valueAfterLabel(
  text: string,
  label: RegExp,
  qualifies: (token: string) => boolean,
  lookaheadTokens = 8
): string | null {
  const pattern = new RegExp(label.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 400);
    const tokens = tail.split(/[\s\n\r]+/).filter(Boolean).slice(0, lookaheadTokens);
    for (const token of tokens) {
      if (qualifies(token)) return token.replace(/[.,;:]+$/, "");
    }
  }
  return null;
}

/** Field labels CCC packs onto the same line as the name; never name tokens. */
const NAME_STOPWORDS =
  /^(MR|MRS|MS|DR|JR|SR|II|III|CAPT|SGT|COL|MAJ|REV|HON|OWNER|INSURED|CLAIMANT|POLICY|CLAIM|TYPE|OF|LOSS|DATE|NO|NUMBER|INSPECTION|LOCATION|INSURANCE|COMPANY|ADDRESS|PHONE|DEDUCTIBLE)$/;

/**
 * Personal-name tokens, order- and case-independent, so that the same person
 * printed "REARDON, CHRISTOPHER" by one producer and "Christopher Reardon" by
 * another yields the same set.
 *
 * CCC welds the following label straight onto the name, in two shapes that
 * both have to come apart, or the surname is lost and two documents on ONE
 * claim look like two claims:
 *
 *     "Christopher ReardonOwner Policy #:"     lower -> upper
 *     "REARDON, CHRISTOPHERPolicy #:"          upper-run -> Titlecase
 *
 * Splitting is all this does. Which of the resulting tokens are labels rather
 * than names is decided by NAME_STOPWORDS, never by position — trying to find
 * where the name "ends" by label shape cuts inside the name itself.
 */
export function nameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]{2,})([A-Z][a-z])/g, "$1 $2")
        .toUpperCase()
        .replace(/[^A-Z\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 2 && !NAME_STOPWORDS.test(token))
    )
  ).sort();
}

/** Slide a 17-character window and accept on the check digit. Windows near a
 *  VIN label are preferred so a long document cannot offer an unrelated run
 *  that happens to check out (~1 in 11 do). */
/**
 * VINs never contain I, O or Q, so folding an OCR'd O→0, I→1, Q→0 is lossless
 * for a valid VIN (R-2, Citation fix v2). The 26 Aug carrier scan reads
 * "5FNYF8H58PB0O1022"; without the fold the VIN fallback fails on its first
 * real scanned file. Returns "" unless the folded result is exactly 17
 * characters — a redacted prefix or truncated VIN must never match.
 */
export function foldVinForComparison(value: string | null | undefined): string {
  const folded = (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/Q/g, "0");
  return folded.length === 17 ? folded : "";
}

export function findVin(text: string): string | null {
  const scan = (segment: string): string | null => {
    const upper = segment.toUpperCase();
    for (let i = 0; i + 17 <= upper.length; i += 1) {
      const window = upper.slice(i, i + 17);
      if (VIN_ALPHABET.test(window) && isValidVin(window)) return window;
    }
    return null;
  };
  for (const match of text.matchAll(/\bVIN\b\s*[:#-]?/gi)) {
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 60);
    const found = scan(after);
    if (found) return found;
    // LABELED lane only: accept a 17-char token whose OCR fold lands in the
    // VIN alphabet even when the check digit fails. The label anchors what the
    // value IS; the check digit stays a confidence signal, never a gate
    // (some non-North-American makes do not use it, and one misread glyph
    // breaks it on an otherwise-real scan). The free-text sliding window
    // below keeps its strict check so part numbers never match.
    const run = /[A-Z0-9]{17,}/i.exec(after.replace(/\s+/g, ""));
    if (run) {
      const folded = foldVinForComparison(run[0].slice(0, 17));
      if (folded && VIN_ALPHABET.test(folded)) return folded;
    }
  }
  return scan(text);
}

/** Read identity keys off a document's own text. */
export function readClaimIdentity(text: string): ClaimIdentity {
  const source = text ?? "";
  const vin = findVin(source);

  const claimNumber = valueAfterLabel(source, /Claim\s*(?:#|No\.?|Number)\s*:?/, (token) =>
    looksLikeReferenceNumber(token, 6)
  );
  const roNumber = valueAfterLabel(
    source,
    /\b(?:RO|Repair\s*Order)\s*(?:#|No\.?|Number)\s*:?/,
    (token) => looksLikeReferenceNumber(token, 3)
  );
  const owner = valueAfterLabel(
    source,
    /\b(?:Owner|Insured|Claimant)\s*:?/,
    (token) => /^[A-Za-z][A-Za-z,'-]{1,}$/.test(token),
    1
  );

  // RK-11: a year that is the tail of a date ("06/25/2025 Loss Date") is not a
  // model year; matching it put a loss date and an inspection site on a sheet
  // as the vehicle.
  const vehicleMatch = /(?<![\d/.-])((?:19|20)\d{2}\s+[A-Z][A-Za-z]{1,}(?:\s+[A-Za-z0-9/-]{1,}){0,5})/.exec(
    source
  );

  const dateOfLoss =
    /\bDate\s*of\s*Loss\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(source)?.[1] ?? null;

  return {
    vin,
    claimNumber: claimNumber ? claimNumber.toUpperCase() : null,
    roNumber: roNumber ? roNumber.toUpperCase() : null,
    // The label sits immediately before the name on one producer and one line
    // above it on another, so harvest a window rather than a single token.
    ownerTokens: nameTokens(ownerWindow(source) ?? owner),
    vehicle: vehicleMatch ? vehicleMatch[1].replace(/\s+/g, " ").trim().toUpperCase() : null,
    dateOfLoss,
  };
}

/** Text following the first Insured/Owner/Claimant label. The window is taken
 *  whole and filtered by NAME_STOPWORDS; see nameTokens for why it is not cut
 *  at the next label. */
function ownerWindow(text: string): string | null {
  return /\b(?:Insured|Owner|Claimant)\s*:?\s*([^\n]{0,60})/i.exec(text)?.[1] ?? null;
}

/**
 * Compare two identities. Blocks ONLY on positive disagreement of a STRONG
 * key, and only strong keys are strong enough to block.
 *
 * A strong key is one whose printed form is fixed by something outside the
 * producer: the VIN is an ISO-standard 17 characters, and a claim number is
 * assigned by the carrier. Both mean the same thing on every document that
 * carries them, so a difference is proof.
 *
 * Owner, RO and vehicle are corroborating only. Their printed form is the
 * producer's choice — one estimate says "REARDON, CHRISTOPHER" and the other
 * "Christopher Reardon"; a shop's RO number is meaningless on a carrier
 * document. Blocking on those would refuse legitimate pairs, and a gate that
 * refuses real work gets switched off, taking the real protection with it.
 */
const STRONG_KEYS: ReadonlySet<IdentityKey> = new Set<IdentityKey>(["vin", "claim number"]);

/**
 * One claim number, allowing for the print variants real documents stack on
 * the same carrier-assigned core:
 *
 * - a revision suffix ("8848396030000002" vs "8848396030000002-01" on
 *   RO 22182 — the same claim, one supplement on);
 * - a short glued PREFIX from an adjacent field in the extraction, or a
 *   system prefix one producer prints and the other omits ("020274293880101072"
 *   vs "0274293880101072-01" on the 21347 pair — both variants AT ONCE, which
 *   blocked two documents whose VIN, owner and vehicle all agreed).
 *
 * The rules stay narrow so sequential claims never conflate: a revision tail
 * is at most 3 digits, a glued prefix at most 3 characters and only ever on
 * ONE side, and the shared core must be substantial (>= 8 characters).
 * "…0002" vs "…0003" differ inside the core and still conflict.
 */
export function sameClaimNumber(a: string, b: string): boolean {
  // A separator-delimited short numeric tail is a revision marker, never part
  // of the core ("...-01", "...-1", ".../02").
  const dropRevisionTail = (value: string) => value.replace(/[\s./-]+\d{1,3}\s*$/, "");
  const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const stripZeros = (value: string) => value.replace(/^0+/, "");

  const cores = (value: string) => {
    const full = normalize(value);
    const tailless = normalize(dropRevisionTail(value));
    return tailless && tailless !== full ? [full, tailless] : [full];
  };

  const matches = (rawX: string, rawY: string): boolean => {
    const [x, y] = [stripZeros(rawX), stripZeros(rawY)];
    if (!x || !y) return false;
    if (x === y) return true;
    const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
    if (shorter.length < 8) return false;
    // Un-delimited revision tail on the longer form.
    if (longer.startsWith(shorter) && /^\d{1,3}$/.test(longer.slice(shorter.length))) return true;
    // Glued prefix on the longer form — compared BEFORE zero-stripping so the
    // core's own leading zeros line up ("02" + "0274…" ends with "0274…").
    return rawX !== rawY && rawFormEndsWithCore(rawX, rawY);
  };

  const rawFormEndsWithCore = (rawX: string, rawY: string): boolean => {
    const [shorter, longer] = rawX.length <= rawY.length ? [rawX, rawY] : [rawY, rawX];
    if (shorter.length < 8) return false;
    return longer.length - shorter.length <= 3 && longer.endsWith(shorter);
  };

  for (const x of cores(a)) {
    for (const y of cores(b)) {
      if (matches(x, y)) return true;
    }
  }
  return false;
}

/**
 * Year plus make, comparing the make by prefix in either direction.
 *
 * The make abbreviation runs into the model in glued text layers — RO 22047's
 * shop estimate yields "2024 RIVI R1T…" and the carrier's "2024 RIVIR" — so
 * requiring an equal make reports a conflict where the documents agree. The
 * year is exact; a differing year is a differing vehicle.
 */
export function sameVehicleHead(a: string, b: string): boolean {
  const parse = (value: string) => {
    const [year, make = ""] = value.toUpperCase().split(/\s+/);
    return { year, make: make.replace(/[^A-Z]/g, "") };
  };
  const [x, y] = [parse(a), parse(b)];
  if (x.year !== y.year) return false;
  if (!x.make || !y.make) return true;
  return x.make.startsWith(y.make) || y.make.startsWith(x.make);
}

/**
 * CR-0 GATE-IDENTITY (owner-stated rule, 26 Aug 2026): claim number first,
 * VIN fallback. If the claim numbers do not match, check the VINs; if the
 * VINs match, the comparison CONTINUES with a warning naming both claim
 * strings. Hard block only when neither field establishes identity — a shop
 * CCC "0835185430" and a carrier "000835185430B03" on the same VIN are one
 * claim wearing two claim-number formats, and the old verbatim compare
 * blocked that pair in production.
 *
 * VINs compare after the OCR fold (O→0, I→1, Q→0 — lossless, VINs never
 * contain those letters), so a scanned carrier estimate still matches.
 *
 * Absent evidence still never proves a mismatch: a pair where neither strong
 * key is readable on both sides proceeds as UNVERIFIED (scans would be
 * refused wholesale otherwise), and the weak keys stay corroboration only.
 *
 * Accepted caveat (drop §7): the VIN fallback passes two DIFFERENT claims on
 * the SAME vehicle. When both documents print a date of loss and they
 * differ, an advisory says so; by the stated rule it does not block.
 */
export function compareClaimIdentity(a: ClaimIdentity, b: ClaimIdentity): IdentityVerdict {
  const agreed: IdentityKey[] = [];
  const conflicting: IdentityKey[] = [];
  const warnings: string[] = [];

  const both = (x: unknown, y: unknown): boolean => x !== null && y !== null && x !== undefined && y !== undefined;
  const record = (key: IdentityKey, same: boolean) => (same ? agreed : conflicting).push(key);

  const vinA = foldVinForComparison(a.vin);
  const vinB = foldVinForComparison(b.vin);
  const bothVins = vinA.length > 0 && vinB.length > 0;
  const vinSame = bothVins && vinA === vinB;
  if (bothVins) record("vin", vinSame);

  const bothClaims = both(a.claimNumber, b.claimNumber);
  const claimSame = bothClaims && sameClaimNumber(a.claimNumber!, b.claimNumber!);
  if (bothClaims) record("claim number", claimSame);

  if (both(a.roNumber, b.roNumber)) record("RO number", a.roNumber === b.roNumber);
  if (a.ownerTokens.length > 0 && b.ownerTokens.length > 0) {
    // Overlap, not equality: producers print differing amounts of one name.
    record("owner", a.ownerTokens.some((token) => b.ownerTokens.includes(token)));
  }
  if (both(a.vehicle, b.vehicle)) record("vehicle", sameVehicleHead(a.vehicle!, b.vehicle!));

  if (claimSame) {
    if (bothVins && !vinSame) {
      warnings.push(
        `Claim numbers match but VINs differ (${a.vin} vs ${b.vin}); proceeding on the claim number.`
      );
    }
    return { blocked: false, agreed, conflicting, unverified: false, basis: "claim number", warnings };
  }

  if (vinSame) {
    warnings.push(
      `Claim numbers differ (${a.claimNumber ?? "missing"} vs ${b.claimNumber ?? "missing"}); proceeding on VIN match ${vinA}.`
    );
    if (a.dateOfLoss && b.dateOfLoss && a.dateOfLoss !== b.dateOfLoss) {
      warnings.push(
        `Dates of loss differ (${a.dateOfLoss} vs ${b.dateOfLoss}); confirm this is one loss, not two claims on the same vehicle.`
      );
    }
    return { blocked: false, agreed, conflicting, unverified: false, basis: "vin", warnings };
  }

  // Neither strong key established identity. Block only on POSITIVE
  // disagreement — claims both readable and different, or VINs both readable
  // and different. Unreadable fields prove nothing.
  const claimConflict = bothClaims && !claimSame;
  const vinConflict = bothVins && !vinSame;
  const blocked = claimConflict || vinConflict;

  return {
    blocked,
    agreed,
    conflicting,
    unverified: !blocked,
    basis: null,
    warnings,
  };
}

/** Operator-facing line for one document in the blocked message. */
export function describeIdentity(fileName: string, identity: ClaimIdentity): string {
  const parts = [
    identity.vehicle ?? "vehicle unknown",
    `VIN ${identity.vin ?? "unreadable"}`,
    `claim ${identity.claimNumber ?? "unreadable"}`,
    `owner ${identity.ownerTokens.length ? identity.ownerTokens.join(" ") : "unreadable"}`,
  ];
  return `${fileName} — ${parts.join(", ")}`;
}

/**
 * The blocked message. Emitted INSTEAD of any report — a comparison that
 * cannot prove the two documents describe one claim produces no findings, no
 * annotations, and no prose.
 */
export function buildBlockedMessage(params: {
  target: { fileName: string; identity: ClaimIdentity };
  rejected: { fileName: string; identity: ClaimIdentity };
  verdict: IdentityVerdict;
}): string {
  return [
    "BLOCKED — comparison not run.",
    `  Target:   ${describeIdentity(params.target.fileName, params.target.identity)}`,
    `  Rejected: ${describeIdentity(params.rejected.fileName, params.rejected.identity)}`,
    `  Mismatch: ${params.verdict.conflicting.filter((key) => STRONG_KEYS.has(key)).join(", ")}`,
  ].join("\n");
}
