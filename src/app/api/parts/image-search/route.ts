import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import type { PartImageReference, PartImageSearchResponse } from "@/lib/ai/partImageReference";

export const runtime = "nodejs";

type SerperImagesPayload = {
  images?: Array<{
    title?: string;
    imageUrl?: string;
    link?: string;
    source?: string;
    domain?: string;
  }>;
};

/**
 * Internet reference-image lookup for a specific part number (Serper image
 * search). Results are research leads for visual reference — never verified
 * OEM diagrams — and the client must label them as internet-sourced.
 */
export async function POST(req: Request) {
  try {
    await requireCurrentUser();

    const body = (await req.json().catch(() => ({}))) as { query?: unknown };
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 200) : "";
    if (!query) {
      return NextResponse.json({ error: "PART_IMAGE_QUERY_REQUIRED" }, { status: 400 });
    }

    const apiKey = process.env.SERPER_API_KEY || process.env.GOOGLE_SERPER_API_KEY;
    if (!apiKey) {
      const payload: PartImageSearchResponse = { status: "not_configured", query, results: [] };
      return NextResponse.json(payload, { status: 200 });
    }

    const response = await fetch("https://google.serper.dev/images", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({ q: query, num: 8 }),
    }).catch(() => null);

    if (!response?.ok) {
      const detail = response ? (await response.text().catch(() => "")).trim().slice(0, 200) : "";
      console.warn("[part-image-search] Serper images query failed", {
        status: response?.status ?? "no_response",
        query,
        detail: detail || undefined,
      });
      const payload: PartImageSearchResponse = { status: "error", query, results: [] };
      return NextResponse.json(payload, { status: 200 });
    }

    const data = (await response.json().catch(() => null)) as SerperImagesPayload | null;
    const results: PartImageReference[] = (data?.images ?? [])
      .filter((item) => Boolean(item.title && item.imageUrl && item.link))
      .slice(0, 4)
      .map((item) => ({
        title: item.title as string,
        imageUrl: item.imageUrl as string,
        sourceUrl: item.link as string,
        source: item.source || item.domain || new URL(item.link as string).hostname,
      }));

    const payload: PartImageSearchResponse = {
      status: results.length > 0 ? "success" : "no_results",
      query,
      results,
    };
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    console.error("[part-image-search] failed", error);
    return NextResponse.json({ error: "PART_IMAGE_SEARCH_FAILED" }, { status: 500 });
  }
}
