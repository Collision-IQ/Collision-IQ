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
 * Party tokens in a file name, matched as whole words ("Windsor" is not
 * "SOR", "Spartan" is not "RTA"; "SOR1_22279" and "USAA-SOR" are). The
 * carriers are the ones the authorship test knows.
 */
const CARRIER_NAME =
  /(?<![a-z])(?:carriers?|insur(?:ance|er|ers)?|sor|adjusters?|geico|state\s*farm|progressive|allstate|usaa|nationwide|liberty\s*mutual|farmers|travelers)(?![a-z])/i;
const SHOP_NAME = /(?<![a-z])(?:shop|repair\s*facility|rta|appraisal)(?![a-z])/i;

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
   * The estimates left when several were and none could be identified as
   * the other party's by its name or its text: the counterpart was then
   * picked among them by print order alone, and nothing says whose it is.
   * Empty when the party was identified.
   */
  unidentified: T[];
};

const stamp = (value: number) => {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

export function selectComparisonCounterpart<T extends CounterpartCandidate>(
  candidates: T[],
  options: {
    /** The party of the annotated estimate, as the builder resolved it. */
    sourceParty: "shop" | "carrier";
    /** A canonical delta binding names the comparison document outright. */
    pinnedSourceDocumentId?: string | null;
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

  // The other party is what the document's own authorship reads as, OR what
  // the caller labelled it from a party token in its NAME (a Mitchell
  // supplement prints no authorship boilerplate). A label the caller only
  // guessed — the route's last resort labels an unmarked file the opposite
  // of the source — admits nothing: it let the shop's own later estimate in
  // as "theirs" ahead of the SOR. A file NAMED as the source party's stays
  // its own whatever a note in its text says ("BLEND NOT ON USAA ESTIMATE").
  const otherRole = options.sourceParty === "shop" ? "carrier" : "shop";
  const partyName = (role: "carrier" | "shop") => (role === "carrier" ? CARRIER_NAME : SHOP_NAME);
  const carrierAuthored = (candidate: T) => isCarrierAuthoredEstimateDocument({ filename: candidate.fileName, text: candidate.text });
  const labelledByName = (candidate: T) => candidate.estimateRole === otherRole && partyName(otherRole).test(candidate.fileName);
  const namedAsSource = (candidate: T) =>
    (candidate.estimateRole ?? options.sourceParty) === options.sourceParty && partyName(options.sourceParty).test(candidate.fileName);
  // A name is chosen by a person; a phrase in the text can be a note. An
  // estimate whose NAME marks it as theirs outranks one only its text does.
  const byName = (candidate: T) =>
    labelledByName(candidate) ||
    (otherRole === "carrier" && isCarrierAuthoredEstimateDocument({ filename: candidate.fileName, text: "" }));
  const byAuthorship = candidates.filter(
    (candidate) => !namedAsSource(candidate) && (byName(candidate) || carrierAuthored(candidate) === (otherRole === "carrier"))
  );
  const namedOther = byAuthorship.filter(byName);
  const otherParty = namedOther.length ? namedOther : byAuthorship;
  // Nothing identified as theirs: measure against what is not named as ours,
  // and say that nothing identifies it unless exactly one such estimate is
  // left (then it stands as a lone comparison would, on the caller's label).
  const unnamed = candidates.filter((candidate) => !namedAsSource(candidate));
  const partyPool = otherParty.length ? otherParty : unnamed.length ? unnamed : candidates;
  const unidentified = otherParty.length > 0 || unnamed.length <= 1 ? [] : unnamed;
  // An estimate whose totals cannot be read is not something to measure against.
  const readable = partyPool.filter((candidate) => candidate.text.trim() && parseEstimateTotalsForPlatform(candidate.text)?.grandTotal != null);
  const pool = readable.length ? readable : partyPool;

  const excluded: CounterpartSelection<T>["excluded"] = [];
  const partyReason = (candidate: T) =>
    namedAsSource(candidate)
      ? options.sourceParty === "shop"
        ? "its name marks it as a shop estimate, like the annotated one"
        : "its name marks it as the insurer's, like the annotated one"
      : options.sourceParty === "shop"
        ? byAuthorship.includes(candidate)
          ? "only a phrase in its text reads as the insurer's, and another estimate's name marks it as theirs"
          : "neither its name nor its text identifies it as the insurer's estimate"
        : "it was labelled or read as the insurer's estimate, like the annotated one";
  for (const candidate of candidates) {
    if (!partyPool.includes(candidate)) excluded.push({ candidate, reason: partyReason(candidate) });
    else if (!pool.includes(candidate)) excluded.push({ candidate, reason: "its totals could not be read" });
  }

  const distinct = (values: Array<number | null>): values is number[] =>
    values.every((value) => value !== null) && new Set(values).size === values.length;
  const versions = pool.map((candidate) => readPrintedEstimateVersion(candidate.text));
  const printed = pool.map((candidate) => readLatestPrintedTimestamp(candidate.text));
  let order: number[];
  let basis: string | null = null;
  let reason: (index: number) => string;
  if (pool.length > 1 && distinct(versions)) {
    order = versions;
    basis = "printed supplement number";
    const printedAs = (version: number) => (version === 0 ? "Estimate of Record" : `supplement ${version}`);
    reason = (index) => `it prints ${printedAs(versions[index]!)}; ${pool[best].fileName} prints ${printedAs(versions[best]!)}`;
  } else if (pool.length > 1 && distinct(printed)) {
    order = printed;
    basis = "print date";
    reason = (index) => `printed ${stamp(printed[index]!)}; ${pool[best].fileName} was printed ${stamp(printed[best]!)}`;
  } else {
    // Neither printed evidence orders them: the last one on the case.
    order = pool.map((_, index) => index);
    basis = pool.length > 1 ? "case file order" : null;
    reason = () =>
      `${pool[best].fileName} comes later on the case, and neither prints a supplement number or print date that orders them`;
  }
  const best = order.indexOf(Math.max(...order));
  const counterpart = pool[best];
  pool.forEach((candidate, index) => {
    if (index !== best) excluded.push({ candidate, reason: reason(index) });
  });
  return { counterpart, excluded, basis, unidentified };
}

/** The run warning naming every estimate a selection left out, or null when none was. */
export function describeExcludedComparisons<T extends CounterpartCandidate>(selection: CounterpartSelection<T>): string | null {
  if (!selection.counterpart || selection.excluded.length === 0) return null;
  const reasons = selection.excluded.map(({ candidate, reason }) => `${candidate.fileName} (${reason})`).join("; ");
  return `Compared against ${selection.counterpart.fileName} only. Not compared: ${reasons}. To annotate a different version, select it as the estimate to annotate.`;
}
