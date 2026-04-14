import {
  extractLinksFromFiles,
  extractLinksFromText,
} from "@/lib/ingest/extractLinks";
import {
  readRemoteDocument,
  type RemoteDocumentResult,
} from "@/lib/ingest/readRemoteDocument";

export type LinkedEvidence = {
  url: string;
  finalUrl: string;
  title: string | null;
  mimeType: string | null;
  sourceType: "google_doc" | "google_drive" | "pdf" | "html" | "unknown";
  text: string;
  status: "ok" | "blocked" | "failed";
  notes?: string;
};

type BuildLinkedEvidenceInput = {
  estimateText?: string;
  files?: Array<{
    name?: string;
    text?: string | null;
    summary?: string | null;
  }>;
};

function dedupeUrls(urls: string[]) {
  return [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
}

function scoreLinkedDoc(doc: RemoteDocumentResult) {
  const haystack = `${doc.url}\n${doc.title || ""}\n${doc.text.slice(0, 2000)}`.toLowerCase();

  let score = 0;

  if (haystack.includes("adas")) score += 3;
  if (haystack.includes("calibration")) score += 3;
  if (haystack.includes("oem")) score += 2;
  if (haystack.includes("procedure")) score += 2;
  if (haystack.includes("scan")) score += 1;
  if (haystack.includes("repair")) score += 1;
  if (haystack.includes("position statement")) score += 2;

  return score;
}

export async function buildLinkedEvidence(
  input: BuildLinkedEvidenceInput
): Promise<LinkedEvidence[]> {
  const urls = dedupeUrls([
    ...extractLinksFromText(input.estimateText || ""),
    ...extractLinksFromFiles(input.files || []),
  ]);

  if (!urls.length) return [];

  const settled = await Promise.all(urls.map((url) => readRemoteDocument(url)));

  return settled
    .filter((doc) => doc.status === "ok" || doc.status === "blocked")
    .sort((a, b) => scoreLinkedDoc(b) - scoreLinkedDoc(a))
    .map((doc) => ({
      url: doc.url,
      finalUrl: doc.finalUrl,
      title: doc.title,
      mimeType: doc.mimeType,
      sourceType: doc.sourceType,
      text: doc.text,
      status: doc.status,
      notes: doc.notes,
    }));
}
