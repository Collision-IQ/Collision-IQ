/**
 * Classify every priced line on BOTH sides into the same non-labor buckets
 * before anything is compared.
 *
 * A CCC Supplement of Record can print sublet, tows, shop supplies and even a
 * labor-rate concession in the PARTS column with no Miscellaneous row. On RO
 * 21995 the old summary compared shop Parts against carrier Parts and shop
 * Misc against carrier Misc ($0.00), which produced a fake "-$9,115 parts"
 * bucket and a fake "$0.00 sublet on theirs": the carrier's $3,728.00 rate
 * concession and $3,768.63 of tows, dealer service and alignment were all
 * sitting in its Parts column.
 */
import { round2, type Estimate, type EstimateLine } from "./types";

export type NonLaborKind = "part" | "rateAdjustment" | "sublet" | "shopSupply";

const RATE_ADJ = /\b(concession|rate\s*(adj|differen)|labor\s*rate|agreed\s*price\s*for\s*rates)/i;
const SUBLET =
  /\b(tow|transport|sublet|forklift|align|alignment|service|refrigerant|power\s*up|hydraulic|move\s*vehicle|balance|tire\s*disposal)\b/i;
const TIRE = /\b(tires?|pirelli|michelin|goodyear|continental|bridgestone)\b/i;

export function classifyNonLabor(line: EstimateLine): NonLaborKind {
  const text = `${line.desc} ${line.note ?? ""}`;
  if (RATE_ADJ.test(text)) return "rateAdjustment";
  if (line.partNumber && line.partNumber.trim() !== "" && !/^(ITW|INV)$/i.test(line.partNumber)) return "part";
  if (line.oper === "Subl" || SUBLET.test(line.desc)) return "sublet";
  // Tires quoted from a vendor (no OEM part number) are still parts.
  if (TIRE.test(line.desc) && !/disposal|balance/i.test(line.desc)) return "part";
  if (/^Repl$/i.test(line.oper ?? "") && (line.price ?? 0) > 0 && !line.manual) return "part";
  return "shopSupply";
}

export interface NonLaborBuckets {
  part: number;
  rateAdjustment: number;
  sublet: number;
  shopSupply: number;
  total: number;
}

export class NonLaborParseError extends Error {}

/**
 * Sum each bucket from the line prices. `strict` (the production default)
 * requires the line prices to reproduce the printed Parts + Misc totals to
 * within $0.05: when they do not, the line read is incomplete and no
 * bucket-level number may be printed from it.
 */
export function nonLaborBuckets(estimate: Estimate, opts: { strict?: boolean } = {}): NonLaborBuckets {
  const strict = opts.strict ?? true;
  const buckets: NonLaborBuckets = { part: 0, rateAdjustment: 0, sublet: 0, shopSupply: 0, total: 0 };
  for (const line of estimate.lines) {
    if (!line.price) continue;
    buckets[classifyNonLabor(line)] += line.price;
  }
  buckets.part = round2(buckets.part);
  buckets.rateAdjustment = round2(buckets.rateAdjustment);
  buckets.sublet = round2(buckets.sublet);
  buckets.shopSupply = round2(buckets.shopSupply);
  buckets.total = round2(buckets.part + buckets.rateAdjustment + buckets.sublet + buckets.shopSupply);
  const printed = round2(estimate.totals.parts + estimate.totals.misc);
  if (strict && Math.abs(buckets.total - printed) > 0.05) {
    throw new NonLaborParseError(
      `${estimate.fileName}: line prices sum to ${buckets.total.toFixed(2)}, but the printed non-labor total is ${printed.toFixed(2)}`
    );
  }
  return buckets;
}
