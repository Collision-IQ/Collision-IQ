// Carrier total-loss valuation parser — normalizes a CCC ONE or Mitchell
// Market Valuation Report into one structure the ACV appraisal reconciles
// against. TypeScript port of the owner's carrier_valuation.py.
//
// IMPORTANT DIFFERENCE FROM THE REFERENCE MODULE: the Python regexes assume
// `pdftotext -layout` output (columns preserved by spacing). Collision iQ's
// pipeline yields pdf-parse text, where CCC glues labels to values
// ("Report Reference Number118699051", "Odometer2,371") and puts money on
// the FOLLOWING line ("Base Vehicle Value\n$ 80,246.00"). Every pattern here
// targets that reality and was verified against a real CCC report.
//
// Every field is optional: anything not found stays null and the report
// prints "not stated" rather than guessing.

export type CarrierComp = {
  n: number;
  source: string;
  dealer: string;
  location: string;
  distanceMi: number | null;
  odometer: number | null;
  vin: string;
  listPrice: number | null;
  /** The carrier's own adjusted comparable value. */
  adjustedValue: number | null;
  updated: string;
};

export type CarrierValuation = {
  vendor: "CCC" | "Mitchell" | "unknown";
  carrier: string;
  reportRef: string;
  claimRef: string;
  odometer: number | null;
  statewideValue: number | null;
  baseVehicleValue: number | null;
  blendedValuation: number | null;
  conditionAdjustment: number | null;
  priorDamageAdjustment: number | null;
  aftermarketAdjustment: number | null;
  refurbishmentAdjustment: number | null;
  titleHistoryAdjustment: number | null;
  dateOfLossAllowance: number | null;
  /** Pre-tax market value the settlement is built on. */
  adjustedVehicleValue: number | null;
  tax: number | null;
  taxRate: number | null;
  fees: number | null;
  deductible: number | null;
  total: number | null;
  comps: CarrierComp[];
};

export type CarrierBuckets = {
  comparableBase: number | null;
  statewideBlend: number | null;
  condition: number | null;
  otherAdjustments: number | null;
  preTaxValue: number | null;
  tax: number | null;
  fees: number | null;
  deductible: number | null;
  total: number | null;
};

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(value) ? value : null;
}

/**
 * "LABEL … [+/−] $ 1,234.56" where the amount may be glued to the label, sit
 * after a line break, or carry a sign. Up to 60 intervening characters of
 * wrapped label text are tolerated (CCC wraps "CCC Valuation (average of
 * statewide / and base vehicle values)").
 */
function findLabeledMoney(text: string, label: string): number | null {
  // The gap may span line breaks — CCC wraps long labels ("CCC Valuation
  // (average of statewide / and base vehicle values)") before the amount —
  // but never crosses another "$", so the first amount after the label wins.
  const pattern = new RegExp(
    `${label}[^$]{0,80}?([-+−])?\\s*\\$\\s*([\\d,]+(?:\\.\\d{2})?)`,
    "i"
  );
  const match = pattern.exec(text);
  if (!match) return null;
  const value = toNumber(match[2]);
  if (value === null) return null;
  return match[1] === "-" || match[1] === "−" ? -value : value;
}

function findLabeledText(text: string, label: string, maxLength = 60): string {
  const pattern = new RegExp(`${label}\\s*:?\\s*([^\\n]{1,${maxLength}})`, "i");
  return pattern.exec(text)?.[1]?.trim() ?? "";
}

/**
 * CCC prints each comparable as a "Source:" block carrying an odometer and a
 * VIN, then the list price, the literal "(List)", and the carrier's adjusted
 * value. Blocks are anchored on "Source:" rather than the "Comp N" heading
 * because CCC drops the heading when comps continue onto another page.
 */
function parseCccComps(text: string): CarrierComp[] {
  const comps: CarrierComp[] = [];
  const blocks = text.split(/(?=Source:\s)/g);
  for (const block of blocks) {
    if (!/^Source:/i.test(block.trim())) continue;
    if (!/Odometer:\s*[\d,]+/i.test(block) || !/VIN:\s*[A-HJ-NPR-Z0-9]{17}/i.test(block)) {
      continue;
    }
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const money = /\$\s*([\d,]+(?:\.\d{2})?)\s*\n?\s*\(List\)\s*\n?\s*\$\s*([\d,]+(?:\.\d{2})?)/i.exec(
      block
    );
    comps.push({
      n: comps.length + 1,
      source: findLabeledText(block, "Source", 40),
      dealer: lines[1] ?? "",
      location: /^[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}$/m.exec(block)?.[0]?.trim() ?? "",
      distanceMi: toNumber(/(\d+)\s+Miles From/i.exec(block)?.[1]),
      odometer: toNumber(/Odometer:\s*([\d,]+)/i.exec(block)?.[1]),
      vin: /VIN:\s*([A-HJ-NPR-Z0-9]{17})/i.exec(block)?.[1] ?? "",
      listPrice: money ? toNumber(money[1]) : null,
      adjustedValue: money ? toNumber(money[2]) : null,
      updated: /Updated Date:\s*([\d/]+)/i.exec(block)?.[1] ?? "",
    });
  }
  return comps;
}

function parseCcc(text: string): CarrierValuation {
  const taxMatch = /Vehicular Tax\s*\(([\d.]+)%\)\s*\+?\s*\$\s*([\d,]+(?:\.\d{2})?)/i.exec(text);
  return {
    vendor: "CCC",
    carrier: findLabeledText(text, "Prepared for", 70),
    reportRef: /Report Reference Number\s*([\w-]+)/i.exec(text)?.[1] ?? "",
    claimRef: /Claim Reference\s*([\w-]+)/i.exec(text)?.[1] ?? "",
    odometer: toNumber(/\bOdometer\s*:?\s*([\d,]+)/i.exec(text)?.[1]),
    statewideValue: findLabeledMoney(text, "Statewide Value"),
    baseVehicleValue: findLabeledMoney(text, "Base Vehicle Value"),
    blendedValuation: findLabeledMoney(text, "CCC Valuation"),
    conditionAdjustment: findLabeledMoney(text, "Condition Adjustment"),
    priorDamageAdjustment: findLabeledMoney(text, "Prior Damage"),
    aftermarketAdjustment: findLabeledMoney(text, "After Market"),
    refurbishmentAdjustment: findLabeledMoney(text, "Refurbishment"),
    titleHistoryAdjustment: findLabeledMoney(text, "Title History"),
    dateOfLossAllowance: findLabeledMoney(text, "DATE OF LOSS ALLOWANCE"),
    adjustedVehicleValue: findLabeledMoney(text, "Adjusted Vehicle Value"),
    tax: taxMatch ? toNumber(taxMatch[2]) : findLabeledMoney(text, "Vehicular Tax"),
    taxRate: taxMatch ? Number(taxMatch[1]) / 100 : null,
    fees: findLabeledMoney(text, "Title, Registration and Other Fees"),
    deductible: findLabeledMoney(text, "\\n\\s*Deductible"),
    total: findLabeledMoney(text, "\\n\\s*Total"),
    comps: parseCccComps(text),
  };
}

function parseMitchell(text: string): CarrierValuation {
  const condition = findLabeledMoney(text, "Condition");
  const deductible = findLabeledMoney(text, "Deductible");
  return {
    vendor: "Mitchell",
    carrier: findLabeledText(text, "Prepared For", 70),
    reportRef: /Valuation Report ID\s*:?\s*(\d+)/i.exec(text)?.[1] ?? "",
    claimRef: /Claim\s*(?:Number|#)\s*:?\s*([\w-]+)/i.exec(text)?.[1] ?? "",
    odometer: toNumber(/([\d,]+)\s*miles/i.exec(text)?.[1]),
    statewideValue: null,
    baseVehicleValue:
      findLabeledMoney(text, "Base Value") ?? findLabeledMoney(text, "Dual Source Base Value"),
    blendedValuation: null,
    // Mitchell prints condition deductions as "Condition - $123".
    conditionAdjustment:
      condition !== null && /Condition\s*[-−]\s*\$/i.test(text) ? -Math.abs(condition) : condition,
    priorDamageAdjustment: findLabeledMoney(text, "Prior Damage"),
    aftermarketAdjustment: findLabeledMoney(text, "Aftermarket Parts"),
    refurbishmentAdjustment: findLabeledMoney(text, "Refurbishment"),
    titleHistoryAdjustment: null,
    dateOfLossAllowance: null,
    adjustedVehicleValue: findLabeledMoney(text, "Market Value"),
    tax: findLabeledMoney(text, "Taxes"),
    taxRate: null,
    fees: findLabeledMoney(text, "Fees"),
    deductible: deductible !== null ? -Math.abs(deductible) : null,
    total: findLabeledMoney(text, "Settlement Value"),
    comps: parseCccComps(text),
  };
}

export function parseCarrierValuation(text: string): CarrierValuation {
  if (/CCC ONE|CCC Intelligent Solutions/i.test(text)) return parseCcc(text);
  if (/Mitchell International|Dual Source Base Value/i.test(text)) return parseMitchell(text);
  return {
    vendor: "unknown",
    carrier: "",
    reportRef: "",
    claimRef: "",
    odometer: null,
    statewideValue: null,
    baseVehicleValue: null,
    blendedValuation: null,
    conditionAdjustment: null,
    priorDamageAdjustment: null,
    aftermarketAdjustment: null,
    refurbishmentAdjustment: null,
    titleHistoryAdjustment: null,
    dateOfLossAllowance: null,
    adjustedVehicleValue: null,
    tax: null,
    taxRate: null,
    fees: null,
    deductible: null,
    total: null,
    comps: [],
  };
}

export function carrierCompListAverage(cv: CarrierValuation): number | null {
  const values = cv.comps.map((c) => c.listPrice).filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function carrierCompAdjustedAverage(cv: CarrierValuation): number | null {
  const values = cv.comps.map((c) => c.adjustedValue).filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export type ReadjustedCarrierComp = {
  n: number;
  dealer: string;
  list: number;
  odometer: number;
  miDiff: number;
  miAdj: number;
  readjusted: number;
  carrierAdjusted: number | null;
};

/**
 * Re-run the carrier's OWN comparables with a straight mileage adjustment and
 * no downward "condition to private owner" haircut. Usually the strongest
 * single argument in a total-loss letter: same comps, same market, one
 * conventional method.
 */
export function compsReadjustedAtRate(
  cv: CarrierValuation,
  subjectOdometer: number,
  rate = 0.07
): ReadjustedCarrierComp[] {
  const out: ReadjustedCarrierComp[] = [];
  for (const comp of cv.comps) {
    if (comp.listPrice === null || comp.odometer === null) continue;
    const miDiff = comp.odometer - subjectOdometer;
    const miAdj = Math.round(miDiff * rate * 100) / 100;
    out.push({
      n: comp.n,
      dealer: comp.dealer,
      list: comp.listPrice,
      odometer: comp.odometer,
      miDiff,
      miAdj,
      readjusted: Math.round((comp.listPrice + miAdj) * 100) / 100,
      carrierAdjusted: comp.adjustedValue,
    });
  }
  return out;
}

/** The rows of the page-1 carrier-vs-appraisal gap table. */
export function carrierBuckets(cv: CarrierValuation): CarrierBuckets {
  const others = [
    cv.priorDamageAdjustment,
    cv.aftermarketAdjustment,
    cv.refurbishmentAdjustment,
    cv.titleHistoryAdjustment,
    cv.dateOfLossAllowance,
  ].filter((v): v is number => v !== null);
  return {
    comparableBase: cv.baseVehicleValue,
    statewideBlend:
      cv.blendedValuation !== null && cv.baseVehicleValue !== null
        ? Math.round((cv.blendedValuation - cv.baseVehicleValue) * 100) / 100
        : null,
    condition: cv.conditionAdjustment,
    otherAdjustments: others.length ? others.reduce((a, b) => a + b, 0) : null,
    preTaxValue: cv.adjustedVehicleValue,
    tax: cv.tax,
    fees: cv.fees,
    deductible: cv.deductible,
    total: cv.total,
  };
}
