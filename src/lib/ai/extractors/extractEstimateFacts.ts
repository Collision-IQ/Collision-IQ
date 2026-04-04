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
  const labeled =
    text.match(/\b(?:insurer|insurance company|carrier|insurance co(?:mpany)?)\b\s*[:#-]\s*([A-Za-z][A-Za-z .&'-]{1,40})/i)?.[1]?.trim();
  if (labeled) {
    return normalizeInsurer(labeled);
  }

  const matchedCarrier = COMMON_INSURERS.find((carrier) =>
    new RegExp(`\\b${escapeRegExp(carrier)}\\b`, "i").test(text)
  );
  return matchedCarrier;
}

function normalizeInsurer(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const known = COMMON_INSURERS.find((carrier) => carrier.toLowerCase() === compact.toLowerCase());
  return known ?? compact;
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
