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
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,\s]+$/, "");

  if (cleaned.length < 3 || !/[A-Za-z]{2}/.test(cleaned)) return undefined;
  return cleaned;
}

function extractLossDate(text: string): string | undefined {
  const match =
    /(?:date\s+of\s+loss|loss\s+date)\s*[:#]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i.exec(text);
  return match?.[1];
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
    airbag: /\bair\s?bags?\b/i.test(text) && /deploy|replace|module/i.test(text),
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
