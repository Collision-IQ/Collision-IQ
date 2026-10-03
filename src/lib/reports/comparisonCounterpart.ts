/**
 * ONE COUNTERPART PER RUN.
 *
 * The delta route hands the builder every other estimate on the case as a
 * comparison, and each consumer then picked its own: the text lane pooled the
 * rows of all of them, the word lane took "the other role, else the first",
 * totals took the first that parsed, and the Appraisal Dispute Report gate
 * read only the first one's role. RO 22279 was uploaded as two shop versions
 * plus the carrier's SOR: the lower side became Shop final's lines under the
 * SOR's totals, and the dispute report was skipped without a word.
 *
 * This picks the single estimate the annotated one is measured against —
 * the other party's, latest by what the documents print — and names every
 * estimate it leaves out with the measured reason. Nothing is inferred: a
 * version or print date is used only when the documents print one.
 */
import { isCarrierAuthoredEstimateDocument } from "./citationDensitySourcePdf";
import { readClaimIdentity, sameClaimNumber } from "./claimIdentityGate";
import { parseEstimateTotalsForPlatform } from "./estimatePlatform";

/**
 * The supplement number a print states: the highest "Supplement of Record N"
 * (CCC), else the highest standalone "Supplement N" title line (Mitchell),
 * else 0 for an "Estimate of Record", else null. Highest, because a print can
 * cite an earlier version but never a later one.
 */
export function readPrintedEstimateVersion(text: string): number | null {
  const highest = (pattern: RegExp) => {
    const values = [...(text ?? "").matchAll(pattern)].map((match) => Number(match[1]));
    return values.length ? Math.max(...values) : null;
  };
  return (
    highest(/\bSupplement\s+of\s+Record\s+(\d{1,2})\b/gi) ??
    highest(/^[ \t]*Supplement[ \t]+(\d{1,2})[ \t]*$/gim) ??
    (/\bEstimate\s+of\s+Record\b/i.test(text ?? "") ? 0 : null)
  );
}

/** The latest "M/D/YYYY h:mm[:ss] AM|PM" stamp a print carries (its print time), as epoch ms; null when none. */
export function readLatestPrintedTimestamp(text: string): number | null {
  let latest: number | null = null;
  for (const match of (text ?? "").matchAll(
    /(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP])M(?![A-Za-z])/gi
  )) {
    const [, month, day, year, hour, minute, second, meridiem] = match;
    const hour24 = (Number(hour) % 12) + (meridiem.toUpperCase() === "P" ? 12 : 0);
    const value = Date.UTC(Number(year), Number(month) - 1, Number(day), hour24, Number(minute), Number(second ?? 0));
    if (Number.isFinite(value) && (latest === null || value > latest)) latest = value;
  }
  return latest;
}

/**
 * A scanned name read as its letters: a digit or bar inside a word is the
 * letter OCR took it for ("R0E" is "ROE"), so a scan reads the same name its
 * text layer does. Digits standing alone (a license or phone number) stay.
 */
const ocrLetters = (value: string) =>
  value.replace(/[0158|]/g, (char, offset: number, all: string) =>
    /[A-Za-z]/.test(`${all[offset - 1] ?? ""}${all[offset + 1] ?? ""}`) ? ({ "0": "O", "1": "I", "5": "S", "8": "B", "|": "I" } as Record<string, string>)[char] : char
  );

/**
 * The estimator a CCC print names ("Written By: NAME, …"), folded to its
 * letters; null when none is printed. Two estimates written by the same
 * estimator are the same party's, whatever their file names say: a shop's
 * own version named "USAA 22279 Final.pdf" is still the shop's.
 */
/** "Written By" as OCR reads it too ("Wrltten By", "Written 8y"). */
const WRITTEN_BY = String.raw`W\s*r\s*[i1l|]\s*t\s*t?\s*[e3]\s*n\s+[B8][yv]`;

export function readPrintedEstimator(text: string): string | null {
  const name = (text ?? "").match(new RegExp(`${WRITTEN_BY}\\s*[:;.]?[ \\t]*([^,\\n]{2,60})`, "i"))?.[1]?.trim() ?? "";
  const words = ocrLetters(name).toUpperCase().replace(/[^A-Z]+/g, " ").trim().split(" ").filter(Boolean);
  // A redaction prints the same on both sheets and proves nothing, so any
  // sign of one voids the read: a bracketed or tokenised value
  // ("[REDACTED_PERSON]", "<name>", "***") or a redaction word anywhere
  // ("Redacted for privacy", "NAME WITHHELD"). A role placeholder voids it
  // only when it is all there is ("ESTIMATOR", "ADJUSTER NAME"); any real
  // name counts, short or initialled ("J. R. SMITH", "MIKE", "JIWON NA").
  if (/^[[<({*#]|_/.test(name)) return null;
  if (words.some((word) => /^(?:REDACTED|REDACT|WITHHELD|REMOVED|PII|PRIVATE|PRIVACY|CONFIDENTIAL|HIDDEN|MASKED|ANONYMOUS|ANONYMIZED)$/.test(word))) return null;
  const placeholder = (word: string) =>
    word.length === 1 || /^X+$/.test(word) || /^(?:NAME|ESTIMATOR|APPRAISER|ADJUSTER|UNKNOWN|NONE|NA|TBD|STAFF|PERSON|USER)$/.test(word);
  if (words.every(placeholder) || words.join("").length < 3) return null;
  return words.join(" ");
}

/** The print names a licensed appraiser as its writer ("Written By: NAME, License Number: …"; OCR's "Llcense", "Lic. No."). */
function printsAppraiserLicense(text: string): boolean {
  return new RegExp(`${WRITTEN_BY}[^\\n]*\\bL[i1l|]c(?:ense)?\\.?\\s*(?:Number|No\\.?|#)`, "i").test(text ?? "");
}

/** True when both prints name an estimator and it is the same one; OCR's I/L confusion is no difference. */
export function sameEstimator(a: string, b: string): boolean {
  const left = readPrintedEstimator(a);
  const right = readPrintedEstimator(b);
  return left !== null && right !== null && left.replace(/L/g, "I") === right.replace(/L/g, "I");
}

// Header labels as OCR reads them too ("Workfile lD", "Workfile 1D").
const WORKFILE_LABEL = String.raw`Work\s*f[iIl1|]{2}e\s*[I1l|]D`;
const FEDERAL_LABEL = String.raw`(?:Federa[lI1|](?:\s*Tax)?\s*[I1l|]D|Tax\s*[I1l|]D|FEIN)(?:\s*(?:#|No\.?))?`;
const FEDERAL_VALUE = String.raw`[0-9OoIl|]{2}[- ]?[0-9OoIl|]{7}`;
const BARE_LABEL = /^[A-Za-z][A-Za-z0-9 #./|&'()-]{0,30}:$/;

/**
 * A printed identifier as compared, OCR's O/I/L read as 0/1. It must carry a
 * digit as printed (a label word read as the value, "Federal", never counts),
 * and a run of one character is a placeholder, not an identifier.
 */
function printedIdentifier(value: string | undefined, shape: RegExp): string | null {
  if (!value || !/\d/.test(value)) return null;
  const folded = value.toLowerCase().replace(/o/g, "0").replace(/[il|]/g, "1").replace(/[- ]/g, "");
  return shape.test(folded) && !/^(.)\1*$/.test(folded) ? folded : null;
}
/** A CCC Workfile ID is eight hex digits. */
const workfileId = (value: string | undefined) => printedIdentifier(value, /^[0-9a-f]{8}$/);
const federalId = (value: string | undefined) => printedIdentifier(value, /^\d{9}$/);

/**
 * The values a text layer printed for a run of header labels set together
 * above their values ("Claim #:\nWorkfile ID:\n<claim>\n<workfile>"), by the
 * label each value belongs to. A reader that takes the line after a label
 * there reads the claim number; one that takes the next token reads "Federal".
 */
function stackedHeaderValues(text: string): Array<{ label: string; value: string; run: number }> {
  const lines = (text ?? "").split(/\r?\n/).map((line) => line.trim());
  const pairs: Array<{ label: string; value: string; run: number }> = [];
  for (let start = 0; start < lines.length; start++) {
    if (!BARE_LABEL.test(lines[start])) continue;
    let end = start;
    while (end + 1 < lines.length && BARE_LABEL.test(lines[end + 1])) end++;
    for (let index = start; index <= end; index++) {
      const value = lines[end + 1 + (index - start)];
      if (value !== undefined) pairs.push({ label: lines[index], value, run: start });
    }
    start = end;
  }
  return pairs;
}

/**
 * The CCC workfile a print belongs to ("Workfile ID: 613bea70"); null when
 * none is printed. One workfile is one party's: a shop's supplements stay in
 * its workfile, and the insurer writes in its own.
 */
export function readPrintedWorkfileId(text: string): string | null {
  const source = text ?? "";
  for (const match of source.matchAll(new RegExp(`${WORKFILE_LABEL}:?[ \\t]*([0-9A-Za-z|]{6,12})(?![0-9A-Za-z])`, "gi"))) {
    const value = workfileId(match[1]);
    if (value) return value;
  }
  const oneLine = source.match(new RegExp(`${WORKFILE_LABEL}:?\\s*${FEDERAL_LABEL}:?\\s*([0-9A-Za-z|]{6,12})(?![0-9A-Za-z])`, "i"));
  if (workfileId(oneLine?.[1])) return workfileId(oneLine?.[1]);
  const label = new RegExp(`^${WORKFILE_LABEL}:$`, "i");
  for (const pair of stackedHeaderValues(source)) {
    if (label.test(pair.label) && workfileId(pair.value)) return workfileId(pair.value);
  }
  return null;
}

/**
 * The writer's Federal ID, read only from the writer's own header: beside
 * its Workfile ID (labelled with it, or on one of the next two lines), or,
 * on a print with no Workfile ID (Mitchell), as "Tax ID" in the letterhead
 * block. A repair facility the insurer's print names further down is not
 * the print's writer.
 */
export function readPrintedFederalId(text: string): string | null {
  const source = text ?? "";
  const federalLabel = new RegExp(`^${FEDERAL_LABEL}:$`, "i");
  const workfileLabel = new RegExp(`^${WORKFILE_LABEL}:$`, "i");
  const stacked = stackedHeaderValues(source);
  for (const pair of stacked) {
    // Set in the same run of labels as the writer's Workfile ID, not a
    // repair facility's block further down.
    const besideWorkfile = stacked.some((other) => other.run === pair.run && workfileLabel.test(other.label));
    if (federalLabel.test(pair.label) && besideWorkfile && federalId(pair.value)) return federalId(pair.value);
  }
  const oneLine = source.match(new RegExp(`${WORKFILE_LABEL}:?\\s*${FEDERAL_LABEL}:?\\s*[0-9A-Za-z|]{6,12}\\s+(${FEDERAL_VALUE})(?![0-9])`, "i"));
  if (federalId(oneLine?.[1])) return federalId(oneLine?.[1]);
  const inline = new RegExp(`${FEDERAL_LABEL}:?[ \\t]*(${FEDERAL_VALUE})(?![0-9])`, "i");
  const workfileHeader = source.match(new RegExp(`${WORKFILE_LABEL}:?[^\\n]*(?:\\r?\\n[^\\n]*){0,2}`, "i"))?.[0];
  if (workfileHeader !== undefined) return federalId(workfileHeader.match(inline)?.[1]);
  const letterheadBlock = source.split(/\r?\n/).filter((line) => line.trim()).slice(0, 12).join("\n");
  return federalId(letterheadBlock.match(inline)?.[1]);
}

/**
 * The first line a print sets above everything else, its writer's
 * letterhead, folded to its words ("USAA CASUALTY INSURANCE COMPANY",
 * "conestogacollision.com"). Null when that line is only a document title
 * or too short to name anyone.
 */
export function readPrintedLetterhead(text: string): string | null {
  const generic = /^(?:(?:PRELIMINARY|FINAL|ESTIMATE|SUPPLEMENT|OF|RECORD|WITH|SUMMARY|PAGE|REPAIR|DAMAGE|APPRAISAL|REPORT|WORKFILE|ID|CLAIM)\s*)+$/;
  const lines = (text ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("[[") && !/^=+\s*Page\b/i.test(line));
  // OCR noise (a logo read as a few marks) above the first line is skipped.
  const first = lines.findIndex((line) => line.replace(/[^A-Za-z]/g, "").length >= 4 || /\d/.test(line));
  const line = lines[first] ?? "";
  // The first line only: a name, never a label, an amount, a number or a
  // date line (a letter opens with its date), and never a letter's
  // addressee ("Attn", "Re:", "Dear" below it, after an address block of
  // any length). No estimate print sets these in its opening lines.
  if (!line || /[:$]|\d{3,}/.test(line)) return null;
  if (lines.slice(first + 1, first + 11).some((next) => /^(?:attn|attention|re\s*:|re\s+claim\b|dear|to:|subject|sincerely|enclosed)/i.test(next))) return null;
  const words = ocrLetters(line).toUpperCase().replace(/[^A-Z]+/g, " ").trim();
  // A header label OCR set on the same row ("... INSURANCE CO ESTIMATE ID").
  const letters = words.replace(/ /g, "").replace(/(?:ESTIMATEID|CLAIMNUMBER|WORKFILEID)$/, "").replace(/L/g, "I");
  if (letters.length < 6 || generic.test(words)) return null;
  // A text layer can set the letterhead twice on one line ("Progressive
  // Specialty Insurance CoProgressive Specialty Insurance Co"); OCR reads it once.
  const half = letters.length / 2;
  return letters.length % 2 === 0 && letters.slice(0, half) === letters.slice(half) ? letters.slice(0, half) : letters;
}

export type PrintedPartyMatch = "estimator" | "Workfile ID" | "Federal ID" | "letterhead";

/**
 * The workfile, Federal ID or letterhead two prints share, when they share
 * one. Our letterhead on a print means our system printed it (Mitchell
 * prints no workfile and, unless set to, no Tax ID).
 */
function sharedHeaderId(ours: string, other: string): Exclude<PrintedPartyMatch, "estimator"> | null {
  const workfile = readPrintedWorkfileId(ours);
  if (workfile !== null && workfile === readPrintedWorkfileId(other)) return "Workfile ID";
  const federal = readPrintedFederalId(ours);
  if (federal !== null && federal === readPrintedFederalId(other)) return "Federal ID";
  const letterhead = readPrintedLetterhead(ours);
  if (letterhead !== null && letterhead === readPrintedLetterhead(other)) return "letterhead";
  return null;
}

/**
 * A shop's working draft: CCC prints an estimate it has not committed as
 * "Preliminary Estimate" / "Preliminary Supplement N", and a committed one
 * as "Estimate of Record" / "Supplement of Record N". An insurer sends its
 * committed record, so a preliminary print under our header is our own.
 */
const printsPreliminary = (text: string) => /\bPreliminary\s+(?:Estimate|Supplement)\b/i.test(text ?? "") && readPrintedEstimateVersion(text) === null;

/**
 * What makes `other` the same party's estimate as `ours`, whatever its file
 * name says: the same printed estimator, or our CCC workfile or Federal ID
 * with no other writer named. Null when nothing printed ties them, and when
 * the print conflicts (see printedPartyConflict).
 */
export function samePrintedParty(ours: string, other: string): PrintedPartyMatch | null {
  if (sameEstimator(ours, other)) return "estimator";
  return printedPartyConflict(ours, other) ? null : sharedHeaderId(ours, other);
}

/**
 * Our workfile or Federal ID on a print that names a writer other than our
 * estimator, on a committed print. It may be our own version by a second
 * estimator, or the insurer's estimate printed from our own system after an
 * assignment, which carries our header and their appraiser: the print alone
 * does not say which, so it is neither ours nor theirs. A preliminary print
 * is our own draft, whoever wrote it.
 */
export function printedPartyConflict(ours: string, other: string): Exclude<PrintedPartyMatch, "estimator"> | null {
  if (sameEstimator(ours, other) || readPrintedEstimator(ours) === null || readPrintedEstimator(other) === null || printsPreliminary(other)) return null;
  return sharedHeaderId(ours, other);
}

/**
 * A file name as words: camel case and every separator split, so tokens
 * match whole ("GeicoSupplement1" -> "geico supplement1", "SOR-1_22279" ->
 * "sor 1 22279"; "Windsor" is not "SOR", "Spartan" is not "RTA").
 */
const nameWords = (fileName: string) =>
  ` ${(fileName ?? "")
    .replace(/\.[A-Za-z0-9]{2,4}$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase()} `;
/** A word that names the insurer's document as such. */
const INSURER_WORD = /\b(?:sor\d*|carriers?|insur(?:ance|er|ers)|adjusters?)\b/;
/**
 * "Appraiser" names the insurer's appraiser and everyone else's too. A
 * license line does not tell them apart (independent and owner-side
 * appraisers are licensed as well), so only the name decides: the
 * insurer's staff ("staff appraiser") is as plain as SOR, another party's
 * ("insured's appraiser") is not the insurer's at all, and a bare
 * "appraiser" is the weakest mark.
 */
const APPRAISER_WORD = /\bappraisers?\b/;
const INSURER_APPRAISER = /\b(?:staff|company|desk|field)\s+appraisers?\b/;
/** An insurer's brand: a shop names its own files this way too, so it is weaker evidence. */
const INSURER_BRAND = /\b(?:geico|state ?farm|progressive|allstate|usaa|nationwide|liberty ?mutual|farmers|travelers)\b/;
const SHOP_WORD = /\b(?:shop|repair facility|rta|appraisal)\b/;
const marksInsurer = (words: string) => INSURER_WORD.test(words) || INSURER_APPRAISER.test(words) || INSURER_BRAND.test(words);
/**
 * Another party's by name, whatever else the name says: the insured's,
 * owner's or claimant's own appraiser ("insured's appraiser" reads "insured s
 * appraiser"), ours, an umpire, an appraisal award, a public adjuster. A
 * shop files every claim document under the insurer's name, so neither the
 * brand nor a word about the insurer ("vs carrier") makes one the insurer's.
 */
const OTHER_PARTY =
  /\b(?:insureds?|insd|policy ?holders?|owners?|customers?|our|my)(?: s)?(?: (?:own|independent|indep|hired|licensed|private))? (?:appr(?:aisers?)?|ia)\b/;
/** An umpire, an award or a public adjuster, unless the name also marks the insurer as its author ("Carrier supplement to award"). */
const OTHER_ROLE = /\bumpires?\b|\b(?<!(?:per|post|after) )award\b|\bpublic adjusters?\b/;
/**
 * The same parties named anywhere in an appraiser's file name ("Appraiser -
 * Insured", "Appraiser hired by owner", "Appraiser estimate for insured"),
 * when nothing in the name marks it the insurer's ("State Farm appraiser
 * estimate for insured" is State Farm's). A copy sent to the insured
 * ("insured copy") names its recipient, not its author.
 */
const PARTY_ANYWHERE = /\b(?:insureds?|insd|policy ?holders?|owners?)\b/;
/** A party named as where the file went or came from ("from owner", "sent to insured", "owner copy"), not whose appraiser wrote it. */
const PARTY_REFERENCE =
  /\b(?:from|to|sent to|copy to|via)(?: the)? (?:insureds?|insd|policy ?holders?|owners?|customers?)\b(?!(?<=s)(?: (?:own|independent|indep|hired|licensed|private))? (?:appr|ia\b))(?! s(?: (?:own|independent|indep|hired|licensed|private))? (?:appr|ia\b))|\b(?:insureds?|insd|policy ?holders?|owners?|customers?)(?: s)? (?:copy|forwarded)\b/g;
/** The claim prefix a shop puts on every file ("USAA 22279 ...", "USAA claim 22279 ..."): the insurer's name there files it, it does not author it. */
const CLAIM_PREFIX = /^ (?:geico|state ?farm|progressive|allstate|usaa|nationwide|liberty ?mutual|farmers|travelers)(?: claim)? \d+ /;
const APPRAISER_ANY = /\bappr(?:aisers?)?\b/;
/** An independent appraiser ("IA") is hired by either side: another party's only when nothing in the name marks it the insurer's. */
const INDEPENDENT_APPRAISER = /\b(?:independent|indep|ia)(?: s)? appr(?:aisers?)?\b/;
/**
 * The insurer named as the addressee or subject of the file, not its author:
 * "sent to insurance", "request to USAA adjuster", "vs USAA SOR", "post SOR",
 * "SOR response" name a shop's file about the insurer's estimate. A party
 * named before a response or after "per" is the author ("Carrier response",
 * "Estimate per adjuster"), so only the insurer's document, the SOR, is a
 * subject there.
 */
const PARTY_TERM = "(?:carriers?|insur(?:ance|er|ers)|ins|adjusters?|geico|state ?farm|progressive|allstate|usaa|nationwide|liberty ?mutual|farmers|travelers)";
const DOC_TERM = "sor\\d*(?: \\d+)?";
const INSURER_REFERENCE = new RegExp(
  [
    `\\b(?:to|for|vs|versus|v|against|with|w|request(?:ed)?)(?: the)?(?: (?:${PARTY_TERM}(?: \\d+)?|${DOC_TERM}))+\\b`,
    // A copy made for the insurer names its recipient ("insurance copy", "adjuster copy").
    `\\b(?:${PARTY_TERM} )+copy\\b`,
    `\\b(?:re|post|after|per)(?: the)?(?: ${PARTY_TERM})* ${DOC_TERM}\\b`,
    `\\b(?:${PARTY_TERM} )*${DOC_TERM} (?:response|rebuttal|reply|changes)\\b`,
  ].join("|"),
  "g"
);
/** The name's words with every mere reference to the insurer taken out. */
const authorshipWords = (words: string) => ` ${words.replace(INSURER_REFERENCE, " ").replace(/\s+/g, " ").trim()} `;

/**
 * Whose appraiser a file's name says it is, when not the insurer's own:
 * "other" for an insured's, owner's or claimant's appraiser, an umpire, an
 * appraisal award or a public adjuster; "independent" for an independent
 * appraiser the name does not mark as the insurer's (either side hires one;
 * "for USAA" says USAA hired it, "vs carrier" does not).
 */
function appraiserNamed(fileName: string): "other" | "independent" | null {
  const words = nameWords(fileName);
  const partyWords = ` ${words.replace(PARTY_REFERENCE, " ").replace(/\s+/g, " ").trim()} `;
  if (OTHER_PARTY.test(partyWords)) return "other";
  // Marks of the insurer that are its authorship, not its claim prefix or a
  // reference to it ("Appraiser for insured vs USAA").
  const authored = authorshipWords(words.replace(CLAIM_PREFIX, " "));
  // "Public adjuster" holds the word "adjuster": it is the role, not the insurer's mark.
  const roleFree = authored.replace(/\bpublic adjusters?\b/g, " ");
  if (OTHER_ROLE.test(partyWords) && !INSURER_WORD.test(roleFree) && !INSURER_APPRAISER.test(roleFree)) return "other";
  if (APPRAISER_ANY.test(partyWords) && PARTY_ANYWHERE.test(partyWords) && !marksInsurer(authored)) return "other";
  // "for USAA" says the insurer hired it; "for USAA claim 22279" only files it.
  const hiredByInsurer = marksInsurer(authored) || new RegExp(`\\bfor(?: the)? ${PARTY_TERM}\\b(?! claim)`).test(words);
  return INDEPENDENT_APPRAISER.test(words) && !hiredByInsurer ? "independent" : null;
}

/**
 * True when a file's name marks it as an appraiser's estimate that is not
 * shown to be the insurer's (an insured's, owner's or independent
 * appraiser, an umpire, an appraisal award, a public adjuster).
 */
export function namesAnotherPartysEstimate(fileName: string): boolean {
  return appraiserNamed(fileName) !== null;
}

/** An insurer's authorship mark left in a name once its claim prefix and references to the insurer are taken out. */
const namedAsInsurers = (fileName: string) =>
  marksInsurer(authorshipWords(nameWords(fileName).replace(CLAIM_PREFIX, " ")).replace(/\bpublic adjusters?\b/g, " "));

type SetAside = "conflict" | "other" | "independent";

export type CounterpartCandidate = {
  fileName: string;
  text: string;
  sourceDocumentId?: string;
  /** The party the caller labelled it with, when it did. */
  estimateRole?: "carrier" | "shop";
};

export type CounterpartSelection<T extends CounterpartCandidate> = {
  counterpart: T | null;
  excluded: Array<{ candidate: T; reason: string }>;
  /** Which printed evidence decided between several of the other party's estimates; null when it did not arise. */
  basis: string | null;
  /**
   * The estimates left when several were and nothing settles which one is
   * the other party's (none marked as theirs, a conflicting mark, or the
   * most plainly marked one is not the latest): the counterpart was picked
   * among them, and nothing says whose it is. Empty when the party was
   * identified.
   */
  unidentified: T[];
  /** Why the estimate compared was itself set aside, when only set-aside estimates were left; null otherwise. */
  counterpartCaveat?: string | null;
};

const stamp = (value: number) => {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

/**
 * The latest of a pool by what the prints state: the supplement number, else
 * the print time, else the order on the case. Returns the index of the
 * latest, the basis, and the reason each other one is not it.
 */
function orderByPrintedEvidence<T extends CounterpartCandidate>(pool: T[]) {
  const distinct = (values: Array<number | null>): values is number[] =>
    values.every((value) => value !== null) && new Set(values).size === values.length;
  const versions = pool.map((candidate) => readPrintedEstimateVersion(candidate.text));
  const printed = pool.map((candidate) => readLatestPrintedTimestamp(candidate.text));
  if (pool.length > 1 && distinct(versions)) {
    const best = versions.indexOf(Math.max(...versions));
    const printedAs = (version: number) => (version === 0 ? "Estimate of Record" : `supplement ${version}`);
    return {
      best,
      basis: "printed supplement number" as string | null,
      rank: versions as number[],
      reason: (index: number) => `it prints ${printedAs(versions[index]!)}; ${pool[best].fileName} prints ${printedAs(versions[best]!)}`,
    };
  }
  if (pool.length > 1 && distinct(printed)) {
    const best = printed.indexOf(Math.max(...printed));
    return {
      best,
      basis: "print date" as string | null,
      rank: printed as number[],
      reason: (index: number) => `printed ${stamp(printed[index]!)}; ${pool[best].fileName} was printed ${stamp(printed[best]!)}`,
    };
  }
  // Neither printed evidence orders them: the last one on the case.
  const best = pool.length - 1;
  return {
    best,
    basis: (pool.length > 1 ? "case file order" : null) as string | null,
    rank: null,
    reason: () => `${pool[best]?.fileName} comes later on the case, and neither prints a supplement number or print date that orders them`,
  };
}

export function selectComparisonCounterpart<T extends CounterpartCandidate>(
  candidates: T[],
  options: {
    /** The party of the annotated estimate, as the builder resolved it. */
    sourceParty: "shop" | "carrier";
    /** A canonical delta binding names the comparison document outright. */
    pinnedSourceDocumentId?: string | null;
    /** The annotated estimate's own text: an estimate printing its estimator is the same party's. */
    sourceText?: string;
  }
): CounterpartSelection<T> {
  if (candidates.length <= 1) return { counterpart: candidates[0] ?? null, excluded: [], basis: null, unidentified: [] };

  const pinned = options.pinnedSourceDocumentId
    ? candidates.find((candidate) => candidate.sourceDocumentId === options.pinnedSourceDocumentId)
    : undefined;
  if (pinned) {
    return {
      counterpart: pinned,
      excluded: candidates
        .filter((candidate) => candidate !== pinned)
        .map((candidate) => ({ candidate, reason: `the case's bound delta pair names ${pinned.fileName}` })),
      basis: "the bound delta pair",
      unidentified: [],
    };
  }

  const excluded: CounterpartSelection<T>["excluded"] = [];
  // An estimate whose totals cannot be read is not something to measure against.
  const readable = candidates.filter((candidate) => candidate.text.trim() && parseEstimateTotalsForPlatform(candidate.text)?.grandTotal != null);
  const base = readable.length ? readable : candidates;
  for (const candidate of candidates) {
    if (!base.includes(candidate)) excluded.push({ candidate, reason: "its totals could not be read" });
  }

  // What each estimate's own print and name say about whose it is. The
  // caller's label is not evidence here: the route labels an unmarked file
  // by a last-resort guess. Ours: what it prints ties it to the annotated
  // estimate (the same estimator, or our CCC workfile or Federal ID), or a
  // name marking it as the source party's. Theirs, most plainly first: a
  // word naming the document as theirs, their brand in the name, their
  // authorship phrase in the text (a shop note — "BLEND NOT ON USAA
  // ESTIMATE" — reads the same, so it is the weakest). A name that only
  // addresses the insurer ("Supplement sent to insurance", "post SOR")
  // marks nothing.
  const shopSource = options.sourceParty === "shop";
  const sourceText = options.sourceText ?? "";
  const evidence = new Map<T, { ours: boolean; byPrint: PrintedPartyMatch | null; conflict: Exclude<PrintedPartyMatch, "estimator"> | null; tier: number; bareAppraiser: boolean; setAside: SetAside | null }>(
    base.map((candidate) => {
      const words = nameWords(candidate.fileName);
      const named = authorshipWords(words);
      const authored = isCarrierAuthoredEstimateDocument({ filename: "", text: candidate.text });
      const byPrint = sourceText ? samePrintedParty(sourceText, candidate.text) : null;
      const ours = byPrint !== null || (shopSource ? SHOP_WORD.test(named) : INSURER_WORD.test(named) || INSURER_BRAND.test(named));
      const tier = shopSource
        ? INSURER_WORD.test(named) || INSURER_APPRAISER.test(named)
          ? 3
          : INSURER_BRAND.test(named)
            ? 2
            : authored || APPRAISER_WORD.test(named)
              ? 1
              : 0
        : SHOP_WORD.test(named) ? 3 : !authored ? 1 : 0;
      // Marked by nothing but a bare "appraiser" in its name: in an
      // appraisal, every party has one.
      const bareAppraiser = shopSource && tier === 1 && !authored;
      // Set aside, neither ours nor theirs: our workfile under another
      // writer's name, or a name marking another party's appraiser. What it
      // prints outranks its name.
      const conflict = shopSource && sourceText && byPrint === null ? printedPartyConflict(sourceText, candidate.text) : null;
      const setAside: SetAside | null = !shopSource || byPrint !== null ? null : conflict ? "conflict" : appraiserNamed(candidate.fileName);
      return [candidate, { ours, byPrint, conflict, tier, bareAppraiser, setAside }];
    })
  );
  const ev = (candidate: T) => evidence.get(candidate)!;
  const writer = (candidate: T) => readPrintedEstimator(candidate.text);
  const workfile = (candidate: T) => readPrintedWorkfileId(candidate.text);
  const letterhead = (candidate: T) => readPrintedLetterhead(candidate.text);
  const claim = (candidate: T) => readClaimIdentity(candidate.text).claimNumber;
  const sourceWorkfile = readPrintedWorkfileId(sourceText);
  // Two prints one writer made on one claim: the same licensed appraiser,
  // the same CCC workfile, or the same print uploaded twice. A letterhead
  // is a whole company's (an insurer prints it on every claim), so it ties
  // two prints only when they also print the same claim number.
  const tiedBy = (a: T, b: T): string | null => {
    if (a.text.replace(/\s+/g, " ").trim() === b.text.replace(/\s+/g, " ").trim()) return "print";
    if (workfile(a) !== null && workfile(a) === workfile(b)) return "Workfile ID";
    if (writer(a) !== null && sameEstimator(a.text, b.text) && (printsAppraiserLicense(a.text) || printsAppraiserLicense(b.text))) return "licensed appraiser";
    const claimA = claim(a);
    const claimB = claim(b);
    if (letterhead(a) !== null && letterhead(a) === letterhead(b) && claimA && claimB && sameClaimNumber(claimA, claimB)) return "letterhead and claim number";
    return null;
  };
  // Lifted back before anything is weighed: a set-aside whose print is the
  // insurer's own, because it prints the insurer's CCC workfile (not ours) or
  // names the same licensed appraiser as a file named as the insurer's. No
  // other party prints the insurer's workfile and appraiser: this is the
  // insurer's IA on its own profile, its revision named for an award, or its
  // later version printed from our system.
  const insurerMarked = (candidate: T) => !ev(candidate).setAside && !ev(candidate).ours && ev(candidate).tier > 0;
  const printsInsurers = (candidate: T, other: T) =>
    (workfile(candidate) !== null && workfile(candidate) === workfile(other) && workfile(candidate) !== sourceWorkfile) ||
    (writer(candidate) !== null && sameEstimator(candidate.text, other.text) && (printsAppraiserLicense(candidate.text) || printsAppraiserLicense(other.text)));
  for (const candidate of base) {
    const kind = ev(candidate).setAside;
    const plainlyTheirs = (other: T) => insurerMarked(other) && (kind === "conflict" || ev(other).tier === 3);
    if (kind && base.some((other) => other !== candidate && plainlyTheirs(other) && printsInsurers(candidate, other))) ev(candidate).setAside = null;
  }
  // Set aside before anything is weighed: our workfile under another
  // writer's name, another party's appraiser ("Insured's Appraiser
  // 22279.pdf"), and any estimate that party's print ties to it (its own
  // revision under a brand-only name is still that appraiser's) unless the
  // estimate is named as plainly the insurer's (an SOR-type name).
  // Never to an estimate that prints the insurer's own workfile or licensed
  // appraiser of a file named as plainly the insurer's: what lifts a
  // set-aside above keeps one from spreading.
  const setAsides = base.filter((candidate) => ev(candidate).setAside);
  for (const candidate of base) {
    if (ev(candidate).setAside || ev(candidate).ours || !shopSource || ev(candidate).tier === 3) continue;
    if (base.some((other) => other !== candidate && insurerMarked(other) && ev(other).tier === 3 && printsInsurers(candidate, other))) continue;
    const named = setAsides.find((other) => ev(other).setAside !== "conflict" && tiedBy(candidate, other));
    if (named) {
      ev(candidate).setAside = ev(named).setAside;
      setAsides.push(candidate);
      excluded.push({ candidate, reason: `it prints the same ${tiedBy(candidate, named)} as ${named.fileName}, which is set aside` });
    }
  }
  for (const candidate of setAsides) {
    if (excluded.some((entry) => entry.candidate === candidate)) continue;
    const kind = ev(candidate).setAside;
    excluded.push({
      candidate,
      reason:
        kind === "conflict"
          ? `it prints the annotated estimate's ${ev(candidate).conflict} but names a different writer, so nothing printed says whether it is ours or the insurer's printed from our system`
          : kind === "other"
            ? "its name marks it as an appraiser other than the insurer's"
            : "its name marks it as an independent appraiser's, and nothing in it shows that appraiser is the insurer's",
    });
  }
  const weighed = base.filter((candidate) => !ev(candidate).setAside);
  const clean = weighed.filter((candidate) => !ev(candidate).ours && ev(candidate).tier > 0);
  // A name mark of ours against a mark of theirs is a conflict; a print
  // tying it to the annotated estimate is proof, never a conflict.
  const conflicted = weighed.filter((candidate) => ev(candidate).ours && ev(candidate).byPrint === null && ev(candidate).tier > 0);
  const unknown = weighed.filter((candidate) => !ev(candidate).ours && ev(candidate).tier === 0);
  const theirs = shopSource ? "the insurer's" : "a shop estimate";
  const oursReason = (candidate: T) =>
    ev(candidate).byPrint
      ? `it prints the same ${ev(candidate).byPrint} as the annotated estimate, so it is the same party's`
      : shopSource
        ? "its name marks it as a shop estimate, like the annotated one"
        : "its name marks it as the insurer's, like the annotated one";
  const markedAs = (tier: number) =>
    tier === 3 ? "its name" : tier === 2 ? "the insurer's name in its file name" : shopSource ? "a phrase in its text" : "its text";

  // Set aside on grounds that do not rule out the insurer: an independent
  // appraiser, our workfile under another writer, another party's name that
  // also marks the insurer as its author.
  const uncertainAside = (candidate: T) =>
    ev(candidate).setAside === "independent" || ev(candidate).setAside === "conflict" || (ev(candidate).setAside === "other" && namedAsInsurers(candidate.fileName));

  let pool: T[];
  let unidentified: T[] = [];
  if (clean.length) {
    const topTier = Math.max(...clean.map((candidate) => ev(candidate).tier));
    // The most plainly marked, plus any estimate not shown to be ours that
    // one of them is tied to by print: the insurer's versions named
    // differently ("Insurance estimate.pdf", then "USAA_22279.pdf" or
    // "Carrier response.pdf") are still one appraiser's. A shop estimator
    // prints no license, so two shop versions never join by name.
    const marked = clean.filter((candidate) => ev(candidate).tier === topTier);
    const top = [...clean, ...unknown].filter((candidate) => marked.includes(candidate) || marked.some((mark) => tiedBy(candidate, mark)));
    const ranked = [...clean, ...top.filter((candidate) => !clean.includes(candidate))];
    const overall = orderByPrintedEvidence(ranked);
    const latest = ranked[overall.best];
    // The most plainly marked one must also be the latest the prints show.
    // While the best mark is weak (a brand, a bare "appraiser", a phrase),
    // no other estimate not shown to be ours may sit beside it, marked
    // differently, marked both ways, or unmarked: a shop names its own files
    // after the insurer too, and an OCR'd SOR may carry no mark at all.
    const latestIsTop = overall.rank === null || top.includes(latest);
    const weakDisagree =
      topTier < 3 &&
      (conflicted.length > 0 || unknown.some((candidate) => !top.includes(candidate)) || clean.some((candidate) => !top.includes(candidate)));
    // Equal marks settle nothing either, however plain: our later version
    // named "USAA 22279 Final.pdf" or "Response to USAA SOR 1.pdf" sits
    // beside the insurer's file, and the later print would win. Several are
    // one party's only when what they print ties them.
    const linked = new Set<T>([top[0]]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const candidate of top) {
        if (!linked.has(candidate) && [...linked].some((other) => tiedBy(candidate, other))) {
          linked.add(candidate);
          grew = true;
        }
      }
    }
    const untied = linked.size < top.length;
    // A bare "appraiser" beside another party's appraiser shows nothing
    // about whose appraiser it is, also when its own revision joins it by
    // print. And a weakly marked estimate is not shown to be the insurer's
    // beside an estimate set aside that may have been the insurer's own (an
    // independent appraiser's, our workfile under another writer, another
    // party's name that also marks the insurer).
    const besideSetAside =
      (setAsides.length > 0 && marked.every((candidate) => ev(candidate).bareAppraiser)) ||
      (topTier < 3 && setAsides.some(uncertainAside));
    if (!latestIsTop || weakDisagree || untied || besideSetAside) {
      unidentified = [...new Set([...top, ...clean, ...conflicted, ...(topTier < 3 ? unknown : []), ...(besideSetAside ? setAsides : [])])];
    }
    // Unsettled or not, the forensic run is measured against the most plainly
    // marked: a later file marked only by a brand or a phrase may be ours.
    pool = top;
    for (const candidate of weighed) {
      if (top.includes(candidate) || unidentified.includes(candidate)) continue;
      if (ev(candidate).ours) excluded.push({ candidate, reason: oursReason(candidate) });
      else if (clean.includes(candidate)) {
        excluded.push({ candidate, reason: `only ${markedAs(ev(candidate).tier)} marks it as ${theirs}; ${top[0].fileName} is marked by ${markedAs(topTier)}` });
      } else excluded.push({ candidate, reason: `neither its name nor its text identifies it as ${theirs}` });
    }
  } else {
    const ambiguous = [...conflicted, ...unknown];
    // Nothing marked as theirs: an unmarked estimate, else one set aside for
    // printing our workfile under another writer (it may be the insurer's).
    const printConflicts = setAsides.filter((candidate) => ev(candidate).setAside === "conflict");
    pool = ambiguous.length ? ambiguous : printConflicts.length ? printConflicts : weighed.length ? weighed : base;
    if (ambiguous.length > 1) unidentified = ambiguous;
    // With another party's estimate set aside, a lone unmarked estimate is
    // not shown to be the insurer's (it may be our own other version); with
    // only set-aside estimates left, nothing here is the insurer's.
    else if (setAsides.length && ambiguous.length) unidentified = [...ambiguous, ...setAsides];
    else if (!ambiguous.length && printConflicts.length) unidentified = [...printConflicts];
    else if (!weighed.length && base.length > 1) unidentified = base;
    for (const candidate of weighed) {
      if (!pool.includes(candidate)) excluded.push({ candidate, reason: oursReason(candidate) });
    }
  }

  const order = orderByPrintedEvidence(pool);
  const counterpart = pool[order.best];
  // NOTHING LEFT OUT ON UNCERTAIN GROUNDS MAY BE NEWER THAN THE ONE COMPARED.
  // An estimate set aside without ruling out the insurer, or taken as ours
  // only because it carries our header (our workfile, Federal ID or
  // letterhead, with no writer of ours on it), may be the insurer's later
  // version: if it prints a later supplement or print date than the one
  // compared (or nothing to order them by), the run cannot say the one
  // compared is the insurer's latest. And one named as the insurer's (an
  // SOR, its brand) that only our header ties to us, more plainly named than
  // the one compared and not tied to it by print, may be the insurer's own
  // estimate printed from our system, whatever its date or title: the one
  // compared is then not shown to be the insurer's at all.
  const laterThan = (candidate: T, chosen: T) => {
    const [mine, theirsVersion] = [readPrintedEstimateVersion(candidate.text), readPrintedEstimateVersion(chosen.text)];
    if (mine !== null && theirsVersion !== null && mine !== theirsVersion) return mine > theirsVersion;
    const [printed, chosenPrinted] = [readLatestPrintedTimestamp(candidate.text), readLatestPrintedTimestamp(chosen.text)];
    if (printed !== null && chosenPrinted !== null) return printed > chosenPrinted;
    return mine === null || theirsVersion === null || mine > theirsVersion;
  };
  if (shopSource && counterpart) {
    const byHeader = (candidate: T) => ev(candidate).byPrint !== null && ev(candidate).byPrint !== "estimator";
    const namedOverChosen = (candidate: T) =>
      byHeader(candidate) && ev(candidate).tier >= 2 && ev(candidate).tier > ev(counterpart).tier && !tiedBy(candidate, counterpart);
    const uncertain = base.filter(
      (candidate) =>
        candidate !== counterpart &&
        (((uncertainAside(candidate) || (byHeader(candidate) && !printsPreliminary(candidate.text))) && laterThan(candidate, counterpart)) ||
          namedOverChosen(candidate))
    );
    if (uncertain.length) unidentified = [...new Set([...unidentified, counterpart, ...uncertain])];
  }
  pool.forEach((candidate, index) => {
    if (index !== order.best && !excluded.some((entry) => entry.candidate === candidate)) {
      excluded.push({ candidate, reason: order.reason(index) });
    }
  });
  // Everything the selection set aside that was in the ambiguous set but not the pool.
  for (const candidate of unidentified) {
    if (candidate !== counterpart && !excluded.some((entry) => entry.candidate === candidate)) {
      excluded.push({ candidate, reason: `it may be ${theirs} as well, and nothing printed says which one is` });
    }
  }
  // When only set-aside estimates were left, the one compared is itself
  // set aside: it is named as compared, with that reason, never as both.
  const counterpartCaveat = excluded.find((entry) => entry.candidate === counterpart)?.reason ?? null;
  return { counterpart, excluded: excluded.filter((entry) => entry.candidate !== counterpart), basis: order.basis, unidentified, counterpartCaveat };
}

/**
 * What an estimate prints about itself, for asking the user which upload is
 * the insurer's: its grand total, its version and its latest print time, each
 * null when the print does not carry it. Nothing here is inferred.
 */
export function describePrintedEstimate(text: string): { grandTotal: number | null; version: string | null; printedAt: string | null } {
  const version = readPrintedEstimateVersion(text);
  const printed = readLatestPrintedTimestamp(text);
  return {
    grandTotal: parseEstimateTotalsForPlatform(text)?.grandTotal ?? null,
    version: version === null ? null : version === 0 ? "Estimate of Record" : `Supplement ${version}`,
    printedAt: printed === null ? null : stamp(printed),
  };
}

/** The run warning naming every estimate a selection left out, or null when none was. */
export function describeExcludedComparisons<T extends CounterpartCandidate>(selection: CounterpartSelection<T>): string | null {
  if (!selection.counterpart || selection.excluded.length === 0) return null;
  const reasons = selection.excluded.map(({ candidate, reason }) => `${candidate.fileName} (${reason})`).join("; ");
  const caveat = selection.counterpartCaveat ? `, though it is itself set aside (${selection.counterpartCaveat})` : "";
  return `Compared against ${selection.counterpart.fileName} only${caveat}. Not compared: ${reasons}. To annotate a different version, select it as the estimate to annotate.`;
}
