/**
 * Adapter: the Forensic report's input → PlainSummaryInput.
 *
 * This is the only wiring point between the Delta pipeline and the Appraisal
 * Dispute Report. It reads the SAME objects the Forensic Estimate Analysis is
 * rendered from — the reconciliation of both printed totals blocks, and the
 * rows and deltas the pairing produced — plus each document's own text for
 * line notes, manual flags and the parts-usage page. It adds no facts: a
 * figure that cannot be read makes the adapter refuse, with the reason, and
 * no summary ships.
 */
import type { EstimateDeltaRow, EstimateLineItemDelta } from "./estimateDeltaMatcher";
import type { ForensicReconciliation } from "./forensicEstimateAnalysis";
import type { PlainSummaryInput } from "./plainLanguageSummary";
import { estimateFromDeltaRows, pairsFromDeltas, totalsFromReconciliation } from "./appraisalSummary/estimateFromDeltaRows";
import { lineHoursRead, unreadCarrierHours } from "./appraisalSummary/gapLedger";
import type { CaseDocument } from "./laborRationale";

export type PlainSummaryAdapterInput = {
  reconciliation: ForensicReconciliation;
  /** The rows both sides were read into and the matcher's deltas. */
  rows:
    | {
        higher: EstimateDeltaRow[];
        lower: EstimateDeltaRow[];
        deltas: EstimateLineItemDelta[];
        equalPairs?: Array<{ higherLine: number | null; lowerLine: number | null }>;
      }
    | undefined;
  higherDocumentName: string;
  lowerDocumentName: string;
  /** Each document's text layer, for notes, manual flags and the parts-usage page. */
  higherText: string;
  lowerText: string;
  vehicleLabel: string | null;
  roNumber?: string | null;
  identity?: Array<{ label: string; value: string }>;
  generatedAt: string;
  /** The run's export redaction policy; applied to document names. */
  scrub?: (value: string) => string;
  /** The case file's non-estimate documents, passed to the summary as-is. */
  caseDocuments?: CaseDocument[];
};

export type PlainSummaryAdapterResult = { ok: true; input: PlainSummaryInput } | { ok: false; reason: string };

export function adaptForensicToPlainSummary(input: PlainSummaryAdapterInput): PlainSummaryAdapterResult {
  const scrub = input.scrub ?? ((value: string) => value);
  if (!input.rows || input.rows.higher.length === 0 || input.rows.lower.length === 0) {
    return { ok: false, reason: "the line items of both estimates were not read, so the ledger cannot be built from their lines" };
  }
  const higher = totalsFromReconciliation(input.reconciliation, "higher");
  if (!higher.ok) return { ok: false, reason: higher.reason };
  const lower = totalsFromReconciliation(input.reconciliation, "lower");
  if (!lower.ok) return { ok: false, reason: lower.reason };
  if (higher.totals.grandTotal <= lower.totals.grandTotal) {
    return { ok: false, reason: "the annotated estimate is not the higher of the two, so there is no shop-side gap to explain" };
  }

  const identity = input.identity ?? [];
  const roNumber =
    input.roNumber?.trim() || identity.find((row) => /^ro number$/i.test(row.label))?.value?.trim() || undefined;
  const vehicle =
    identity.find((row) => /^vehicle$/i.test(row.label))?.value?.trim() ||
    (input.vehicleLabel?.trim() ? scrub(input.vehicleLabel.trim()) : "Vehicle not identified on the documents");

  // The export redaction policy reaches every description and note the report
  // can quote; part numbers stay as printed so each flag can be checked.
  const redact = (estimate: PlainSummaryInput["shop"]): PlainSummaryInput["shop"] => ({
    ...estimate,
    lines: estimate.lines.map((line) => ({ ...line, desc: scrub(line.desc), note: line.note ? scrub(line.note) : undefined })),
  });

  const shop = estimateFromDeltaRows({
    role: "shop",
    fileName: scrub(input.higherDocumentName),
    rows: input.rows.higher,
    totals: higher.totals,
    userCategory: higher.userCategory,
    userCategories: higher.userCategories,
    text: input.higherText,
  });
  const carrier = estimateFromDeltaRows({
    role: "carrier",
    fileName: scrub(input.lowerDocumentName),
    rows: input.rows.lower,
    totals: lower.totals,
    userCategory: lower.userCategory,
    userCategories: lower.userCategories,
    text: input.lowerText,
  });
  // Every hour the report quotes is a line's, so lines that do not reproduce
  // their own printed hours ship no report (the typed lane's RC-3 rule). One
  // exception: their CCC sheet reading SHORT in both columns is rows the read
  // missed, which the ledger discloses as unread hours and for which the
  // report argues no item (GapLedger.unreadCarrierHours). Our sheet, and a
  // column over its print on either, still refuse: a misread hour is quoted.
  const unreadHours = [
    { estimate: shop, which: "our" },
    { estimate: carrier, which: "their" },
  ].flatMap(({ estimate, which }) => {
    const read = lineHoursRead(estimate);
    const hr = (n: number) => n.toFixed(1);
    const disclosed = estimate === carrier && unreadCarrierHours(carrier) > 0;
    return read.closes || disclosed
      ? []
      : [
          `${which} estimate's lines carry ${hr(read.labor.lines)} labor and ${hr(read.paint.lines)} paint hours as read, but it prints ${hr(read.labor.printed)} and ${hr(read.paint.printed)}`,
        ];
  });
  if (unreadHours.length) {
    return {
      ok: false,
      reason: `${unreadHours.join("; ")}, so any hour the report quoted could be a misread line rather than what the estimate says`,
    };
  }

  return {
    ok: true,
    input: {
      preparedDate: input.generatedAt.slice(0, 10),
      vehicle,
      roNumber,
      identity,
      shop: redact(shop),
      carrier: redact(carrier),
      pairs: pairsFromDeltas(input.rows.deltas, input.rows.equalPairs),
      caseDocuments: input.caseDocuments,
    },
  };
}
