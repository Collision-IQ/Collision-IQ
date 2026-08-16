// Shared shapes for the paid self-service ACV + Diminished Value generator.
//
// A DvValuationRequest row carries three JSON payloads across its lifecycle:
//   extraction — read off the uploaded estimate at intake (never invented)
//   intake     — the owner-confirmed answers (loss date, posture, ZIP, tax)
//   result     — comps + deterministic calculation + open items
// Every number in `result.calculation` must be reproducible from its inputs;
// nothing in the calculation layer may call the network or a model.

export type DvRequestStatus = "draft" | "paid" | "processing" | "ready" | "failed";

export const DV_REQUEST_STATUSES: readonly DvRequestStatus[] = [
  "draft",
  "paid",
  "processing",
  "ready",
  "failed",
];

export function isDvRequestStatus(value: unknown): value is DvRequestStatus {
  return (
    typeof value === "string" &&
    (DV_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

export type DvVehicle = {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
  label?: string;
};

export type DvSeveritySignals = {
  structural: boolean;
  airbag: boolean;
  adasCalibration: boolean;
  pointOfImpact?: string;
  /** Repair-Cost DV method inputs (Collision Academy Repair-Cost Schedule):
   *  outer panels REPAIRED (not replaced), aftermarket parts, labor hours,
   *  and line references for the narrative. Absent on older extractions. */
  repairedOuterPanels?: number;
  repairedPanelRefs?: string;
  aftermarketParts?: boolean;
  totalLaborHours?: number;
  structuralLineRef?: string;
};

/** Facts read off the uploaded estimate. Absent fields stay absent — the
 *  intake step asks the owner rather than guessing. */
export type DvExtraction = {
  vehicle: DvVehicle;
  mileage?: number;
  ownerName?: string;
  insurer?: string;
  claimNumber?: string;
  roNumber?: string;
  repairTotal?: number;
  lossDate?: string;
  ownerZip?: string;
  state?: string;
  severity: DvSeveritySignals;
  attachmentFilename?: string;
};

export type DvClaimPosture = "third_party" | "first_party" | "unsure";

/** Owner-confirmed intake. Extracted values are prefilled and editable;
 *  nothing generates until the owner has confirmed them. */
export type DvIntake = {
  lossDate: string;
  claimPosture: DvClaimPosture;
  zip: string;
  state?: string;
  taxRatePct: number;
  appraisalFee: number;
  ownerName?: string;
  insurer?: string;
  claimNumber?: string;
  mileage?: number;
  repairTotal?: number;
  /** CarFax History-Based Value for the VIN, when the owner already has it.
   *  Replaces the projected post-loss value with the house-preferred input. */
  carfaxPostLossValue?: number;
};

export type DvCompTier = "clean" | "one_loss";

export type DvTrimMatch = "exact" | "adjacent" | "model";

export type DvComp = {
  tier: DvCompTier;
  /** "detail" = a single-vehicle listing page; "index" = a live inventory or
   *  search page whose parsed price still needs its specific ad snapshotted. */
  listingQuality?: "detail" | "index";
  /** Clean tier only: the listing text itself attests a clean history
   *  ("no accidents", "clean CARFAX"). Verified-clean comps rank first. */
  cleanVerified?: boolean;
  title: string;
  dealer?: string;
  phone?: string;
  vin?: string;
  stock?: string;
  askingPrice: number;
  mileage?: number;
  location?: string;
  url?: string;
  source: string;
  trimMatch: DvTrimMatch;
  dateAccessed: string;
  /** For one-loss comps: the listing text that confirmed the loss record. */
  lossEvidence?: string;
};

export type DvCompAdjustment = {
  comp: DvComp;
  mileageDifference?: number;
  adjustment: number;
  adjustedValue: number;
};

/** One entry per search performed during the 1-loss sweep. When the sweep
 *  comes back dry this is the scarcity evidence the report cites. */
export type DvSweepRecord = {
  query: string;
  scope: "radius" | "nationwide";
  source: string;
  resultCount: number;
  note?: string;
};

export type DvCompResearch = {
  status: "completed" | "insufficient_clean_comps" | "provider_not_configured" | "failed";
  /** 2 = confirmed 1-loss comps priced the post-loss market; 3 = projected
   *  stigma with the dry sweep documented as scarcity evidence. */
  tier: 2 | 3 | null;
  clean: DvComp[];
  oneLoss: DvComp[];
  sweep: DvSweepRecord[];
  notes: string[];
  failureReason?: string;
};

export type DvPostLossMethod =
  | "carfax_hbv"
  | "one_loss_comps"
  | "projected_stigma"
  | "repair_cost_derived";

/** Repair-Cost DV method figures (Collision Academy Repair-Cost Schedule). */
export type DvRepairCostMethod = {
  dsr: number;
  baseFactor: number;
  adders: Record<string, number>;
  appliedFactor: number;
  repairCostDv: number;
  scheduleLabel: string;
};

export type DvCrossCheck17c = {
  baseCapPct: number;
  damageClass: "none" | "minor" | "moderate" | "major" | "severe_structural";
  damageMultiplier: number;
  mileageMultiplier: number;
  value: number;
};

export type DvCalculation = {
  subjectMileage: number;
  perMileRate: number;
  adjustments: DvCompAdjustment[];
  averageAdjusted: number;
  taxRatePct: number;
  taxAmount: number;
  preLossAcv: number;
  postLoss: {
    method: DvPostLossMethod;
    value: number;
    projected: boolean;
    stigmaPct?: number;
    rationale: string;
  };
  severityRatioPct: number;
  /** Second method: repair-cost DV per the schedule. Always computed. */
  repairCost: DvRepairCostMethod;
  /** Market method DV (pre-loss − market post-loss); null when no CarFax or
   *  usable 1-loss set exists and the repair-cost method controls alone. */
  marketDv: number | null;
  reconciliationUsed: string;
  /** The reconciled figure — this IS the demanded diminished value. */
  diminishedValue: number;
  appraisalFee: number;
  totalDemand: number;
  crossCheck17c: DvCrossCheck17c;
};

export type DvResult = {
  compResearch: DvCompResearch;
  calculation: DvCalculation;
  openItems: string[];
  generatedAt: string;
};

/** Everything the two house PDFs need, denormalized so the client renderers
 *  never re-derive a number. */
export type DvReportData = {
  extraction: DvExtraction;
  intake: DvIntake;
  result: DvResult;
};
