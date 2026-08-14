// State-level motor-vehicle sales/use tax rates used to gross up the averaged
// comp value into a replacement-cost ACV (the house method adds tax where the
// owner's state charges it — see the QX60 and RO 22210 files, both 6% PA).
//
// These are STATE base rates only. Local add-ons vary by county/city, so the
// intake form shows this default and lets the owner correct it before anything
// generates. A missing state falls back to DEFAULT_TAX_RATE_PCT.

export const DEFAULT_TAX_RATE_PCT = 6;

const STATE_VEHICLE_SALES_TAX_PCT: Record<string, number> = {
  AL: 2, AK: 0, AZ: 5.6, AR: 6.5, CA: 7.25, CO: 2.9, CT: 6.35, DC: 6,
  DE: 0, FL: 6, GA: 7, HI: 4, IA: 5, ID: 6, IL: 6.25, IN: 7,
  KS: 6.5, KY: 6, LA: 4.45, MA: 6.25, MD: 6, ME: 5.5, MI: 6, MN: 6.875,
  MO: 4.225, MS: 5, MT: 0, NC: 3, ND: 5, NE: 5.5, NH: 0, NJ: 6.625,
  NM: 4, NV: 6.85, NY: 4, OH: 5.75, OK: 4.5, OR: 0, PA: 6, RI: 7,
  SC: 5, SD: 4, TN: 7, TX: 6.25, UT: 4.85, VA: 4.15, VT: 6, WA: 6.5,
  WI: 5, WV: 6, WY: 4,
};

export function defaultTaxRatePctForState(state: string | undefined): number {
  if (!state) return DEFAULT_TAX_RATE_PCT;
  const rate = STATE_VEHICLE_SALES_TAX_PCT[state.trim().toUpperCase()];
  return typeof rate === "number" ? rate : DEFAULT_TAX_RATE_PCT;
}
