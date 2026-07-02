import type { CollisionSnapshot } from "./collisionSnapshot";
import { sanitizeUserFacingEvidenceText } from "@/lib/ui/presentationText";

export type SnapshotDestinationType = "customer" | "carrier";

export type SnapshotSendSafeEvent = {
  event: "snapshot_send_attempt";
  destinationType: SnapshotDestinationType;
  hasPdf: boolean;
  adjustedConfidence: CollisionSnapshot["evidenceCompleteness"]["adjustedConfidence"];
  completenessStatus: CollisionSnapshot["evidenceCompleteness"]["completenessStatus"];
  topDisputeCount: number;
  uploadLimitReached: boolean;
  userIndicatedMoreFiles: boolean;
};

export function buildSnapshotPlainText(snapshot: CollisionSnapshot): string {
  return sanitizeSnapshotOutboundText([
    snapshot.title,
    snapshot.redactionNotice,
    "",
    `Repair verdict: ${snapshot.repairPlanVerdict.moreCompletePlan} more complete / carrier plan: ${snapshot.repairPlanVerdict.carrierPlanDescriptor}. ${snapshot.repairPlanVerdict.reason}`,
    `Estimate gap: ${
      snapshot.estimateComparison.available
        ? [
            snapshot.estimateComparison.difference ? `Difference ${snapshot.estimateComparison.difference}` : null,
            ...snapshot.estimateComparison.keyDeltas.slice(0, 3),
          ].filter(Boolean).join("; ")
        : snapshot.estimateComparison.unavailableReason
    }`,
    "Top disputes:",
    ...snapshot.topDisputeItems.map(
      (item, index) => `${index + 1}. ${item.issue} - ${item.evidenceState} ${item.nextAction}`
    ),
    `File coverage: ${snapshot.evidenceCompleteness.completenessStatus}. ${snapshot.evidenceCompleteness.userFacingDisclosure}`,
    "Next actions:",
    ...snapshot.nextActions.map((item, index) => `${index + 1}. ${item}`),
  ].join("\n"));
}

export function buildSnapshotEmailBody(
  snapshot: CollisionSnapshot,
  destinationType: SnapshotDestinationType
): string {
  const intro =
    destinationType === "customer"
      ? "Attached is a short collision snapshot for your vehicle. It summarizes the current repair-plan and estimate issues using the redacted file set."
      : "Attached is a short collision snapshot for review. It summarizes the repair-plan verdict, estimate comparison, and evidence completeness from the redacted file set.";

  return sanitizeSnapshotOutboundText([
    intro,
    "Sensitive details were removed for sharing.",
    "",
    ...snapshot.topDisputeItems.map((item) => `- ${item.issue}: ${item.nextAction}`),
    "",
    snapshot.evidenceCompleteness.userFacingDisclosure,
  ].join("\n"));
}

export function sanitizeSnapshotOutboundText(value: string): string {
  return sanitizeUserFacingEvidenceText(value
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, (vin) => `*****${vin.slice(-4)}`)
    .replace(/\bclaim\s*(?:(?:number|no\.?|#|id)\s*[:#-]?|[:#])\s*([A-Z0-9-]{5,})\b/gi, (_match, claim: string) => {
      const compact = claim.replace(/[^A-Za-z0-9]/g, "");
      return `claim #*****${compact.slice(-4)}`;
    })
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "")
    .replace(
      /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?/gi,
      ""
    )
    .replace(/\s{2,}/g, " ")
    .trim());
}

export function buildSnapshotSendSafeEvent(params: {
  snapshot: CollisionSnapshot;
  destinationType: SnapshotDestinationType;
  hasPdf: boolean;
}): SnapshotSendSafeEvent {
  return {
    event: "snapshot_send_attempt",
    destinationType: params.destinationType,
    hasPdf: params.hasPdf,
    adjustedConfidence: params.snapshot.evidenceCompleteness.adjustedConfidence,
    completenessStatus: params.snapshot.evidenceCompleteness.completenessStatus,
    topDisputeCount: params.snapshot.topDisputeItems.length,
    uploadLimitReached: params.snapshot.evidenceCompleteness.uploadLimitReached,
    userIndicatedMoreFiles: params.snapshot.evidenceCompleteness.userIndicatedMoreFiles,
  };
}

