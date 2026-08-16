// Reads the DV intake facts off an uploaded estimate's text layer, reusing the
// platform's existing extractors. Every field is read, never invented — an
// absent field stays undefined and the intake form asks the owner instead.

import { extractEstimateFacts } from "@/lib/ai/extractors/extractEstimateFacts";
import { parseEstimate } from "@/lib/ai/extractors/estimateExtractor";
import { parseCccEstimateRows } from "@/lib/reports/estimateDeltaMatcher";
import { buildFactsFromEstimate } from "@/lib/ai/extractors/buildFactsFromEstimate";
import { readClaimIdentity } from "@/lib/reports/claimIdentityGate";
import {
  buildVehicleLabel,
  decodeVinVehicleIdentity,
  mergeVehicleIdentity,
} from "@/lib/ai/vehicleContext";
import { extractMarketPreviewState } from "@/lib/ai/marketPreviewOwnerZip";
import { resolveStateFromZip } from "@/lib/policyLegal/stateFromZip";
import type { DvExtraction, DvSeveritySignals } from "./types";

/**
 * The comp search radius must center on the VEHICLE OWNER's ZIP (owner
 * directive). The context-window scorer can be misled by third-party
 * letterheads that happen to sit near an "Owner:" header in glued CCC text
 * (RO 22194: an appraisal company's Phoenix ZIP outscored the owner's Berwyn
 * one). So the owner's own address block wins outright: the first
 * "City, ST 12345" following an Owner/Insured label. The comma+state prefix
 * keeps street numbers and bare identifiers out.
 */
function zipAfterLabels(text: string, labels: RegExp): string | undefined {
  for (const label of text.matchAll(labels)) {
    const window = text.slice(label.index ?? 0, (label.index ?? 0) + 400);
    for (const zipMatch of window.matchAll(/,\s*([A-Z]{2})\s*(\d{5})(?!\d)/g)) {
      const zip = zipMatch[2];
      if (resolveStateFromZip(zip)) return zip;
    }
  }
  return undefined;
}

/** Owner-directed cascade: owner block → inspection location / repair
 *  facility block → BLANK (the owner fills it in at intake). Never a
 *  best-guess from arbitrary document context. */
function extractOwnerBlockZip(text: string): string | undefined {
  return (
    zipAfterLabels(text, /\b(?:Owner|Insured)\s*:/gi) ??
    zipAfterLabels(text, /\b(?:Inspection\s+Location|Repair\s+Facility)\s*:/gi)
  );
}

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

/** Outer sheet-metal panels for the Repair-Cost method's repaired-panel
 *  adder. Bumpers/covers are plastic and deliberately excluded. */
const OUTER_PANEL_PATTERN =
  /\b(door(?:\s+(?:shell|outer|skin))?|fender|quarter(?:\s+panel)?|qtr(?:\s+(?:panel|outer))?|hood|deck\s?lid|trunk\s?lid|liftgate|tailgate|bedside|roof(?:\s+panel)?|rocker(?:\s+panel)?|cab\s+corner|uniside|aperture\s+panel)\b/i;

function readSeveritySignals(text: string): DvSeveritySignals {
  const parsed = parseEstimate(text);
  const facts = buildFactsFromEstimate(parsed);
  // The delta matcher's CCC parser handles glued supplement rows
  // ("9S01R&I Aperture panel…") that the lightweight parseEstimate misses —
  // panel counting and labor totals come from it.
  const cccRows = parseCccEstimateRows(text);

  // Repair-Cost method character: outer panels REPAIRED (not replaced), with
  // the line references the demand narrative cites.
  const repairedPanelRows = cccRows.filter(
    (row) =>
      /^rpr$/i.test(row.opCode ?? "") && OUTER_PANEL_PATTERN.test(row.description ?? "")
  );
  const repairedPanelRefs = repairedPanelRows
    .map((row) => (row.lineNumber != null ? `Line ${row.lineNumber}` : null))
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");

  const structural = Boolean(
    facts.setupMeasure ||
      facts.unibodyAlignment ||
      facts.dimensionalVerification ||
      facts.clampZoneRepair
  );
  const structuralRow = cccRows.find((row) =>
    /-S\b|setup.*measure|unibody|frame\b|pillar/i.test(row.rawText ?? row.description ?? "")
  );

  const laborHours = cccRows.reduce(
    (sum, row) => sum + (row.labor ?? 0) + (row.paint ?? 0),
    0
  );

  return {
    structural,
    // Operation rows ONLY: the equipment header lists "Drivers Side Air Bag"
    // on every CCC estimate, which is not a deployment.
    airbag: cccRows.some(
      (row) => /air\s?bag/i.test(row.description ?? "") && Boolean(row.opCode)
    ),
    adasCalibration: Boolean(
      facts.radarCalibration || facts.cameraCalibration || facts.surroundCalibration
    ),
    pointOfImpact: extractPointOfImpact(text),
    repairedOuterPanels: repairedPanelRows.length,
    repairedPanelRefs: repairedPanelRefs || undefined,
    aftermarketParts: /\baftermarket\b|(?:^|[^\w/])A\/M(?:[^\w/]|$)/im.test(text),
    totalLaborHours: laborHours > 0 ? Math.round(laborHours * 10) / 10 : undefined,
    structuralLineRef:
      structural && structuralRow
        ? `${structuralRow.lineNumber != null ? `Line ${structuralRow.lineNumber}: ` : ""}${(structuralRow.description ?? "").slice(0, 70)}`
        : undefined,
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

  // Owner block first; labeled facility blocks second; otherwise BLANK so the
  // owner supplies it — a wrong ZIP sends the whole comp search to the wrong
  // market (RO 22194: an AZ letterhead ZIP on a PA car).
  const ownerZip = extractOwnerBlockZip(text);
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
