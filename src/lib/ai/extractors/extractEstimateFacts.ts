import { hasLine, parseEstimate } from "./estimateExtractor";
import {
  extractVehicleIdentityFromText,
  mergeVehicleIdentity,
  normalizeVehicleIdentity,
} from "../vehicleContext";
import type { EstimateFacts, VehicleIdentity } from "../types/analysis";

const COMMON_INSURERS = [
  "GEICO",
  "Progressive",
  "State Farm",
  "Allstate",
  "Liberty Mutual",
  "USAA",
  "Nationwide",
  "Travelers",
  "Farmers",
  "Erie",
  "AAA",
];

const LIKELY_PERSON_NAME_PATTERN = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/;

type HighlightRule = {
  label: string;
  patterns: RegExp[];
};

const DOCUMENTED_HIGHLIGHT_RULES: HighlightRule[] = [
  {
    label: "Procedure research/documentation",
    patterns: [/procedures? research/i, /oem procedures?/i, /repair research/i],
  },
  {
    label: "Work authorization",
    patterns: [/work authorization/i, /repair authorization/i],
  },
  {
    label: "Test fits",
    patterns: [/test fit/i, /fit check/i, /mock-?up/i],
  },
  {
    label: "Refrigerant service",
    patterns: [/refrigerant/i, /recover and recharge/i, /evac(?:uate)? and recharge/i],
  },
  {
    label: "Headlamp/fog aim",
    patterns: [/headlamp aim/i, /headlight aim/i, /fog aim/i, /lamp aim/i],
  },
  {
    label: "Cavity wax",
    patterns: [/cavity wax/i],
  },
  {
    label: "Final road test",
    patterns: [/final road test/i, /road test/i],
  },
  {
    label: "HV battery state-of-charge maintenance",
    patterns: [/state of charge/i, /high voltage battery/i, /\bhv battery\b/i],
  },
];

export function extractEstimateFacts(params: {
  text: string;
  vehicle?: VehicleIdentity | null;
}): EstimateFacts {
  const text = params.text.replace(/\r/g, "\n");
  const parsed = parseEstimate(text);
  const inferredVehicle = extractVehicleIdentityFromText(text, "attachment");
  const vehicle = mergeVehicleIdentity(
    normalizeVehicleIdentity(params.vehicle),
    normalizeVehicleIdentity(inferredVehicle)
  );

  const documentedProcedures = collectDocumentedProcedures(text, parsed);
  const documentedHighlights = collectDocumentedHighlights(text);

  return {
    vehicle,
    mileage: extractMileage(text),
    insurer: extractInsurer(text),
    estimateTotal: extractEstimateTotal(text, parsed.totalCost),
    documentedProcedures,
    documentedHighlights,
  };
}

function collectDocumentedProcedures(
  text: string,
  parsed: ReturnType<typeof parseEstimate>
) {
  const procedures: string[] = [];

  if (hasLine(parsed, /pre-?repair scan|pre scan|pre-scan|diagnostic scan/i)) {
    procedures.push("Pre-repair scan");
  }
  if (
    hasLine(
      parsed,
      /in-?process repair scan|in process repair scan|in-?proc(?:ess)? scan|in-?process scan/i
    )
  ) {
    procedures.push("In-process scan");
  }
  if (hasLine(parsed, /post-?repair scan|post scan|post-scan|final scan/i)) {
    procedures.push("Post-repair scan");
  }
  if (/headlamp aim|headlight aim|fog aim|lamp aim/i.test(text)) {
    procedures.push("Headlamp aiming check");
  }
  if (/cavity wax/i.test(text)) {
    procedures.push("Cavity wax");
  }
  if (/road test/i.test(text)) {
    procedures.push("Final road test");
  }
  if (/refrigerant/i.test(text)) {
    procedures.push("Refrigerant service");
  }
  if (/work authorization|repair authorization/i.test(text)) {
    procedures.push("Work authorization");
  }
  if (/procedures? research|oem procedures?|repair research/i.test(text)) {
    procedures.push("Procedure research/documentation");
  }
  if (/test fit|fit check|mock-?up/i.test(text)) {
    procedures.push("Test fits");
  }
  if (/state of charge|high voltage battery|\bhv battery\b/i.test(text)) {
    procedures.push("HV battery state-of-charge maintenance");
  }

  return [...new Set(procedures)];
}

function collectDocumentedHighlights(text: string) {
  return DOCUMENTED_HIGHLIGHT_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.label);
}

function extractMileage(text: string): number | undefined {
  const candidates = [
    text.match(/\bmileage\b\s*[:#-]?\s*([\d,]{2,})/i)?.[1],
    text.match(/\bodometer(?: reading)?\b\s*[:#-]?\s*([\d,]{2,})/i)?.[1],
    text.match(/\b([\d,]{2,})\s*(?:mi|miles)\b/i)?.[1],
  ]
    .filter(Boolean)
    .map((value) => Number(String(value).replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 1000000);

  return candidates[0];
}

function extractInsurer(text: string): string | undefined {
  const knownFromText = COMMON_INSURERS.find((carrier) =>
    new RegExp(`\\b${escapeRegExp(carrier)}\\b`, "i").test(text)
  );
  const labeled =
    text.match(/\b(?:insurer|insurance company|carrier|insurance co(?:mpany)?)\b\s*[:#-]\s*([A-Za-z][A-Za-z .&'-]{1,40})/i)?.[1]?.trim();
  return resolveCanonicalInsurerCandidate(
    { value: labeled, source: "labeled" },
    { value: knownFromText, source: "known_carrier" }
  );
}

export function normalizeInsurer(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const known = COMMON_INSURERS.find((carrier) => carrier.toLowerCase() === compact.toLowerCase());
  return known ?? compact;
}

export function resolveCanonicalInsurerCandidate(
  ...candidates: Array<
    | string
    | null
    | undefined
    | {
        value?: string | null;
        source?: "known_carrier" | "labeled" | "prior";
      }
  >
): string | undefined {
  const scored = candidates
    .map((candidate) => {
      if (typeof candidate === "string" || candidate == null) {
        return buildInsurerCandidateScore(candidate, "prior");
      }

      return buildInsurerCandidateScore(candidate.value, candidate.source ?? "prior");
    })
    .filter((candidate): candidate is ReturnType<typeof buildInsurerCandidateScore> & { normalized: string } => Boolean(candidate));

  if (scored.length === 0) {
    return undefined;
  }

  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.normalized;
}

function buildInsurerCandidateScore(
  value: string | null | undefined,
  source: "known_carrier" | "labeled" | "prior"
) {
  if (!value) return null;

  const normalized = normalizeInsurer(value);
  if (!normalized) return null;

  let score = source === "known_carrier" ? 300 : source === "labeled" ? 220 : 100;
  if (isKnownCarrier(normalized)) score += 400;
  if (looksLikeLikelyPersonName(normalized)) score -= 250;
  if (normalized.length <= 2) score -= 200;

  return { normalized, score };
}

function isKnownCarrier(value: string): boolean {
  return COMMON_INSURERS.some((carrier) => carrier.toLowerCase() === value.toLowerCase());
}

function looksLikeLikelyPersonName(value: string): boolean {
  if (!value) return false;
  if (isKnownCarrier(value)) return false;
  if (/[&/]/.test(value)) return false;
  return LIKELY_PERSON_NAME_PATTERN.test(value.trim());
}

function extractEstimateTotal(
  text: string,
  parsedTotal?: number
): number | undefined {
  if (typeof parsedTotal === "number" && parsedTotal > 0) {
    return parsedTotal;
  }

  const candidates = [
    text.match(/\bgrand total\b[^\d$]{0,20}\$?\s*([\d,]+\.\d{2})/i)?.[1],
    text.match(/\bestimate total\b[^\d$]{0,20}\$?\s*([\d,]+\.\d{2})/i)?.[1],
    text.match(/\btotal(?: loss)?\b[^\d$]{0,20}\$?\s*([\d,]+\.\d{2})/i)?.[1],
  ]
    .filter(Boolean)
    .map((value) => Number(String(value).replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);

  return candidates[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
