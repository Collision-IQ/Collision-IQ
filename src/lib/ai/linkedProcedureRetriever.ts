import pdfParse from "pdf-parse";
import {
  downloadDriveFile,
  extractDriveFileIdFromUrl,
  isDriveEnabled,
} from "@/lib/drive/download";
import {
  assessRetrievedDocumentApplicability,
  type VehicleApplicabilityContext,
} from "./vehicleApplicability";
import type { EstimateLinkCandidate } from "./estimateLinkExtractor";
import {
  downloadEgnyteSharedLink,
  extractEgnyteShareLinkId,
  isEgnyteConfigured,
} from "@/lib/egnyte/sharedLink";

export type LinkedProcedureDoc = {
  url: string;
  domain: string;
  title?: string;
  excerpt: string;
  sourceFilename?: string;
  context?: string;
  vehicleSignals: string[];
  isOemSpecific: boolean;
  isAdasSpecific: boolean;
  matchLevel: "exact_vehicle_match" | "manufacturer_match" | "generic" | "mismatched_vehicle";
};

export type LinkedProcedureDiscard = {
  url: string;
  domain: string;
  reason: string;
  stage: "fetch_failed" | "unsupported_content" | "vehicle_mismatch";
};

export async function retrieveEstimateLinkedProcedureDocs(params: {
  links: EstimateLinkCandidate[];
  vehicle: VehicleApplicabilityContext | null | undefined;
  maxLinks?: number;
  timeoutMs?: number;
}): Promise<{
  keptDocs: LinkedProcedureDoc[];
  discardedDocs: LinkedProcedureDiscard[];
  fetchedCount: number;
}> {
  const keptDocs: LinkedProcedureDoc[] = [];
  const discardedDocs: LinkedProcedureDiscard[] = [];
  const fetchableLinks = params.links.slice(0, params.maxLinks ?? 4);
  let fetchedCount = 0;

  for (const link of fetchableLinks) {
    try {
      const fetched = await fetchLinkedProcedureDoc(link, params.timeoutMs ?? 5000);
      if (!fetched) {
        discardedDocs.push({
          url: link.url,
          domain: link.domain,
          reason: "Linked document content type was unsupported or empty.",
          stage: "unsupported_content",
        });
        continue;
      }

      fetchedCount += 1;
      const applicability = assessRetrievedDocumentApplicability({
        title: fetched.title ?? link.context ?? link.url,
        excerpt: fetched.text,
        source: link.url,
        vehicle: params.vehicle,
      });

      if (!applicability.keep) {
        discardedDocs.push({
          url: link.url,
          domain: link.domain,
          reason: applicability.reason,
          stage: "vehicle_mismatch",
        });
        continue;
      }

      keptDocs.push({
        url: link.url,
        domain: link.domain,
        title: fetched.title,
        excerpt: fetched.text.slice(0, 3200),
        sourceFilename: link.sourceFilename,
        context: link.context,
        vehicleSignals: applicability.mentionedTerms,
        isOemSpecific: link.classification === "oem_procedure",
        isAdasSpecific: /\b(?:adas|calibration|sensor|camera|radar|eyesight|kafas)\b/i.test(
          `${fetched.title ?? ""} ${fetched.text}`
        ),
        matchLevel: applicability.matchLevel,
      });
    } catch (error) {
      discardedDocs.push({
        url: link.url,
        domain: link.domain,
        reason: error instanceof Error ? error.message : String(error),
        stage: "fetch_failed",
      });
    }
  }

  return {
    keptDocs,
    discardedDocs,
    fetchedCount,
  };
}

export function buildLinkedProcedureRefinementContext(
  docs: LinkedProcedureDoc[],
  vehicleLabel?: string
): string {
  if (docs.length === 0) return "";

  return [
    vehicleLabel
      ? `Estimate-linked OEM/ADAS references for ${vehicleLabel}:`
      : "Estimate-linked OEM/ADAS references:",
    ...docs.map((doc) => {
      const flags = [
        doc.isOemSpecific ? "OEM-specific" : "reference",
        doc.isAdasSpecific ? "ADAS-related" : null,
        doc.matchLevel.replace(/_/g, " "),
      ]
        .filter(Boolean)
        .join(", ");
      return `- ${doc.title ?? "Linked supporting document"} | source=${doc.domain} | ${flags}
  excerpt: ${doc.excerpt}`;
    }),
  ].join("\n");
}

async function fetchLinkedProcedureDoc(
  link: EstimateLinkCandidate,
  timeoutMs: number
): Promise<{ title?: string; text: string } | null> {
  // Egnyte share link (Collision IQ's own DMS). Resolve it through the Egnyte API and parse the
  // underlying file. When Egnyte is not configured we surface a clear, retrieval-was-attempted
  // failure (caller records it) rather than falling through to a generic GET of the HTML viewer.
  const egnyteLinkId = extractEgnyteShareLinkId(link.url);
  if (egnyteLinkId) {
    if (!isEgnyteConfigured()) {
      throw new Error("Egnyte repository link recognized, but the Egnyte integration is not configured for this environment (EGNYTE_BASE_URL / EGNYTE_API_TOKEN).");
    }
    const downloaded = await downloadEgnyteSharedLink(link.url);
    if (!downloaded) return null;
    const mimeType = downloaded.mimeType?.toLowerCase() ?? "";
    if (mimeType.includes("application/pdf") || /\.pdf$/i.test(downloaded.name)) {
      const parsed = await pdfParse(downloaded.buffer);
      const text = parsed.text?.replace(/\s+/g, " ").trim();
      return text ? { title: downloaded.name, text } : null;
    }
    if (mimeType.includes("text") || mimeType.includes("csv") || mimeType.includes("json")) {
      const text = downloaded.buffer.toString("utf-8").replace(/\s+/g, " ").trim();
      return text ? { title: downloaded.name, text } : null;
    }
    return null;
  }

  const driveFileId = extractDriveFileIdFromUrl(link.url);
  if (driveFileId) {
    if (!isDriveEnabled()) {
      return null;
    }

    try {
      const downloaded = await downloadDriveFile(driveFileId);
      const mimeType = downloaded.mimeType?.toLowerCase() ?? "";
      if (mimeType.includes("application/pdf")) {
        const parsed = await pdfParse(downloaded.buffer);
        const text = parsed.text?.replace(/\s+/g, " ").trim();
        return text ? { title: downloaded.name, text } : null;
      }

      if (mimeType.includes("text") || mimeType.includes("csv")) {
        const text = downloaded.buffer.toString("utf-8").replace(/\s+/g, " ").trim();
        return text ? { title: downloaded.name, text } : null;
      }

      return null;
    } catch (error) {
      console.error("[drive] external lookup failed (non-blocking)", {
        fileId: driveFileId,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(link.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5",
      },
    });

    if (!response.ok) {
      throw new Error(`Linked doc fetch failed with ${response.status}`);
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();

    if (contentType.includes("application/pdf") || /\.pdf(?:$|[?#])/i.test(link.url)) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const parsed = await pdfParse(buffer);
      const text = parsed.text?.replace(/\s+/g, " ").trim();
      return text ? { title: link.context, text } : null;
    }

    if (contentType.includes("text/html")) {
      const html = await response.text();
      const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
      const text = stripHtml(html);
      return text ? { title, text } : null;
    }

    if (contentType.includes("text/plain") || contentType.includes("application/json")) {
      const text = (await response.text()).replace(/\s+/g, " ").trim();
      return text ? { title: link.context, text } : null;
    }

    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}
