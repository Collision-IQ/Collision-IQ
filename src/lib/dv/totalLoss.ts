// Total-loss (value dispute) mode — TypeScript port of the owner's
// acv_report.py total-loss path.
//
// One comp engine, two modes:
//   diminished_value : ACV including sales tax feeds the DV report
//   total_loss       : the ACV IS the product, and
//                      demand = pre-tax ACV + appraisal fee
//                      (sales tax, title and registration are added by the
//                      carrier on its settlement worksheet — matching house
//                      practice and appraisal-clause awards, which exclude
//                      tax, title and fees)

import { adjustCompForMileage, averageAdjusted, PER_MILE_RATE, roundCents } from "./acvMath";
import {
  carrierBuckets,
  carrierCompAdjustedAverage,
  carrierCompListAverage,
  compsReadjustedAtRate,
  type CarrierValuation,
  type ReadjustedCarrierComp,
} from "./carrierValuation";
import type { DvComp, DvCompAdjustment } from "./types";

export type TotalLossInputs = {
  subjectOdometer: number;
  comps: DvComp[];
  perMileRate?: number;
  taxRatePct: number;
  /** J.D. Power / NADA clean retail, when the file blends it in. */
  nadaValue?: number;
  blendNada?: boolean;
  conditionAdjustment?: number;
  conditionNote?: string;
  priorDamageAdjustment?: number;
  otherAdjustment?: number;
  appraisalFee: number;
};

export type TotalLossAcv = {
  adjustments: DvCompAdjustment[];
  compListAverage: number;
  compAdjustedAverage: number;
  mileageAdjustmentAverage: number;
  nadaBlendAverage: number | null;
  conditionAdjustment: number;
  otherAdjustments: number;
  preTaxAcv: number;
  taxRatePct: number;
  tax: number;
  acvWithTax: number;
  appraisalFee: number;
  demand: number;
  demandBasis: string;
};

export type GapRow = {
  label: string;
  note: string;
  carrier: number | null;
  ours: number | null;
  difference: number | null;
  total?: boolean;
};

export type TotalLossGap = {
  rows: GapRow[];
  shortfall: number | null;
  shortfallPct: number | null;
  carrierReadjusted: ReadjustedCarrierComp[];
  carrierReadjustedAverage: number | null;
  carrierListAverage: number | null;
  carrierAdjustedAverage: number | null;
  carrierTax: number | null;
  carrierFees: number | null;
  carrierTotal: number | null;
  vendor: string;
};

export function computeTotalLossAcv(inputs: TotalLossInputs): TotalLossAcv {
  const perMileRate = inputs.perMileRate ?? PER_MILE_RATE;
  const adjustments = inputs.comps.map((comp) =>
    adjustCompForMileage(comp, inputs.subjectOdometer, perMileRate)
  );

  const listAverage = adjustments.length
    ? roundCents(
        adjustments.reduce((sum, entry) => sum + entry.comp.askingPrice, 0) / adjustments.length
      )
    : 0;
  const adjustedAverage = averageAdjusted(adjustments);
  const mileageAdjustmentAverage = roundCents(adjustedAverage - listAverage);

  let base = adjustedAverage;
  let nadaBlendAverage: number | null = null;
  if (inputs.nadaValue && inputs.blendNada) {
    nadaBlendAverage = roundCents((adjustedAverage + inputs.nadaValue) / 2);
    base = nadaBlendAverage;
  }

  const conditionAdjustment = inputs.conditionAdjustment ?? 0;
  const otherAdjustments = (inputs.priorDamageAdjustment ?? 0) + (inputs.otherAdjustment ?? 0);
  const preTaxAcv = roundCents(base + conditionAdjustment + otherAdjustments);
  const tax = roundCents(preTaxAcv * (inputs.taxRatePct / 100));

  return {
    adjustments,
    compListAverage: listAverage,
    compAdjustedAverage: adjustedAverage,
    mileageAdjustmentAverage,
    nadaBlendAverage,
    conditionAdjustment,
    otherAdjustments,
    preTaxAcv,
    taxRatePct: inputs.taxRatePct,
    tax,
    acvWithTax: roundCents(preTaxAcv + tax),
    appraisalFee: roundCents(inputs.appraisalFee),
    demand: roundCents(preTaxAcv + inputs.appraisalFee),
    demandBasis:
      "pre-tax ACV + appraisal fee; sales tax, title and registration to be added by the carrier per its settlement worksheet",
  };
}

export function buildTotalLossGap(params: {
  acv: TotalLossAcv;
  carrier: CarrierValuation;
  subjectOdometer: number;
  perMileRate?: number;
  conditionNote?: string;
}): TotalLossGap {
  const { acv, carrier } = params;
  const perMileRate = params.perMileRate ?? PER_MILE_RATE;
  const buckets = carrierBuckets(carrier);
  const carrierList = carrierCompListAverage(carrier);
  const carrierAdjusted = carrierCompAdjustedAverage(carrier);
  const carrierNetCompAdjustment =
    carrierList !== null && carrierAdjusted !== null
      ? roundCents(carrierAdjusted - carrierList)
      : null;
  const readjusted = compsReadjustedAtRate(carrier, params.subjectOdometer, perMileRate);
  const readjustedAverage = readjusted.length
    ? roundCents(readjusted.reduce((sum, entry) => sum + entry.readjusted, 0) / readjusted.length)
    : null;

  const rows: GapRow[] = [
    {
      label: "Comparable listings — average asking",
      note: `carrier ${carrier.comps.length} comps · ours ${acv.adjustments.length} comps`,
      carrier: carrierList !== null ? roundCents(carrierList) : null,
      ours: acv.compListAverage,
      difference: null,
    },
    {
      label: `Mileage / comp adjustments to subject (${params.subjectOdometer.toLocaleString("en-US")} mi)`,
      note: `carrier nets its comps DOWN via an unitemized condition step; ours at $${perMileRate.toFixed(2)}/mi`,
      carrier: carrierNetCompAdjustment,
      ours: acv.mileageAdjustmentAverage,
      difference: null,
    },
    {
      label: "Statewide-value blend",
      note: "CCC averages a statewide index into the comp base",
      carrier: buckets.statewideBlend,
      ours: null,
      difference: null,
    },
    {
      label: "Condition adjustment",
      note: params.conditionNote ?? "",
      carrier: buckets.condition,
      ours: acv.conditionAdjustment,
      difference: null,
    },
    {
      label: "Other allowances (date-of-loss, prior damage, aftermarket)",
      note: "",
      carrier: buckets.otherAdjustments,
      ours: acv.otherAdjustments,
      difference: null,
    },
    {
      label: "Pre-tax value",
      note: "",
      carrier: buckets.preTaxValue,
      ours: acv.preTaxAcv,
      difference: null,
      total: true,
    },
  ];
  for (const row of rows) {
    row.difference =
      row.ours !== null && row.carrier !== null ? roundCents(row.ours - row.carrier) : null;
  }

  const shortfall =
    buckets.preTaxValue !== null ? roundCents(acv.preTaxAcv - buckets.preTaxValue) : null;

  return {
    rows,
    shortfall,
    shortfallPct:
      shortfall !== null && buckets.preTaxValue ? shortfall / buckets.preTaxValue : null,
    carrierReadjusted: readjusted,
    carrierReadjustedAverage: readjustedAverage,
    carrierListAverage: carrierList !== null ? roundCents(carrierList) : null,
    carrierAdjustedAverage: carrierAdjusted !== null ? roundCents(carrierAdjusted) : null,
    carrierTax: buckets.tax,
    carrierFees: buckets.fees,
    carrierTotal: buckets.total,
    vendor: carrier.vendor,
  };
}

function usd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * The value-dispute letter body, in the vehicle owner's first-person voice
 * (the standing depersonalization rule: generated documents never carry an
 * individual appraiser's name, license or contact details).
 */
export function renderTotalLossLetterParagraphs(params: {
  acv: TotalLossAcv;
  carrier: CarrierValuation;
  gap: TotalLossGap;
  vehicleLabel: string;
  lossDate: string;
  carrierName: string;
  perMileRate?: number;
  conditionNote?: string;
}): string[] {
  const { acv, carrier, gap } = params;
  const rate = params.perMileRate ?? PER_MILE_RATE;
  const vendor = carrier.vendor === "unknown" ? "the carrier's" : carrier.vendor;
  const paragraphs: string[] = [];

  paragraphs.push(
    `My ${params.vehicleLabel} was declared a total loss following the ${params.lossDate} collision. ` +
      `${params.carrierName} has tendered a settlement built on a ${vendor} Market Valuation Report that places ` +
      `the vehicle's pre-tax value at ${usd(carrier.adjustedVehicleValue ?? 0)}. That figure is rejected. The ` +
      `enclosed independent appraisal places it at ${usd(acv.preTaxAcv)}` +
      (gap.shortfall !== null && gap.shortfallPct !== null
        ? ` — ${usd(gap.shortfall)} more, ${(gap.shortfallPct * 100).toFixed(1)}% above the offer`
        : "") +
      ` — and this letter shows, line by line, where the difference comes from.`
  );

  if (gap.carrierReadjustedAverage !== null && gap.carrierListAverage !== null) {
    const haircut =
      gap.carrierAdjustedAverage !== null
        ? roundCents(gap.carrierReadjustedAverage - gap.carrierAdjustedAverage)
        : null;
    paragraphs.push(
      `Start with the ${vendor} report's own comparables. It lists ${carrier.comps.length} vehicles at asking ` +
        `prices averaging ${usd(gap.carrierListAverage)}. Under any conventional method, a comparable with more ` +
        `miles than the loss vehicle is adjusted upward to the subject; at the $${rate.toFixed(2)}-per-mile rate the ` +
        `industry itself uses, those same ${carrier.comps.length} vehicles average ${usd(gap.carrierReadjustedAverage)}. ` +
        (gap.carrierAdjustedAverage !== null
          ? `${vendor} instead adjusted them to an average of ${usd(gap.carrierAdjustedAverage)} through an ` +
            `unitemized condition step applied to the comparables rather than to the loss vehicle` +
            (haircut !== null && haircut > 0
              ? `. That single step removes ${usd(haircut)} of value before the appraisal reaches the loss vehicle at all.`
              : ".")
          : "")
    );
  }

  const compounding: string[] = [];
  const buckets = carrierBuckets(carrier);
  if (buckets.statewideBlend !== null && buckets.statewideBlend !== 0) {
    compounding.push(
      `the base value is averaged with a statewide index of ${usd(carrier.statewideValue ?? 0)} that is not a ` +
        `comparable vehicle at all (${usd(buckets.statewideBlend)})`
    );
  }
  if (buckets.condition !== null && buckets.condition < 0) {
    compounding.push(
      `a condition adjustment of ${usd(buckets.condition)} is taken on inspection notes that describe ordinary ` +
        `wear for the vehicle's age`
    );
  }
  if (compounding.length > 0) {
    paragraphs.push(
      `${compounding.length > 1 ? "Two further steps compound" : "A further step compounds"} the problem: ` +
        compounding.join("; and ") +
        "."
    );
  }

  if (buckets.otherAdjustments !== null && buckets.otherAdjustments > 0) {
    paragraphs.push(
      `For clarity, the report's positive allowances (${usd(buckets.otherAdjustments)}, chiefly the date-of-loss ` +
        `allowance) are not disputed; the appraised figure below is drawn from current listings and already ` +
        `reflects the market as of the report date, so no separate allowance is added to it.`
    );
  }

  paragraphs.push(
    `The enclosed appraisal uses ${acv.adjustments.length} retail listings of the same year, model and trim, each ` +
      `with a verified VIN and odometer, each saved on the date it was pulled, mileage-adjusted at $${rate.toFixed(2)} ` +
      `per mile and averaged: ${usd(acv.preTaxAcv)} before tax. No condition premium is claimed. This is a ` +
      `conservative number built from the same market and the same method, applied consistently.`
  );

  paragraphs.push(
    `I ask for the appraised pre-tax value of ${usd(acv.preTaxAcv)} plus the ${usd(acv.appraisalFee)} appraisal fee ` +
      `incurred solely because the first offer required it — ${usd(acv.demand)} — with sales tax, title and ` +
      `registration added per your settlement worksheet exactly as they were on the original offer. Please remit, or ` +
      `respond to each of the points above with the specific figure you contend is wrong, within 15 days of receipt. ` +
      `Absent agreement, I will invoke the appraisal clause and this report will serve as my appraiser's submission.`
  );

  return paragraphs;
}
