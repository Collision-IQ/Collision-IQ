/**
 * Narrative guardrails for the Appraisal Dispute Report.
 *
 * buildSummaryFacts() decides WHICH claim sentences may be printed at all —
 * each is backed by the ledger or an evidence object, or it is null.
 * lintSummaryText() is the ship gate on the rendered text: the report is
 * refused on any violation. Lint runs on each rendered unit (a paragraph, a
 * bullet, a table cell) rather than the whole document, so an exemption in one
 * sentence ("zero aftermarket") can never excuse a claim in another, and a
 * "$0.00" in one row cannot be paired with "sublet" three sections away.
 */
import type { GapLedger } from "./gapLedger";
import type { Flag } from "./integrityChecks";
import type { GroupDelta } from "./operationEquivalence";
import type { PartTypeEvidence } from "./partTypeEvidence";

export interface SummaryFacts {
  headline: string;
  /** Printed only when both sheets are shown to be OEM. */
  notParts: string | null;
  /** Printed only when the carrier's rate adjustment settles the rates. */
  notRates: string | null;
  mostlyHours: string | null;
  /** Evidence-based only: the carrier's own exclusion note, or the group hours. */
  adasSentence: string | null;
  /** Resolve before arguing: high-dollar carrier-only lines, trim-contradicting part numbers. */
  checkFirst: Flag[];
  /** Our own sheet: missing reusable parts, under-coded lines, repeats, our duplicate part numbers. */
  cleanUpOurs: Flag[];
  /** The carrier's sheet: unpriced lines, their duplicate part numbers, part-number variants, their under-coding. */
  askCarrier: Flag[];
}

export const usd = (n: number): string => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function buildSummaryFacts(
  ledger: GapLedger,
  partType: PartTypeEvidence,
  groups: GroupDelta[],
  flags: Flag[]
): SummaryFacts {
  const hoursShare = ledger.gap > 0 ? Math.round((ledger.laborHours.dollars / ledger.gap) * 100) : 0;
  const adas = groups.find((g) => g.key === "adas");
  const adasDiff = adas ? Math.round((adas.shopHours - adas.carrierHours) * 10) / 10 : 0;
  const checkFirstKinds = new Set(["carrierOnlyHighDollar", "trimConflictPartNumber"]);
  return {
    headline: `Why the two estimates differ by ${usd(ledger.gap)}`,
    notParts: partType.bothAllOem
      ? "Both estimates use new factory (OEM) parts; the carrier's parts-usage page lists zero aftermarket, used or reconditioned parts."
      : null,
    notRates: ledger.rate.settledByAdjustment
      ? `The carrier's sheet prints lower hourly rates but adds a ${usd(ledger.rate.adjustmentAmount)} rate adjustment that brings every hour it approved to our posted rates.`
      : null,
    mostlyHours:
      ledger.laborHours.diff > 0
        ? `We wrote ${ledger.laborHours.diff.toFixed(1)} more labor hours (${ledger.laborHours.shop.toFixed(1)} vs ${ledger.laborHours.carrier.toFixed(1)}), worth ${usd(ledger.laborHours.dollars)} at the same rates, which is ${hoursShare}% of the gap.`
        : null,
    adasSentence:
      adas && adas.exclusions.length
        ? `The carrier's own calibration line says its time ${adas.exclusions[0].toLowerCase()}. That is the work our calibration lines cover.`
        : adas && adasDiff > 0
          ? `We wrote ${adasDiff.toFixed(1)} more hours of calibration and diagnostics than the carrier.`
          : null,
    checkFirst: flags.filter((f) => checkFirstKinds.has(f.kind)),
    cleanUpOurs: flags.filter((f) => !checkFirstKinds.has(f.kind) && (f.side === "shop" || f.kind === "reuseMismatch")),
    // A part paid with no labor is argued as a STRONG item, not asked for twice.
    askCarrier: flags.filter(
      (f) =>
        !checkFirstKinds.has(f.kind) &&
        f.kind !== "reuseMismatch" &&
        f.kind !== "partWithoutLabor" &&
        (f.side === "carrier" || f.kind === "partNumberVariant")
    ),
  };
}

export interface LintContext {
  ledger: GapLedger;
  partType: PartTypeEvidence;
  /** A calibration sublet is written on either sheet. */
  hasDealerCalibrationSublet: boolean;
}

/** Violations for ONE rendered unit of text. Empty = the unit may ship. */
export function lintSummaryText(text: string, ctx: LintContext): string[] {
  const violations: string[] = [];
  const t = text.replace(/\s+/g, " ");
  if (
    !ctx.partType.claimAllowed &&
    /\b(used|aftermarket|recondition(ed)?|recycled|cheaper part)\b/i.test(t) &&
    !/zero aftermarket|not (using )?(cheap|used)/i.test(t)
  ) {
    violations.push("Claims a part-type difference, but neither estimate shows a non-OEM part.");
  }
  if (ctx.ledger.rate.settledByAdjustment && /(pays? less per hour|lower rate).*(real money|worth|compounds)/i.test(t)) {
    violations.push("Argues labor rates, but the carrier's rate adjustment already pays our rates.");
  }
  if (!ctx.hasDealerCalibrationSublet && /dealer (calibration )?invoice/i.test(t)) {
    violations.push("Mentions a dealer calibration invoice, but neither sheet has a calibration sublet.");
  }
  if (/\$0\.00/.test(t) && /\b(misc|sublet)/i.test(t)) {
    violations.push("Prints a $0.00 misc/sublet figure; carrier sublet lines were probably left in the parts column.");
  }
  if (/\bFinding \d+/i.test(t)) {
    violations.push("Cites a Forensic finding number; this report must stand alone.");
  }
  if (/(lowball|bad faith|lying|fraud)/i.test(t) && !/(not|no|never|don.t|nothing).{0,60}(bad faith|intent|lowball)/i.test(t)) {
    violations.push("Intent language.");
  }
  if (/-\$[\d,]+\.\d{2}/.test(t) && /\bparts\b/i.test(t) && ctx.ledger.nonLaborNet >= 0) {
    violations.push("Prints a negative parts figure while the ledger's non-labor net is not negative.");
  }
  return violations;
}

/** Lint every unit; each violation is reported with the text it fired on. */
export function lintSummaryUnits(units: string[], ctx: LintContext): string[] {
  const out: string[] = [];
  for (const unit of units) {
    for (const violation of lintSummaryText(unit, ctx)) {
      const excerpt = unit.replace(/\s+/g, " ").trim();
      out.push(`${violation} ("${excerpt.length > 90 ? `${excerpt.slice(0, 87)}...` : excerpt}")`);
    }
  }
  return out;
}
