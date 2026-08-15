// Deterministic ACV + Diminished Value math — the house method:
//
//   pre-loss ACV  = average(comp asking adjusted at $0.07/mile) + sales tax
//   post-loss     = CarFax HBV when supplied, else 1-loss comp average,
//                   else a projected market-stigma percentage (flagged)
//   DV            = pre-loss − post-loss, plus the appraisal fee as an
//                   additional indirect loss
//
// Pure functions only. No network, no model calls, no Date.now() — the caller
// supplies every input, so any report can be regenerated bit-for-bit.

import type {
  DvCalculation,
  DvComp,
  DvCompAdjustment,
  DvCrossCheck17c,
  DvPostLossMethod,
  DvSeveritySignals,
} from "./types";

/** Insurer-accepted mileage adjustment used across the settled house files. */
export const PER_MILE_RATE = 0.07;

/** Half-up rounding to cents, matching the worksheets. */
export function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** A comp with more miles than the subject is worth LESS as-listed, so its
 *  price adjusts UP to reach the subject's condition — and vice versa. */
export function adjustCompForMileage(
  comp: DvComp,
  subjectMileage: number,
  perMileRate: number = PER_MILE_RATE
): DvCompAdjustment {
  if (typeof comp.mileage !== "number" || !Number.isFinite(comp.mileage)) {
    return { comp, adjustment: 0, adjustedValue: roundCents(comp.askingPrice) };
  }
  const mileageDifference = comp.mileage - subjectMileage;
  const adjustment = roundCents(mileageDifference * perMileRate);
  return {
    comp,
    mileageDifference,
    adjustment,
    adjustedValue: roundCents(comp.askingPrice + adjustment),
  };
}

/** Unrounded mean — tax and ACV are computed from full precision and rounded
 *  once each, matching the house worksheets (avg $38,159.58 → tax $2,289.58 →
 *  ACV $40,449.16 on RO 22210 only works when the mean is not pre-rounded). */
function averageAdjustedRaw(adjustments: DvCompAdjustment[]): number {
  if (!adjustments.length) return 0;
  const total = adjustments.reduce((sum, entry) => sum + entry.adjustedValue, 0);
  return total / adjustments.length;
}

export function averageAdjusted(adjustments: DvCompAdjustment[]): number {
  return roundCents(averageAdjustedRaw(adjustments));
}

/**
 * Projected market-stigma percentage when no CarFax HBV or 1-loss comp set is
 * available yet. Calibrated to the settled house files: QX60 4.7% of ACV,
 * BMW X5 5.6%, RO 22210 6% at a 28% severity ratio, Civic 18.4% (older,
 * severe). Deliberately conservative — the projection is replaced by the real
 * CarFax pull before the final packet goes out.
 */
export function projectStigmaPct(params: {
  severityRatioPct: number;
  severity: DvSeveritySignals;
}): number {
  const ratio = params.severityRatioPct;
  let pct: number;
  if (ratio < 10) pct = 3;
  else if (ratio < 20) pct = 4.5;
  else if (ratio < 35) pct = 6;
  else if (ratio < 50) pct = 8;
  else pct = 10;

  if (params.severity.structural) pct += 2;
  if (params.severity.airbag) pct += 1;

  return Math.min(pct, 12);
}

/** 17c damage multiplier from the estimate's own severity signals. The 17c
 *  frame is the INSURER'S formula — computed only as a reasonableness
 *  cross-check, never as the demand basis. */
export function classify17cDamage(params: {
  severityRatioPct: number;
  severity: DvSeveritySignals;
}): Pick<DvCrossCheck17c, "damageClass" | "damageMultiplier"> {
  if (params.severity.structural) {
    return params.severityRatioPct >= 50
      ? { damageClass: "severe_structural", damageMultiplier: 1.0 }
      : { damageClass: "major", damageMultiplier: 0.75 };
  }
  if (params.severityRatioPct >= 20) {
    return { damageClass: "moderate", damageMultiplier: 0.5 };
  }
  if (params.severityRatioPct >= 8) {
    return { damageClass: "minor", damageMultiplier: 0.25 };
  }
  return { damageClass: "none", damageMultiplier: 0.1 };
}

export function mileageMultiplier17c(subjectMileage: number): number {
  if (subjectMileage < 20000) return 1.0;
  if (subjectMileage < 40000) return 0.8;
  if (subjectMileage < 60000) return 0.6;
  if (subjectMileage < 80000) return 0.4;
  if (subjectMileage < 100000) return 0.2;
  return 0;
}

export type ComputeDvParams = {
  cleanComps: DvComp[];
  oneLossComps: DvComp[];
  subjectMileage: number;
  taxRatePct: number;
  repairTotal: number;
  severity: DvSeveritySignals;
  appraisalFee: number;
  carfaxPostLossValue?: number;
  perMileRate?: number;
};

export function computeDvCalculation(params: ComputeDvParams): DvCalculation {
  const perMileRate = params.perMileRate ?? PER_MILE_RATE;

  const adjustments = params.cleanComps.map((comp) =>
    adjustCompForMileage(comp, params.subjectMileage, perMileRate)
  );
  const averageRaw = averageAdjustedRaw(adjustments);
  const average = roundCents(averageRaw);
  const taxRaw = averageRaw * (params.taxRatePct / 100);
  const taxAmount = roundCents(taxRaw);
  const preLossAcv = roundCents(averageRaw + taxRaw);

  const severityRatioPct =
    preLossAcv > 0 ? roundCents((params.repairTotal / preLossAcv) * 100) : 0;

  let method: DvPostLossMethod;
  let postLossValue: number;
  let projected = false;
  let stigmaPct: number | undefined;
  let rationale: string;

  // HARD RULE (owner-directed, and basic vehicle-valuation science): a
  // loss-history vehicle can NEVER be worth as much as its clean twin. An
  // auto-derived 1-loss comp set whose average meets or exceeds the CLEAN
  // comp average (pre-tax, apples-to-apples) is bad data, not a real market
  // outcome, and is discarded in favor of the projected-stigma method. A
  // user-supplied CarFax value is real per-VIN data and is never overridden.
  const oneLossAdjustments =
    params.oneLossComps.length >= 3
      ? params.oneLossComps.map((comp) =>
          adjustCompForMileage(comp, params.subjectMileage, perMileRate)
        )
      : null;
  const oneLossAverage = oneLossAdjustments ? averageAdjusted(oneLossAdjustments) : null;
  const oneLossUsable =
    typeof oneLossAverage === "number" && oneLossAverage > 0 && oneLossAverage < average;

  if (typeof params.carfaxPostLossValue === "number" && params.carfaxPostLossValue > 0) {
    method = "carfax_hbv";
    postLossValue = roundCents(params.carfaxPostLossValue);
    rationale =
      "CarFax History-Based Value for this VIN after the loss record posted — the house-preferred post-loss input.";
  } else if (oneLossUsable && oneLossAverage !== null) {
    method = "one_loss_comps";
    postLossValue = oneLossAverage;
    rationale = `Average of ${params.oneLossComps.length} mileage-adjusted comparable vehicles with a confirmed single loss record.`;
  } else {
    method = "projected_stigma";
    projected = true;
    stigmaPct = projectStigmaPct({ severityRatioPct, severity: params.severity });
    postLossValue = roundCents(preLossAcv * (1 - stigmaPct / 100));
    const discardedNote =
      oneLossAverage !== null && !oneLossUsable
        ? ` The automated 1-loss comp set was discarded: its average (${oneLossAverage.toLocaleString(
            "en-US",
            { style: "currency", currency: "USD" }
          )}) met or exceeded the clean-comp average, and a loss-history vehicle can never be worth as much as its clean counterpart.`
        : "";
    rationale =
      `Projected ${stigmaPct}% market stigma pending the CarFax History-Based Value pull ` +
      `(severity ${severityRatioPct.toFixed(1)}% of pre-loss ACV; benchmarked against settled files at 4.7%–5.6% ` +
      `and CARFAX published damage-impact research). Replace with the CarFax value once the loss posts to the VIN.` +
      discardedNote;
  }

  const rawDv = roundCents(preLossAcv - postLossValue);
  const diminishedValue = Math.max(0, rawDv);
  const totalDemand = roundCents(diminishedValue + params.appraisalFee);

  const damage = classify17cDamage({ severityRatioPct, severity: params.severity });
  const mileageMult = mileageMultiplier17c(params.subjectMileage);
  const crossCheck17c: DvCrossCheck17c = {
    baseCapPct: 10,
    ...damage,
    mileageMultiplier: mileageMult,
    value: roundCents(preLossAcv * 0.1 * damage.damageMultiplier * mileageMult),
  };

  return {
    subjectMileage: params.subjectMileage,
    perMileRate,
    adjustments,
    averageAdjusted: average,
    taxRatePct: params.taxRatePct,
    taxAmount,
    preLossAcv,
    postLoss: { method, value: postLossValue, projected, stigmaPct, rationale },
    severityRatioPct,
    diminishedValue,
    appraisalFee: roundCents(params.appraisalFee),
    totalDemand,
    crossCheck17c,
  };
}
