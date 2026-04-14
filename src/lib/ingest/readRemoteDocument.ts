import pdf from "pdf-parse";
import { normalizeRemoteUrl } from "@/lib/ingest/normalizeRemoteUrl";

export type RemoteDocumentResult = {
  url: string;
  finalUrl: string;
  title: string | null;
  mimeType: string | null;
  sourceType: "google_doc" | "google_drive" | "pdf" | "html" | "unknown";
  text: string;
  status: "ok" | "blocked" | "failed";
  notes?: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return match?.[1]?.trim() || null;
}

export async function readRemoteDocument(
  rawUrl: string
): Promise<RemoteDocumentResult> {
  const normalized = normalizeRemoteUrl(rawUrl);

  try {
    const response = await fetch(normalized.normalizedUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "CollisionIQBot/1.0",
        Accept:
          "text/plain,text/html,application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    });

    const finalUrl = response.url || normalized.normalizedUrl;
    const mimeType = response.headers.get("content-type");

    if (!response.ok) {
      return {
        url: rawUrl,
        finalUrl,
        title: null,
        mimeType,
        sourceType: normalized.sourceType,
        text: "",
        status:
          response.status === 401 || response.status === 403 ? "blocked" : "failed",
        notes: `HTTP ${response.status}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (mimeType?.includes("application/pdf")) {
      const parsed = await pdf(buffer);
      const parsedInfo =
        parsed.info && typeof parsed.info === "object"
          ? (parsed.info as Record<string, unknown>)
          : null;
      const title =
        typeof parsedInfo?.Title === "string" && parsedInfo.Title.trim()
          ? parsedInfo.Title.trim()
          : null;

      return {
        url: rawUrl,
        finalUrl,
        title,
        mimeType,
        sourceType: "pdf",
        text: parsed.text?.trim() || "",
        status: "ok",
      };
    }

    const textBody = buffer.toString("utf-8");

    if (
      mimeType?.includes("text/plain") ||
      normalized.sourceType === "google_doc"
    ) {
      return {
        url: rawUrl,
        finalUrl,
        title: null,
        mimeType,
        sourceType: normalized.sourceType,
        text: textBody.trim(),
        status: "ok",
      };
    }

    if (mimeType?.includes("text/html") || normalized.sourceType === "html") {
      return {
        url: rawUrl,
        finalUrl,
        title: extractTitle(textBody),
        mimeType,
        sourceType: "html",
        text: stripHtml(textBody),
        status: "ok",
      };
    }

    return {
      url: rawUrl,
      finalUrl,
      title: null,
      mimeType,
      sourceType: normalized.sourceType,
      text: textBody.trim(),
      status: "ok",
      notes: "Parsed as generic text fallback.",
    };
  } catch (error: unknown) {
    return {
      url: rawUrl,
      finalUrl: normalized.normalizedUrl,
      title: null,
      mimeType: null,
      sourceType: normalized.sourceType,
      text: "",
      status: "failed",
      notes: error instanceof Error ? error.message : "Unknown fetch error",
    };
  }
}
