// Reads the DV intake facts off an uploaded estimate's text layer, reusing the
// platform's existing extractors. Every field is read, never invented — an
// absent field stays undefined and the intake form asks the owner instead.

import { extractEstimateFacts } from "@/lib/ai/extractors/extractEstimateFacts";
import { parseEstimate } from "@/lib/ai/extractors/estimateExtractor";
import { buildFactsFromEstimate } from "@/lib/ai/extractors/buildFactsFromEstimate";
import { readClaimIdentity } from "@/lib/reports/claimIdentityGate";
import {
  buildVehicleLabel,
  decodeVinVehicleIdentity,
  mergeVehicleIdentity,
} from "@/lib/ai/vehicleContext";
import {
  extractMarketPreviewState,
  selectOwnerOrInsuredZip,
} from "@/lib/ai/marketPreviewOwnerZip";
import type { DvExtraction, DvSeveritySignals } from "./types";

/** CCC prints the owner as "LAST, FIRST" welded to the next label; keep the
 *  raw window up to the first label-looking token so the letter can show a
 *  presentable name the owner may still correct at intake. */
function extractOwnerDisplayName(text: string): string | undefined {
  const window = /\b(?:Owner|Insured|Claimant|Customer)\s*:?\s*([^\n]{0,60})/i.exec(text)?.[1];
  if (!window) return undefined;

  const cut = window.split(
    /(?:Policy|Claim|Type|Date|Loss|Phone|Address|Insurance|Company|Deductible|Inspection|Job|Estimate)\b/i
  )[0];
  const cleaned = cut
    .replace(/[^A-Za-z,'\-\s.]/g, " ")
    // CCC welds the next label straight onto the name ("Patrick LavinOwner"):
    // split the lower→upper seam, then drop a trailing label token.
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+(?:Owner|Insured|Claimant|Customer)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,\s]+$/, "");

  if (cleaned.length < 3 || !/[A-Za-z]{2}/.test(cleaned)) return undefined;
  return cleaned;
}

/** Loss date normalized to YYYY-MM-DD — the intake form's date input ignores
 *  any other format, so an extracted "7/19/2026" must not reach it raw. */
function extractLossDate(text: string): string | undefined {
  const match =
    /(?:date\s+of\s+loss|loss\s+date)\s*[:#]?\s*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/i.exec(text);
  if (!match) return undefined;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) {
    return undefined;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractPointOfImpact(text: string): string | undefined {
  const match = /point\s+of\s+impact\s*[:#]?\s*([^\n]{1,40})/i.exec(text);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function readSeveritySignals(text: string): DvSeveritySignals {
  const parsed = parseEstimate(text);
  const facts = buildFactsFromEstimate(parsed);

  return {
    structural: Boolean(
      facts.setupMeasure ||
        facts.unibodyAlignment ||
        facts.dimensionalVerification ||
        facts.clampZoneRepair
    ),
    // Operation rows ONLY (R&I/Repl/...): the equipment header lists
    // "Drivers Side Air Bag" on every CCC estimate, which is not a
    // deployment — hasLine's raw-line fallback would match it.
    airbag: parsed.lines.some((line) => /air\s?bag/i.test(line.raw)),
    adasCalibration: Boolean(
      facts.radarCalibration || facts.cameraCalibration || facts.surroundCalibration
    ),
    pointOfImpact: extractPointOfImpact(text),
  };
}

export function buildDvExtraction(params: {
  text: string;
  filename?: string;
}): DvExtraction {
  const text = params.text ?? "";
  const identity = readClaimIdentity(text);
  const facts = extractEstimateFacts({ text });

  const vin = identity.vin ?? facts.vehicle?.vin ?? undefined;
  const decoded = vin ? decodeVinVehicleIdentity(vin) : undefined;
  const vehicle = mergeVehicleIdentity(facts.vehicle, decoded);

  const ownerZip = selectOwnerOrInsuredZip(text);
  const state = extractMarketPreviewState(text, ownerZip);

  return {
    vehicle: {
      year: vehicle?.year,
      make: vehicle?.make,
      model: vehicle?.model,
      trim: vehicle?.trim,
      vin: vin ?? vehicle?.vin,
      label: buildVehicleLabel(vehicle, { includeTrim: true }) || undefined,
    },
    mileage: facts.mileage,
    ownerName: extractOwnerDisplayName(text),
    insurer: facts.insurer,
    claimNumber: identity.claimNumber ?? undefined,
    roNumber: identity.roNumber ?? undefined,
    repairTotal: facts.estimateTotal,
    lossDate: extractLossDate(text),
    ownerZip,
    state,
    severity: readSeveritySignals(text),
    attachmentFilename: params.filename,
  };
}
