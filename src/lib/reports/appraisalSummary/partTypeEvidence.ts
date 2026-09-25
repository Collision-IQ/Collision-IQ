/**
 * May the summary say anything about part type?
 *
 * The old summary printed "We wrote new factory parts. The insurer wrote used,
 * aftermarket or reconditioned" for ANY negative parts bucket. On RO 21995
 * the carrier's own ALTERNATE PARTS USAGE page shows 0/0/0/0 and every matched
 * part number carries the same price. A part-type claim may be printed only
 * when a document shows a non-OEM part.
 */
import type { Estimate } from "./types";

// "Opt OEM" / "Alt OEM" are factory parts from another channel, not non-OEM.
const NON_OEM_TOKEN = /\b(A\/M|Non[- ]?OEM|CAPA|NSF|LKQ|RCY|USED|Recond(itioned)?|Recored?|Reman(ufactured)?|Sect|Economy)\b/i;
const NON_OEM_SOURCE = new Set(["A/M", "LKQ", "RCY", "Recycled", "Used", "Recond", "Recore", "Reman", "CAPA", "NSF", "Sect", "Economy"]);

export interface PartTypeEvidence {
  carrierNonOemLines: number[];
  shopNonOemLines: number[];
  /** Aftermarket + reconditioned + recycled selections; null when the page was not printed or read. */
  altPartsUsageCount: number | null;
  /** May the summary say the carrier wrote cheaper part types? */
  claimAllowed: boolean;
  /** May the summary say both estimates use OEM parts? */
  bothAllOem: boolean;
}

export function partTypeEvidence(shop: Estimate, carrier: Estimate): PartTypeEvidence {
  const scan = (e: Estimate) =>
    e.lines
      .filter(
        (l) =>
          (l.partSource ?? []).some((source) => NON_OEM_SOURCE.has(source)) ||
          NON_OEM_TOKEN.test(`${l.desc} ${l.partNumber ?? ""}`)
      )
      .map((l) => l.line);
  const carrierNonOemLines = scan(carrier);
  const shopNonOemLines = scan(shop);
  const usage = carrier.altPartsUsage;
  const altPartsUsageCount = usage ? usage.aftermarket + usage.reconditioned + usage.recycled : null;
  const claimAllowed = carrierNonOemLines.length > 0 || (altPartsUsageCount ?? 0) > 0;
  // "Both OEM" needs positive evidence on the carrier side: the usage page
  // printed with zero, and no non-OEM token on either sheet.
  const bothAllOem = !claimAllowed && altPartsUsageCount === 0 && shopNonOemLines.length === 0;
  return { carrierNonOemLines, shopNonOemLines, altPartsUsageCount, claimAllowed, bothAllOem };
}
