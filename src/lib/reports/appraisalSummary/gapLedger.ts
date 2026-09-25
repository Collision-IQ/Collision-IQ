/**
 * One closed ledger for the Appraisal Dispute Report.
 *
 * RATES. The old summary said "the rate difference alone is worth $1,212.70"
 * from body, paint and materials only. It ignored the $80/hr mechanical gap,
 * and it never saw the carrier's rate-adjustment line, which on RO 21995 is
 * exactly (90−65)×36.0 + (175−95)×34.6 + (135−75)×1.0 = $3,728.00 and so
 * already pays the shop's rates on every carrier hour.
 *
 * Every hour on both sides is valued at the SHOP's category rate, so the labor
 * bucket is a pure hours gap. The rate gap the carrier's printed rates leave
 * open is (shop rate − carrier rate) × carrier hours, less any rate adjustment
 * the carrier wrote; when the adjustment reproduces that figure to the cent
 * the rates are settled and the open rate gap is zero. The adjustment line is
 * taken out of the carrier's non-labor figure, because it is labor money
 * printed in the Parts column.
 *
 * CLOSURE. Every number the summary prints comes from this ledger, and the
 * ledger must close to the printed grand-total difference within $0.01. The
 * buckets close by construction when both documents' categories sum to their
 * own subtotals; if they do not, LedgerNotClosedError is thrown and the report
 * is not produced (the same philosophy as the R24 release gate).
 */
import { nonLaborBuckets } from "./nonLaborBuckets";
import { round2, type Estimate, type LaborCat, type LaborTotal } from "./types";

type Family = "body" | "paint" | "mech" | "struct" | "other";

/** "Aluminum Or Steel Repair", "Frame", "Structural" compare against each other;
 *  carriers and shops label them differently. */
export const LABOR_FAMILY: Record<LaborCat, Family> = {
  body: "body",
  paint: "paint",
  mechanical: "mech",
  frame: "struct",
  structural: "struct",
  aluminum: "struct",
  other: "other",
};

function familyRate(totals: LaborTotal[], family: Family): number | undefined {
  return totals.find((total) => LABOR_FAMILY[total.cat] === family && total.hours > 0)?.rate;
}

/** The shop's rate for a labor category, falling back to the given rate when
 *  the shop prints no category in that family. */
export function shopRateFor(shop: Estimate, cat: LaborCat, fallback: number): number {
  return familyRate(shop.totals.labor, LABOR_FAMILY[cat]) ?? fallback;
}

export interface OpenRateItem {
  label: string;
  shopRate: number;
  carrierRate: number;
  hours: number;
  dollars: number;
}

export interface RateBasis {
  /** The carrier's adjustment reproduces the shop-rate differential to the cent. */
  settledByAdjustment: boolean;
  adjustmentAmount: number;
  /** Σ (shop rate − carrier rate) × carrier hours. */
  impliedAdjustment: number;
  /** Rate differences still open, including paint materials. */
  openRateItems: OpenRateItem[];
}

export interface LedgerOptions {
  /** Require line prices to reproduce the printed non-labor totals. On in production. */
  strictLines?: boolean;
}

export function resolveRateBasis(shop: Estimate, carrier: Estimate, opts: LedgerOptions = {}): RateBasis {
  const adjustment = nonLaborBuckets(carrier, { strict: opts.strictLines ?? true }).rateAdjustment;
  // Σ (shop rate − carrier rate) × carrier hours, taken against the carrier's
  // PRINTED category cost so a cent of print rounding cannot open the ledger.
  let implied = 0;
  for (const category of carrier.totals.labor) {
    implied += shopRateFor(shop, category.cat, category.rate) * category.hours - category.cost;
  }
  implied = round2(implied);
  const settled = adjustment > 0 && Math.abs(adjustment - implied) <= 0.01;

  const openRateItems: OpenRateItem[] = [];
  const ps = shop.totals.paintSupplies;
  const pc = carrier.totals.paintSupplies;
  if (ps.rate > 0 && pc.rate > 0 && ps.rate !== pc.rate) {
    openRateItems.push({
      label: "Paint materials",
      shopRate: ps.rate,
      carrierRate: pc.rate,
      hours: pc.hours,
      dollars: round2((ps.rate - pc.rate) * pc.hours),
    });
  }
  if (!settled) {
    for (const category of carrier.totals.labor) {
      const shopRate = familyRate(shop.totals.labor, LABOR_FAMILY[category.cat]);
      if (shopRate !== undefined && shopRate !== category.rate) {
        openRateItems.push({
          label: category.label,
          shopRate,
          carrierRate: category.rate,
          hours: category.hours,
          dollars: round2((shopRate - category.rate) * category.hours),
        });
      }
    }
  }
  return { settledByAdjustment: settled, adjustmentAmount: adjustment, impliedAdjustment: implied, openRateItems };
}

export interface GapLedger {
  shopTotal: number;
  carrierTotal: number;
  gap: number;
  /** Both sides' hours valued at the shop's category rates. */
  laborHours: { shop: number; carrier: number; diff: number; dollars: number };
  /** Rate gap left open after any carrier rate adjustment. 0 when settled. */
  laborRate: number;
  paintMaterials: number;
  /** Parts + sublet + supplies, with the carrier's rate adjustment removed. */
  nonLaborNet: number;
  tax: number;
  closes: true;
  rate: RateBasis;
}

export class LedgerNotClosedError extends Error {}

export function buildGapLedger(shop: Estimate, carrier: Estimate, opts: LedgerOptions = {}): GapLedger {
  const rate = resolveRateBasis(shop, carrier, opts);
  const hours = (e: Estimate) => round2(e.totals.labor.reduce((sum, l) => sum + l.hours, 0));
  const printedLabor = (e: Estimate) => e.totals.labor.reduce((sum, l) => sum + l.cost, 0);
  // The shop's own hours at its own rates ARE its printed labor; reading the
  // printed cost avoids re-multiplying and keeps the ledger cent-exact.
  const carrierAtShopRates = carrier.totals.labor.reduce(
    (sum, l) => sum + l.hours * shopRateFor(shop, l.cat, l.rate),
    0
  );

  const laborHoursDollars = round2(printedLabor(shop) - carrierAtShopRates);
  const laborRate = round2(rate.impliedAdjustment - rate.adjustmentAmount);
  const paintMaterials = round2(shop.totals.paintSupplies.cost - carrier.totals.paintSupplies.cost);
  const carrierNonLabor = carrier.totals.parts + carrier.totals.misc - rate.adjustmentAmount;
  const nonLaborNet = round2(shop.totals.parts + shop.totals.misc - carrierNonLabor);
  const tax = round2(shop.totals.tax - carrier.totals.tax);
  const gap = round2(shop.totals.grandTotal - carrier.totals.grandTotal);
  const sum = round2(laborHoursDollars + laborRate + paintMaterials + nonLaborNet + tax);
  if (Math.abs(sum - gap) > 0.01) {
    throw new LedgerNotClosedError(
      `the ledger sums to ${sum.toFixed(2)} but the printed grand totals differ by ${gap.toFixed(2)} (${shop.fileName} vs ${carrier.fileName})`
    );
  }
  return {
    shopTotal: shop.totals.grandTotal,
    carrierTotal: carrier.totals.grandTotal,
    gap,
    laborHours: {
      shop: hours(shop),
      carrier: hours(carrier),
      diff: round2(hours(shop) - hours(carrier)),
      dollars: laborHoursDollars,
    },
    laborRate,
    paintMaterials,
    nonLaborNet,
    tax,
    closes: true,
    rate,
  };
}
