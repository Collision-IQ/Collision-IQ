// Scan report parser — vendor-tolerant extraction of VIN/YMM, scan date,
// scanner vendor, modules, and DTCs from already-extracted text (PDF/TXT/CSV
// text comes from the app's existing upload extraction; no new file handling).

import { extractDtcs } from "@/lib/scans/dtcExtractor";
import type { ParsedScanReport, ScanSide } from "@/lib/scans/scanTypes";

const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/;
const YEAR_RE = /\b(19[8-9]\d|20[0-4]\d)\b/;

const VENDOR_PATTERNS: Array<[RegExp, string]> = [
  [/\bastech\b/i, "asTech"],
  [/\bairpro\b/i, "AirPro"],
  [/\bautel\b/i, "Autel"],
  [/\blaunch\b/i, "Launch"],
  [/\bsnap[\s-]?on\b/i, "Snap-on"],
  [/\bdrew\s?tech/i, "Drew Technologies"],
  [/\bautofix\b/i, "AutoFix"],
  [/\bbosch\b/i, "Bosch"],
  [/\bopus\s?ivs\b/i, "Opus IVS"],
  [/\btopdon\b/i, "TOPDON"],
  [/\bthinkcar\b/i, "THINKCAR"],
];

const DATE_RES = [
  /\b(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)\b/,
  /\b(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?)\b/i,
  /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i,
];

const MAKE_WORDS =
  /\b(Acura|Audi|BMW|Buick|Cadillac|Chevrolet|Chevy|Chrysler|Dodge|Ford|Freightliner|GMC|Genesis|Hino|Honda|Hyundai|Infiniti|Jaguar|Jeep|Kia|Land Rover|Lexus|Lincoln|Mazda|Mercedes[- ]?Benz|Mitsubishi|Nissan|Porsche|Ram|Rivian|Subaru|Tesla|Toyota|Volkswagen|VW|Volvo)\b/i;

function extractScanDate(text: string): string | null {
  const scoped = /(?:scan|report|created|performed|date)[^\n]{0,40}/gi;
  let match: RegExpExecArray | null;
  while ((match = scoped.exec(text)) !== null) {
    for (const re of DATE_RES) {
      const dateMatch = re.exec(match[0]);
      if (dateMatch) return dateMatch[1];
    }
  }
  for (const re of DATE_RES) {
    const dateMatch = re.exec(text);
    if (dateMatch) return dateMatch[1];
  }
  return null;
}

function extractVehicle(text: string): { vin: string | null; year: number | null; make: string | null; model: string | null } {
  const vin = VIN_RE.exec(text)?.[1] ?? null;
  const makeMatch = MAKE_WORDS.exec(text);
  const make = makeMatch ? makeMatch[1] : null;
  let year: number | null = null;
  let model: string | null = null;

  if (makeMatch) {
    // "2010 Honda Civic": the model year sits immediately before the make —
    // check that narrow slice first so scan dates ("03/11/2026") never win.
    const beforeMake = text.slice(Math.max(0, makeMatch.index - 8), makeMatch.index);
    const window = text.slice(Math.max(0, makeMatch.index - 30), makeMatch.index + 60);
    const adjacentYear = /(19[8-9]\d|20[0-4]\d)\s*$/.exec(beforeMake);
    const windowYear = adjacentYear ?? YEAR_RE.exec(window);
    year = windowYear ? Number(windowYear[1]) : null;
    const afterMake = window.slice(window.toLowerCase().indexOf(makeMatch[1].toLowerCase()) + makeMatch[1].length);
    const modelMatch = /^\s+([A-Za-z0-9][A-Za-z0-9 .\-]{1,25}?)(?:\s{2,}|\n|,|$)/.exec(afterMake);
    model = modelMatch ? modelMatch[1].trim() : null;
  } else {
    const yearMatch = YEAR_RE.exec(text);
    year = yearMatch ? Number(yearMatch[1]) : null;
  }

  return { vin, year, make, model };
}

/**
 * Parse one scan report's extracted text. Never throws — an unreadable file
 * comes back with `unreadable: true` and a warning, leaving files untouched.
 */
export function parseScanReport(params: {
  text: string | null | undefined;
  sourceFile: string;
  side: ScanSide;
}): ParsedScanReport {
  const text = (params.text ?? "").trim();
  const warnings: string[] = [];

  if (!text) {
    return {
      side: params.side,
      sourceFile: params.sourceFile,
      vin: null,
      year: null,
      make: null,
      model: null,
      scanDate: null,
      scannerVendor: null,
      modules: [],
      dtcs: [],
      warnings: ["No readable text could be extracted from this scan file."],
      unreadable: true,
    };
  }

  const vendor = VENDOR_PATTERNS.find(([re]) => re.test(text))?.[1] ?? null;
  const vehicle = extractVehicle(text);
  const { dtcs, modules } = extractDtcs({ text, sourceFile: params.sourceFile, side: params.side });

  if (dtcs.length === 0) {
    if (/\bno (?:dtcs?|codes?|trouble codes?)\b/i.test(text)) {
      warnings.push("Scan reports no DTCs present.");
    } else {
      warnings.push("No DTC codes were recognized in this file — verify it is a diagnostic scan report.");
    }
  }
  if (!vehicle.vin) warnings.push("No VIN found in scan text.");

  return {
    side: params.side,
    sourceFile: params.sourceFile,
    vin: vehicle.vin,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    scanDate: extractScanDate(text),
    scannerVendor: vendor,
    modules,
    dtcs,
    warnings,
    unreadable: false,
  };
}
