import { createHash } from "node:crypto";
import type { DriveRetrievalRequest } from "@/lib/ai/contracts/driveRetrievalContract";

export type WebRetrievalSourceType = "oem" | "law" | "industry";

export type WebRetrievalResult = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  sourceType: WebRetrievalSourceType;
  query: string;
  relevanceScore: number;
};

export type WebRetrievalResponse = {
  status: "success" | "no_results" | "not_configured" | "error";
  queries: string[];
  results: WebRetrievalResult[];
};

type SerperPayload = {
  organic?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
  }>;
};

export async function retrieveWebSupport(
  request: DriveRetrievalRequest,
  options?: { maxResults?: number; maxQueries?: number }
): Promise<WebRetrievalResponse> {
  const apiKey = process.env.SERPER_API_KEY || process.env.GOOGLE_SERPER_API_KEY;
  if (!apiKey) {
    return { status: "not_configured", queries: [], results: [] };
  }

  const queries = buildWebQueries(request).slice(0, options?.maxQueries ?? 3);
  if (queries.length === 0) {
    return { status: "no_results", queries: [], results: [] };
  }

  const maxResults = options?.maxResults ?? 5;
  const results: WebRetrievalResult[] = [];

  try {
    for (const query of queries) {
      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({ q: query, num: 6 }),
      }).catch(() => null);

      if (!response?.ok) {
        // Surface the Serper failure reason (e.g. credits/auth/bad-request) instead of silently
        // swallowing it — otherwise the OEM authority + deep-research lanes look like "no results"
        // when the real cause is an account/key/credits issue (mirrors the market-preview fix).
        const body = response ? (await response.text().catch(() => "")).trim().slice(0, 200) : "";
        console.warn("[web-retrieval] Serper query failed", {
          status: response?.status ?? "no_response",
          query,
          detail: body || undefined,
        });
        continue;
      }
      const payload = (await response.json().catch(() => null)) as SerperPayload | null;

      for (const item of payload?.organic ?? []) {
        if (!item.title || !item.link) continue;
        const sourceType = classifyWebSourceType(item.title, item.link);
        results.push({
          id: stableId(`web:${item.link}:${query}`),
          title: item.title,
          url: item.link,
          snippet: item.snippet ?? "",
          sourceType,
          query,
          relevanceScore: sourceType === "law" || sourceType === "oem" ? 0.7 : 0.5,
        });
      }
    }
  } catch (error) {
    console.error("[web-retrieval] Serper lookup failed (non-blocking)", { error });
    return { status: "error", queries, results: [] };
  }

  const deduped = dedupeResults(results).slice(0, maxResults);
  return {
    status: deduped.length > 0 ? "success" : "no_results",
    queries,
    results: deduped,
  };
}

export function buildWebRefinementContext(response: WebRetrievalResponse): string {
  if (response.results.length === 0) {
    return "";
  }

  const lines = response.results.map((result) => {
    const label = result.sourceType === "law" ? "State Law / Regulation" : result.sourceType === "oem" ? "OEM Support" : "Industry Reference";
    return `- [${label}] ${result.title} (${result.url})\n  snippet: "${result.snippet}"`;
  });

  return ["Web Support (external retrieval):", ...lines].join("\n");
}

function buildWebQueries(request: DriveRetrievalRequest): string[] {
  const year = request.vehicle.year ? String(request.vehicle.year) : "";
  const make = request.vehicle.make ?? "";
  const model = request.vehicle.model ?? "";
  const vehicleCore = [year, make, model].filter(Boolean).join(" ").trim();
  const stateCode = request.jurisdiction?.stateCode;

  const oemLane = request.lanePlans.find((plan) => plan.lane === "oem_lane");
  const lawLane = request.lanePlans.find((plan) => plan.lane === "pa_law_lane");

  const queries: string[] = [];

  if (oemLane && oemLane.topics.length > 0) {
    const primaryTopic = oemLane.topics[0]?.topic?.replace(/_/g, " ") ?? "";
    queries.push(
      [vehicleCore, "OEM repair procedure position statement", primaryTopic].filter(Boolean).join(" ").trim()
    );
  }

  if (lawLane && lawLane.topics.length > 0) {
    const primaryTopic = lawLane.topics[0]?.topic?.replace(/_/g, " ") ?? "";
    queries.push(
      [stateCode || "state", "insurance regulation statute consumer rights", primaryTopic].filter(Boolean).join(" ").trim()
    );
  }

  if (queries.length === 0 && vehicleCore) {
    queries.push([vehicleCore, "OEM repair procedure"].filter(Boolean).join(" ").trim());
  }

  return Array.from(new Set(queries)).filter(Boolean);
}

function classifyWebSourceType(title: string, url: string): WebRetrievalSourceType {
  const text = `${title} ${url}`;
  if (/doi|insurance department|insurance commissioner|statute|regulation|appraisal/i.test(text)) return "law";
  if (/oem|manufacturer|position statement|repair procedure|service information/i.test(text)) return "oem";
  return "industry";
}

function dedupeResults(results: WebRetrievalResult[]): WebRetrievalResult[] {
  return [...new Map(results.map((result) => [result.url, result])).values()].sort(
    (a, b) => b.relevanceScore - a.relevanceScore
  );
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
