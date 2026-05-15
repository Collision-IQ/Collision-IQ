import pdf from "pdf-parse";
import {
  downloadDriveFile,
  extractDriveFileIdFromUrl,
  isDriveEnabled,
} from "@/lib/drive/download";
import { normalizeRemoteUrl } from "@/lib/ingest/normalizeRemoteUrl";

export type RemoteDocumentResult = {
  url: string;
  finalUrl: string;
  title: string | null;
  mimeType: string | null;
  sourceType: "google_doc" | "google_drive" | "pdf" | "html" | "unknown";
  text: string;
  status: "ok" | "blocked" | "failed" | "skipped";
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
  let normalized: ReturnType<typeof normalizeRemoteUrl> | null = null;

  try {
    normalized = normalizeRemoteUrl(rawUrl);

    if (/egnyte\.com/i.test(rawUrl)) {
      return {
        url: rawUrl,
        finalUrl: rawUrl,
        title: null,
        mimeType: null,
        sourceType: "unknown",
        text: "",
        status: "skipped",
        notes: "legacy_egnyte_link",
      };
    }

    if (normalized.sourceType === "google_drive" || normalized.sourceType === "google_doc") {
      if (!isDriveEnabled()) {
        return {
          url: rawUrl,
          finalUrl: normalized.normalizedUrl,
          title: null,
          mimeType: null,
          sourceType: normalized.sourceType,
          text: "",
          status: "skipped",
          notes: "drive_disabled",
        };
      }

      const fileId = extractDriveFileIdFromUrl(rawUrl);
      if (fileId) {
        const downloaded = await downloadDriveFile(fileId);
        const parsed = await parseRemoteBuffer({
          buffer: downloaded.buffer,
          mimeType: downloaded.mimeType,
          title: downloaded.name,
        });

        return {
          url: rawUrl,
          finalUrl: downloaded.webViewLink ?? normalized.normalizedUrl,
          title: downloaded.name,
          mimeType: downloaded.mimeType,
          sourceType: normalized.sourceType,
          text: parsed.text,
          status: "ok",
          notes: parsed.notes,
        };
      }
    }

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
      const parsed = await parseRemoteBuffer({
        buffer,
        mimeType,
        title: null,
      });

      return {
        url: rawUrl,
        finalUrl,
        title: parsed.title,
        mimeType,
        sourceType: "pdf",
        text: parsed.text,
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
      finalUrl: normalized?.normalizedUrl ?? rawUrl,
      title: null,
      mimeType: null,
      sourceType: normalized?.sourceType ?? "unknown",
      text: "",
      status: "failed",
      notes: error instanceof Error ? error.message : "Unknown fetch error",
    };
  }
}

async function parseRemoteBuffer(params: {
  buffer: Buffer;
  mimeType: string | null;
  title: string | null;
}): Promise<{ title: string | null; text: string; notes?: string }> {
  const mimeType = params.mimeType?.toLowerCase() ?? "";

  if (mimeType.includes("application/pdf")) {
    const parsed = await pdf(params.buffer);
    const parsedInfo =
      parsed.info && typeof parsed.info === "object"
        ? (parsed.info as Record<string, unknown>)
        : null;
    const title =
      params.title ||
      (typeof parsedInfo?.Title === "string" && parsedInfo.Title.trim()
        ? parsedInfo.Title.trim()
        : null);

    return {
      title,
      text: parsed.text?.trim() || "",
    };
  }

  if (mimeType.includes("text") || mimeType.includes("csv")) {
    return {
      title: params.title,
      text: params.buffer.toString("utf-8").trim(),
    };
  }

  return {
    title: params.title,
    text: params.buffer.toString("utf-8").trim(),
    notes: "Parsed as generic text fallback.",
  };
}
