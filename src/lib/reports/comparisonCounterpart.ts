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
 * The estimator a CCC print names ("Written By: NAME, …"), folded to its
 * letters; null when none is printed. Two estimates written by the same
 * estimator are the same party's, whatever their file names say: a shop's
 * own version named "USAA 22279 Final.pdf" is still the shop's.
 */
export function readPrintedEstimator(text: string): string | null {
  const name = (text ?? "").match(/Written\s+By:[ \t]*([^,\n]{2,60})/i)?.[1]?.trim() ?? "";
  const words = name.toUpperCase().replace(/[^A-Z]+/g, " ").trim().split(" ").filter(Boolean);
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

/** The print names a licensed appraiser as its writer ("Written By: NAME, License Number: …"). */
function printsAppraiserLicense(text: string): boolean {
  return /Written\s+By:[^\n]*\bLicense\s+(?:Number|No\.?|#)/i.test(text ?? "");
}

/** True when both prints name an estimator and it is the same one. */
export function sameEstimator(a: string, b: string): boolean {
  const left = readPrintedEstimator(a);
  return left !== null && left === readPrintedEstimator(b);
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
/** The qualifier right before "appraiser" ("insured's appraiser" reads "insured s appraiser"). */
const OTHER_APPRAISER = /\b(?:independent|insureds?|policy ?holders?|owners?|claimants?|customers?|umpires?|ia|our|my)(?: s)? appraisers?\b/;
/** An insurer's brand: a shop names its own files this way too, so it is weaker evidence. */
const INSURER_BRAND = /\b(?:geico|state ?farm|progressive|allstate|usaa|nationwide|liberty ?mutual|farmers|travelers)\b/;
const SHOP_WORD = /\b(?:shop|repair facility|rta|appraisal)\b/;

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
  // by a last-resort guess. Ours: the same printed estimator, or a name
  // marking it as the source party's. Theirs, most plainly first: a word
  // naming the document as theirs, their brand in the name, their authorship
  // phrase in the text (a shop note — "BLEND NOT ON USAA ESTIMATE" — reads
  // the same, so it is the weakest).
  const shopSource = options.sourceParty === "shop";
  const evidence = new Map(
    base.map((candidate) => {
      const words = nameWords(candidate.fileName);
      const authored = isCarrierAuthoredEstimateDocument({ filename: "", text: candidate.text });
      const byEstimator = Boolean(options.sourceText) && sameEstimator(options.sourceText!, candidate.text);
      const ours = byEstimator || (shopSource ? SHOP_WORD.test(words) : INSURER_WORD.test(words) || INSURER_BRAND.test(words));
      const tier = shopSource
        ? INSURER_WORD.test(words) || INSURER_APPRAISER.test(words)
          ? 3
          : INSURER_BRAND.test(words)
            ? 2
            : authored || APPRAISER_WORD.test(words)
              ? 1
              : 0
        : SHOP_WORD.test(words) ? 3 : !authored ? 1 : 0;
      // Another party's appraiser by name, and nothing in the name marking it
      // the insurer's ("Insurance appraiser estimate - customer copy" is theirs).
      const thirdParty = shopSource && OTHER_APPRAISER.test(words) && !INSURER_WORD.test(words) && !INSURER_APPRAISER.test(words) && !INSURER_BRAND.test(words);
      return [candidate, { ours, byEstimator, tier, thirdParty }] as const;
    })
  );
  const ev = (candidate: T) => evidence.get(candidate)!;
  // Another party's appraiser ("Insured's Appraiser 22279.pdf") is neither
  // ours nor theirs: set aside before anything is weighed.
  const thirdParties = base.filter((candidate) => ev(candidate).thirdParty);
  for (const candidate of thirdParties) {
    excluded.push({ candidate, reason: "its name marks it as an appraiser other than the insurer's" });
  }
  const weighed = base.filter((candidate) => !ev(candidate).thirdParty);
  const clean = weighed.filter((candidate) => !ev(candidate).ours && ev(candidate).tier > 0);
  // A name mark of ours against a mark of theirs is a conflict; the same
  // printed estimator is proof, never a conflict.
  const conflicted = weighed.filter((candidate) => ev(candidate).ours && !ev(candidate).byEstimator && ev(candidate).tier > 0);
  const unknown = weighed.filter((candidate) => !ev(candidate).ours && ev(candidate).tier === 0);
  const theirs = shopSource ? "the insurer's" : "a shop estimate";
  const oursReason = (candidate: T) =>
    ev(candidate).byEstimator
      ? "it prints the same estimator as the annotated estimate, so it is the same party's"
      : shopSource
        ? "its name marks it as a shop estimate, like the annotated one"
        : "its name marks it as the insurer's, like the annotated one";
  const markedAs = (tier: number) =>
    tier === 3 ? "its name" : tier === 2 ? "the insurer's name in its file name" : shopSource ? "a phrase in its text" : "its text";

  let pool: T[];
  let unidentified: T[] = [];
  if (clean.length) {
    const topTier = Math.max(...clean.map((candidate) => ev(candidate).tier));
    // The most plainly marked, plus any estimate printing the same licensed
    // appraiser as one of them: the insurer's versions named differently
    // ("Insurance estimate.pdf", then "USAA_22279.pdf") are still one
    // appraiser's. A shop estimator prints no license, so two shop versions
    // never join this way.
    const writer = new Map(clean.map((candidate) => [candidate, readPrintedEstimator(candidate.text)]));
    const topWriters = new Set(
      clean
        .filter((candidate) => ev(candidate).tier === topTier && printsAppraiserLicense(candidate.text))
        .map((candidate) => writer.get(candidate))
        .filter(Boolean)
    );
    const top = clean.filter((candidate) => ev(candidate).tier === topTier || topWriters.has(writer.get(candidate) ?? ""));
    const overall = orderByPrintedEvidence(clean);
    const latest = clean[overall.best];
    // The most plainly marked one must also be the latest the prints show.
    // While the best mark is weak (a brand, a bare "appraiser", a phrase),
    // no other estimate not shown to be ours may sit beside it, marked
    // differently, marked both ways, or unmarked: a shop names its own files
    // after the insurer too, and an OCR'd SOR may carry no mark at all.
    const latestIsTop = overall.rank === null || top.includes(latest);
    const weakDisagree =
      topTier < 3 && (conflicted.length > 0 || unknown.length > 0 || clean.some((candidate) => !top.includes(candidate)));
    if (!latestIsTop || weakDisagree) unidentified = [...clean, ...conflicted, ...(topTier < 3 ? unknown : [])];
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
    pool = ambiguous.length ? ambiguous : weighed.length ? weighed : base;
    if (ambiguous.length > 1) unidentified = ambiguous;
    // With another party's appraiser set aside, a lone unmarked estimate is
    // not shown to be the insurer's (it may be our own other version); with
    // only such appraisers left, nothing here is the insurer's.
    else if (thirdParties.length && ambiguous.length) unidentified = [...ambiguous, ...thirdParties];
    else if (!weighed.length && base.length > 1) unidentified = base;
    for (const candidate of weighed) {
      if (!pool.includes(candidate)) excluded.push({ candidate, reason: oursReason(candidate) });
    }
  }

  const order = orderByPrintedEvidence(pool);
  const counterpart = pool[order.best];
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
  return { counterpart, excluded, basis: order.basis, unidentified };
}

/** The run warning naming every estimate a selection left out, or null when none was. */
export function describeExcludedComparisons<T extends CounterpartCandidate>(selection: CounterpartSelection<T>): string | null {
  if (!selection.counterpart || selection.excluded.length === 0) return null;
  const reasons = selection.excluded.map(({ candidate, reason }) => `${candidate.fileName} (${reason})`).join("; ");
  return `Compared against ${selection.counterpart.fileName} only. Not compared: ${reasons}. To annotate a different version, select it as the estimate to annotate.`;
}
