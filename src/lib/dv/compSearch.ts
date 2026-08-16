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
 *  the retail sites this searches. Prose shorthand ("$25k") must resolve to
 *  its real magnitude — grabbing a different stray number off the page turned
 *  a $25,000 vehicle into a $2,500 comp on a live run. */
function extractAskingPrice(text: string): number | undefined {
  const kForm = /\$\s?(\d{1,3}(?:\.\d)?)\s?k\b/i.exec(text);
  if (kForm) {
    const value = Number(kForm[1]) * 1000;
    if (Number.isFinite(value) && value >= 2000 && value <= 500000) return value;
  }
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

// Valuation guides, magazines, and rankings sites publish PRICES without
// selling CARS — a "comp" from any of these is not a retail listing and
// poisons the average (live failure: kbb.com and caranddriver.com comps
// pushed a Model X Plaid post-loss above its pre-loss ACV).
const RESEARCH_DOMAINS =
  /(^|\.)(kbb\.com|caranddriver\.com|motortrend\.com|jdpower\.com|nadaguides\.com|consumerreports\.org|usnews\.com|autoblog\.com|thecarconnection\.com|autoweek\.com|topspeed\.com|caredge\.com|iseecars\.com)$/i;

// Social/classified platforms are NEVER comps (owner's Step 3c source
// registry): posts are login-gated, carry no VIN or dealer accountability,
// state prices in shorthand prose, and cannot be cited to a carrier. A live
// run pulled a "$25k" Facebook group post in as a $2,500 loss-history comp.
const SOCIAL_CLASSIFIED_DOMAINS =
  /(^|\.)(facebook\.com|instagram\.com|craigslist\.org|offerup\.com|ebay\.com|nextdoor\.com|reddit\.com|x\.com|twitter\.com|tiktok\.com|pinterest\.com)$/i;

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isResearchDomain(url: string | undefined): boolean {
  const hostname = hostnameOf(url);
  return hostname !== null && RESEARCH_DOMAINS.test(hostname);
}

function isSocialClassifiedDomain(url: string | undefined): boolean {
  const hostname = hostnameOf(url);
  return hostname !== null && SOCIAL_CLASSIFIED_DOMAINS.test(hostname);
}

/** A clean comp must be like-kind-quality: an otherwise-identical vehicle
 *  45,000+ miles away from the subject is a different market segment, and the
 *  $0.07/mile adjustment stops being credible at that distance. */
const CLEAN_COMP_MAX_MILEAGE_DELTA = 45000;

/**
 * A comp the report cites must be a SINGLE listing an adjuster can open —
 * search-index and city-inventory pages parse a price that belongs to no
 * particular vehicle and die the moment inventory rotates. Each major site
 * has a recognizable detail-page URL shape; anything else on that site is
 * treated as an index page and rejected.
 */
function isDetailPageUrl(url: string | undefined): boolean {
  if (!url) return false;
  let hostname: string;
  let path: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.replace(/^www\./, "");
    path = parsed.pathname + parsed.hash;
  } catch {
    return false;
  }

  const rules: Array<{ host: RegExp; detail: RegExp }> = [
    { host: /(^|\.)carfax\.com$/, detail: /\/vehicle\//i },
    { host: /(^|\.)cargurus\.com$/, detail: /viewdetails|#listing=/i },
    { host: /(^|\.)cars\.com$/, detail: /\/vehicledetail\//i },
    { host: /(^|\.)autotrader\.com$/, detail: /\/cars-for-sale\/vehicle\/|vehicledetails/i },
    { host: /(^|\.)truecar\.com$/, detail: /\/listing\//i },
    { host: /(^|\.)edmunds\.com$/, detail: /\/vin\//i },
    { host: /(^|\.)carvana\.com$/, detail: /\/vehicle\//i },
    { host: /(^|\.)carmax\.com$/, detail: /\/car\//i },
  ];
  const rule = rules.find((entry) => entry.host.test(hostname));
  if (rule) return rule.detail.test(path);

  // Unknown site: reject obvious search/index shapes, otherwise allow — the
  // title/year/model gate still applies.
  return !/search|results|for-sale\/?$|_w\d+|\/inventory\/?$/i.test(path);
}

/** 17-char VIN in the URL or listing text — detail pages routinely carry it,
 *  and a VIN-bearing comp is verifiable by anyone reviewing the report. */
function extractCompVin(url: string | undefined, text: string): string | undefined {
  const haystack = `${url ?? ""} ${text}`.toUpperCase();
  return /(?:^|[^A-Z0-9])([A-HJ-NPR-Z0-9]{17})(?:[^A-Z0-9]|$)/.exec(haystack)?.[1];
}

/** CCC glues engine designations onto the model ("Q5 45", "CR-V Hybrid"):
 *  the FIRST token is the model the market searches by; the rest behaves
 *  like trim and may be phrased in any order on a listing title. */
function primaryModelToken(model: string | undefined): string | undefined {
  const token = model?.split(/\s+/).filter(Boolean)[0];
  return token ? token.replace(/[^A-Za-z0-9-]/g, "") : undefined;
}

function isLikelyListing(entry: { title: string; link?: string; snippet: string }, vehicle: DvVehicle): boolean {
  const text = `${entry.title} ${entry.snippet}`;
  if (entry.link && NON_LISTING_URL.test(entry.link)) return false;
  if (isResearchDomain(entry.link)) return false;
  if (isSocialClassifiedDomain(entry.link)) return false;
  if (BRANDED_TITLE.test(text)) return false;
  // The PRIMARY model token must appear in the TITLE itself. Requiring the
  // full glued model string ("Q5 45") rejected every real listing — titles
  // phrase the designation in any order ("Q5 Premium 45 TFSI") or omit it.
  const primary = primaryModelToken(vehicle.model);
  if (primary && !new RegExp(`\\b${primary}\\b`, "i").test(entry.title)) return false;
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
// A MULTI-loss unit is not LKQ to a 1-loss subject — "carfax shows two
// accidents hence the low price" is disqualifying, not confirming.
const MULTI_LOSS_EVIDENCE =
  /\b(?:two|three|four|2|3|4|multiple|several)\s+accidents\b|\baccidents\s+reported\b/i;

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
    if (!evidence || CLEAN_EVIDENCE.test(text) || MULTI_LOSS_EVIDENCE.test(text)) return null;
    lossEvidence = evidence[0];
  }

  return {
    tier: params.tier,
    listingQuality: isDetailPageUrl(entry.link) ? "detail" : "index",
    title: entry.title.trim().slice(0, 160),
    dealer: extractDealerName(entry.title),
    phone: extractPhone(entry.snippet),
    vin: extractCompVin(entry.link, text),
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

/** Single-vehicle detail pages always outrank inventory/index pages; within a
 *  quality band, exact-trim comps sort first, then listings with a readable
 *  (adjustable) mileage. */
function sortCleanComps(comps: DvComp[]): DvComp[] {
  const rank: Record<DvTrimMatch, number> = { exact: 0, adjacent: 1, model: 2 };
  return [...comps].sort((left, right) => {
    const byQuality =
      Number(left.listingQuality !== "detail") - Number(right.listingQuality !== "detail");
    if (byQuality !== 0) return byQuality;
    const byTrim = rank[left.trimMatch] - rank[right.trimMatch];
    if (byTrim !== 0) return byTrim;
    return Number(right.mileage !== undefined) - Number(left.mileage !== undefined);
  });
}

function vehicleQueryIdentity(vehicle: DvVehicle, withTrim: boolean): string {
  // Search by the primary model token; the glued designation tail ("45")
  // joins the trim side of the query where word order stops mattering.
  const primary = primaryModelToken(vehicle.model) ?? vehicle.model;
  const modelTail = vehicle.model?.split(/\s+/).slice(1).join(" ");
  return [
    vehicle.year,
    vehicle.make,
    primary,
    withTrim ? [modelTail, vehicle.trim].filter(Boolean).join(" ") : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildCleanQueries(vehicle: DvVehicle, zip: string): string[] {
  const trimIdentity = vehicleQueryIdentity(vehicle, true);
  const modelIdentity = vehicleQueryIdentity(vehicle, false);
  // Detail-page-targeted queries first: the URL filter only accepts single
  // listings, so aim the search engine at each site's detail-page path shape.
  return [
    `site:cars.com/vehicledetail ${trimIdentity}`,
    `site:carfax.com/vehicle ${trimIdentity}`,
    `site:truecar.com/used-cars-for-sale/listing ${trimIdentity}`,
    `site:edmunds.com ${trimIdentity} VIN`,
    `${trimIdentity} for sale near ${zip}`,
    `${trimIdentity} for sale within ${CLEAN_RADIUS_MILES} miles of ${zip}`,
    `site:cargurus.com ${trimIdentity} for sale ${zip}`,
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
    { query: `site:carfax.com/vehicle ${modelIdentity} "accident"`, scope: "nationwide" },
    { query: `site:cargurus.com used ${modelIdentity} "accident reported"`, scope: "nationwide" },
  ];
}

export async function runDvCompResearch(params: {
  vehicle: DvVehicle;
  zip: string;
  dateAccessed: string;
  /** Subject odometer — clean comps beyond ±45k miles of it are rejected. */
  subjectMileage?: number;
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
    // Tier 1 — clean comps for the pre-loss ACV. Keep searching until three
    // single-vehicle DETAIL listings are in hand; index-page comps accumulate
    // as fallback fill rather than stopping the sweep early.
    const clean: DvComp[] = [];
    for (const query of buildCleanQueries(params.vehicle, params.zip)) {
      const outcome = await runSerperSearch(query, apiKey);
      const comps = outcome.results
        .filter((entry) => isLikelyListing(entry, params.vehicle))
        .map((entry) =>
          toComp({ entry, vehicle: params.vehicle, tier: "clean", dateAccessed: params.dateAccessed })
        )
        .filter((comp): comp is DvComp => Boolean(comp))
        .filter(
          (comp) =>
            typeof params.subjectMileage !== "number" ||
            typeof comp.mileage !== "number" ||
            Math.abs(comp.mileage - params.subjectMileage) <= CLEAN_COMP_MAX_MILEAGE_DELTA
        );
      clean.push(...comps);
      const detailCount = dedupeComps(clean).filter(
        (comp) => comp.listingQuality === "detail"
      ).length;
      if (detailCount >= 3) break;
    }

    const cleanSelected = sortCleanComps(dedupeComps(clean)).slice(0, 3);
    const indexCompCount = cleanSelected.filter(
      (comp) => comp.listingQuality !== "detail"
    ).length;
    if (indexCompCount > 0) {
      notes.push(
        `${indexCompCount} comp(s) cite a live dealer inventory page rather than a single-vehicle listing; ` +
          "open the linked page and snapshot the specific matching ad before the packet is submitted."
      );
    }
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
    // Hard rule: a loss-history unit can never be worth as much as a clean
    // one, so any "1-loss comp" priced at or above the highest clean asking
    // price is a mis-parse or a different vehicle and is rejected outright.
    // The mirror guard: a repaired 1-loss retail unit also never sells for a
    // small fraction of the clean market — settled files run 4.7–18.4%
    // stigma, so a "comp" under 40% of the clean average is a scam post,
    // parts car, or mis-parse (live failure: a $2,500 Facebook comp against
    // a $36k clean market inflated DV to 46% of ACV).
    const maxCleanAsking = Math.max(...cleanSelected.map((comp) => comp.askingPrice));
    const cleanAverageAsking =
      cleanSelected.reduce((sum, comp) => sum + comp.askingPrice, 0) / cleanSelected.length;
    const minOneLossAsking = cleanAverageAsking * 0.4;
    const oneLoss: DvComp[] = [];
    for (const { query, scope } of buildOneLossQueries(params.vehicle, params.zip)) {
      const outcome = await runSerperSearch(query, apiKey);
      const comps = outcome.results
        .filter((entry) => isLikelyListing(entry, params.vehicle))
        .map((entry) =>
          toComp({ entry, vehicle: params.vehicle, tier: "one_loss", dateAccessed: params.dateAccessed })
        )
        .filter((comp): comp is DvComp => Boolean(comp))
        .filter((comp) => comp.askingPrice < maxCleanAsking && comp.askingPrice >= minOneLossAsking);
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
