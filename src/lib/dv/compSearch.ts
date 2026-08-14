// Automated comparable-vehicle research for the DV generator, implementing the
// comp sourcing decision tree adopted 8/14/2026:
//
//   Tier 1 (clean comps, pre-loss ACV): 3 like-kind-quality listings within
//   ~100 miles of the owner's ZIP. Same model year; exact trim preferred,
//   adjacent trim acceptable (conservative direction) and noted.
//
//   Tier 2 (1-loss comps, post-loss): start at 100 miles, expand US-wide —
//   a nationwide 1-loss comp is still LKQ for value purposes. A comp counts
//   as confirmed 1-loss only when the listing text itself carries the
//   accident record; salvage/rebuilt/branded titles are excluded.
//
//   Tier 3: when even the nationwide sweep yields fewer than 3 confirmed
//   1-loss units, the sweep itself is recorded as scarcity evidence and the
//   calculation falls back to a projected stigma percentage.
//
// Search provider: Serper (same env gate as the existing market preview).
// Every comp records source + date accessed; ad snapshots remain a manual
// open item because listing pages die fast.

import type { DvComp, DvCompResearch, DvSweepRecord, DvTrimMatch, DvVehicle } from "./types";

const SEARCH_TIMEOUT_MS = 8000;
const CLEAN_RADIUS_MILES = 100;

type SerperOrganicResult = {
  title?: unknown;
  link?: unknown;
  snippet?: unknown;
};

type SearchOutcome = {
  results: Array<{ title: string; link?: string; snippet: string }>;
  rawCount: number;
};

function getSerperApiKey(): string | undefined {
  return (process.env.SERPER_API_KEY || process.env.GOOGLE_SERPER_API_KEY)?.trim() || undefined;
}

async function runSerperSearch(query: string, apiKey: string): Promise<SearchOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query, num: 10 }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const errorBody = (await response.text().catch(() => "")).trim();
    throw new Error(
      `Comparable search failed with status ${response.status}.${errorBody ? ` ${errorBody.slice(0, 200)}` : ""}`
    );
  }

  const payload = await response.json();
  const organic: unknown[] = Array.isArray(payload?.organic) ? payload.organic : [];
  const results: Array<{ title: string; link?: string; snippet: string }> = [];
  for (const item of organic) {
    const record = (item ?? {}) as SerperOrganicResult;
    const title = typeof record.title === "string" ? record.title : "";
    const snippet = typeof record.snippet === "string" ? record.snippet : "";
    const link = typeof record.link === "string" ? record.link : undefined;
    if (!title && !snippet) continue;
    results.push({ title, link, snippet });
  }

  return { results, rawCount: organic.length };
}

function extractHostname(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Listing pages carry an asking price; $1,000+ is always comma-formatted on
 *  the retail sites this searches. */
function extractAskingPrice(text: string): number | undefined {
  const matches = [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d{4,6})(?!\d)/g)]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value >= 2000 && value <= 500000);
  return matches[0];
}

function extractListingMileage(text: string): number | undefined {
  const match =
    /([\d,]{3,7})\s*(?:mi\b|miles\b)/i.exec(text) ??
    /mileage[:\s]+([\d,]{3,7})/i.exec(text);
  if (!match) return undefined;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 && value < 400000 ? value : undefined;
}

function extractPhone(text: string): string | undefined {
  return /\(?\b(\d{3})\)?[\s.-](\d{3})[\s.-](\d{4})\b/.exec(text)?.[0];
}

const NON_LISTING_URL = /\/(parts|reviews?|recalls?|news|blog|research|specs|owners|forum)\b/i;
const BRANDED_TITLE = /\b(salvage|rebuilt|branded\s+title|flood|lemon|total\s+loss\s+title|fire\s+damage)\b/i;

function isLikelyListing(entry: { title: string; link?: string; snippet: string }, vehicle: DvVehicle): boolean {
  const text = `${entry.title} ${entry.snippet}`;
  if (entry.link && NON_LISTING_URL.test(entry.link)) return false;
  if (BRANDED_TITLE.test(text)) return false;
  if (vehicle.model && !new RegExp(vehicle.model.replace(/[^A-Za-z0-9- ]/g, ""), "i").test(text)) {
    return false;
  }
  if (vehicle.year && !text.includes(String(vehicle.year))) return false;
  return true;
}

function classifyTrimMatch(text: string, trim: string | undefined): DvTrimMatch {
  if (!trim) return "model";
  const tokens = trim.split(/\s+/).filter((token) => token.length > 1);
  if (!tokens.length) return "model";
  const matched = tokens.filter((token) => new RegExp(`\\b${token}\\b`, "i").test(text));
  if (matched.length === tokens.length) return "exact";
  if (matched.length > 0) return "adjacent";
  return "model";
}

/** Dealer name from a "… | Dealer Name" / "… - Dealer Name" listing title. */
function extractDealerName(title: string): string | undefined {
  const parts = title.split(/\s[|–-]\s/);
  if (parts.length < 2) return undefined;
  const candidate = parts[parts.length - 1].trim();
  if (candidate.length < 3 || candidate.length > 60) return undefined;
  if (/for sale|used|new|cars?\.com|autotrader|cargurus|carfax|truecar/i.test(candidate)) {
    return undefined;
  }
  return candidate;
}

const ONE_LOSS_EVIDENCE =
  /\b(1|one)\s+accident(?:\s+reported)?\b|\baccident\s+reported\b|\baccident\/damage\b|\bdamage\s+reported\b/i;
const CLEAN_EVIDENCE = /\bno\s+accidents?\b|\baccident[-\s]free\b|\bclean\s+(?:carfax|history)\b/i;

function toComp(params: {
  entry: { title: string; link?: string; snippet: string };
  vehicle: DvVehicle;
  tier: DvComp["tier"];
  dateAccessed: string;
}): DvComp | null {
  const { entry } = params;
  const text = `${entry.title} ${entry.snippet}`;
  const askingPrice = extractAskingPrice(text);
  if (typeof askingPrice !== "number") return null;

  if (params.tier === "clean" && ONE_LOSS_EVIDENCE.test(text)) return null;

  let lossEvidence: string | undefined;
  if (params.tier === "one_loss") {
    const evidence = ONE_LOSS_EVIDENCE.exec(text);
    if (!evidence || CLEAN_EVIDENCE.test(text)) return null;
    lossEvidence = evidence[0];
  }

  return {
    tier: params.tier,
    title: entry.title.trim().slice(0, 160),
    dealer: extractDealerName(entry.title),
    phone: extractPhone(entry.snippet),
    askingPrice,
    mileage: extractListingMileage(text),
    url: entry.link,
    source: extractHostname(entry.link) ?? "web search result",
    trimMatch: classifyTrimMatch(text, params.vehicle.trim),
    dateAccessed: params.dateAccessed,
    lossEvidence,
  };
}

function dedupeComps(comps: DvComp[]): DvComp[] {
  const seen = new Set<string>();
  const result: DvComp[] = [];
  for (const comp of comps) {
    const key = comp.url ?? `${comp.source}:${comp.askingPrice}:${comp.mileage ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(comp);
  }
  return result;
}

/** Exact-trim comps sort first; ties break toward listings with mileage
 *  (adjustable) over those without. */
function sortCleanComps(comps: DvComp[]): DvComp[] {
  const rank: Record<DvTrimMatch, number> = { exact: 0, adjacent: 1, model: 2 };
  return [...comps].sort((left, right) => {
    const byTrim = rank[left.trimMatch] - rank[right.trimMatch];
    if (byTrim !== 0) return byTrim;
    return Number(right.mileage !== undefined) - Number(left.mileage !== undefined);
  });
}

function vehicleQueryIdentity(vehicle: DvVehicle, withTrim: boolean): string {
  return [vehicle.year, vehicle.make, vehicle.model, withTrim ? vehicle.trim : undefined]
    .filter(Boolean)
    .join(" ");
}

function buildCleanQueries(vehicle: DvVehicle, zip: string): string[] {
  const trimIdentity = vehicleQueryIdentity(vehicle, true);
  const modelIdentity = vehicleQueryIdentity(vehicle, false);
  return [
    `${trimIdentity} for sale near ${zip}`,
    `${trimIdentity} for sale within ${CLEAN_RADIUS_MILES} miles of ${zip}`,
    `site:cars.com ${trimIdentity} for sale ${zip}`,
    `site:cargurus.com ${trimIdentity} for sale ${zip}`,
    `site:truecar.com ${modelIdentity} for sale ${zip}`,
    `${modelIdentity} for sale near ${zip}`,
  ];
}

function buildOneLossQueries(vehicle: DvVehicle, zip: string): Array<{ query: string; scope: DvSweepRecord["scope"] }> {
  const modelIdentity = vehicleQueryIdentity(vehicle, false);
  return [
    { query: `used ${modelIdentity} "accident reported" for sale near ${zip}`, scope: "radius" },
    { query: `used ${modelIdentity} "1 accident" for sale near ${zip}`, scope: "radius" },
    { query: `used ${modelIdentity} "accident reported" for sale`, scope: "nationwide" },
    { query: `used ${modelIdentity} "1 accident" for sale`, scope: "nationwide" },
    { query: `site:carfax.com/cars-for-sale used ${modelIdentity} accident`, scope: "nationwide" },
    { query: `site:cargurus.com used ${modelIdentity} "accident reported"`, scope: "nationwide" },
  ];
}

export async function runDvCompResearch(params: {
  vehicle: DvVehicle;
  zip: string;
  dateAccessed: string;
}): Promise<DvCompResearch> {
  const apiKey = getSerperApiKey();
  if (!apiKey) {
    return {
      status: "provider_not_configured",
      tier: null,
      clean: [],
      oneLoss: [],
      sweep: [],
      notes: [],
      failureReason:
        "The live comparable search provider is not configured for this environment.",
    };
  }

  const notes: string[] = [];
  const sweep: DvSweepRecord[] = [];

  try {
    // Tier 1 — clean comps for the pre-loss ACV.
    const clean: DvComp[] = [];
    for (const query of buildCleanQueries(params.vehicle, params.zip)) {
      const outcome = await runSerperSearch(query, apiKey);
      const comps = outcome.results
        .filter((entry) => isLikelyListing(entry, params.vehicle))
        .map((entry) =>
          toComp({ entry, vehicle: params.vehicle, tier: "clean", dateAccessed: params.dateAccessed })
        )
        .filter((comp): comp is DvComp => Boolean(comp));
      clean.push(...comps);
      if (dedupeComps(clean).length >= 3) break;
    }

    const cleanSelected = sortCleanComps(dedupeComps(clean)).slice(0, 3);
    if (cleanSelected.length === 0) {
      return {
        status: "insufficient_clean_comps",
        tier: null,
        clean: [],
        oneLoss: [],
        sweep,
        notes,
        failureReason:
          `No like-kind-quality listings with a usable asking price were found within ` +
          `${CLEAN_RADIUS_MILES} miles of ZIP ${params.zip}. The pre-loss ACV cannot be computed without at least one comp.`,
      };
    }
    if (cleanSelected.length < 3) {
      notes.push(
        `Only ${cleanSelected.length} clean comparable listing(s) parsed with a usable asking price; the house method prefers 3.`
      );
    }
    if (cleanSelected.some((comp) => comp.trimMatch !== "exact")) {
      notes.push(
        "One or more comps are an adjacent trim below the subject vehicle, which biases the ACV conservative — a defensible posture in negotiation."
      );
    }

    // Tier 2 — confirmed 1-loss comps, radius first, then US-wide.
    const oneLoss: DvComp[] = [];
    for (const { query, scope } of buildOneLossQueries(params.vehicle, params.zip)) {
      const outcome = await runSerperSearch(query, apiKey);
      const comps = outcome.results
        .filter((entry) => isLikelyListing(entry, params.vehicle))
        .map((entry) =>
          toComp({ entry, vehicle: params.vehicle, tier: "one_loss", dateAccessed: params.dateAccessed })
        )
        .filter((comp): comp is DvComp => Boolean(comp));
      oneLoss.push(...comps);

      sweep.push({
        query,
        scope,
        source: "google.serper.dev",
        resultCount: outcome.rawCount,
        note:
          comps.length > 0
            ? `${comps.length} confirmed 1-loss listing(s) parsed.`
            : "No listing in this result set carried a confirmed single-loss record with a usable price.",
      });

      if (dedupeComps(oneLoss).length >= 3) break;
    }

    const oneLossSelected = dedupeComps(oneLoss).slice(0, 3);
    const tier: 2 | 3 = oneLossSelected.length >= 3 ? 2 : 3;
    if (tier === 3) {
      notes.push(
        "The 1-loss sweep (radius, then US-wide) returned fewer than 3 confirmed single-loss units. " +
          "The sweep is recorded above as scarcity evidence: the retail market largely declines to stock " +
          "loss-history units of this vehicle, which supports the stigma discount."
      );
    }

    return {
      status: "completed",
      tier,
      clean: cleanSelected,
      oneLoss: oneLossSelected,
      sweep,
      notes,
    };
  } catch (error) {
    return {
      status: "failed",
      tier: null,
      clean: [],
      oneLoss: [],
      sweep,
      notes,
      failureReason:
        error instanceof Error ? error.message : "Comparable research failed unexpectedly.",
    };
  }
}
