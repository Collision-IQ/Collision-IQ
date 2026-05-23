export type ExternalDocument = {
  id: string;
  name: string;
  mimeType: string | null;
  source: "drive";
  webViewLink?: string | null;
  webContentLink?: string | null;
  folderId?: string | null;
  pathHints?: string[];
};

export type ExternalLookupResult = {
  ok: boolean;
  source: "drive";
  documents: ExternalDocument[];
  skipped?: boolean;
  reason?: string;
};

export type ExternalDocumentDisplay = {
  id: string;
  title: string;
  url: string | null;
  source: "drive" | "external" | "legacy_egnyte";
  status:
    | "ready"
    | "preview_unavailable"
    | "access_limited"
    | "failed"
    | "skipped"
    | "referenced_not_retrieved"
    | "directional_support_only";
  reason?: string;
  previewUrl?: string | null;
  html?: string | null;
  textContent?: string | null;
};

type ExternalDocumentLike = {
  id?: string | null;
  title?: string | null;
  name?: string | null;
  url?: string | null;
  finalUrl?: string | null;
  webViewLink?: string | null;
  webContentLink?: string | null;
  source?: string | null;
  sourceType?: string | null;
  status?: string | null;
  reason?: string | null;
  notes?: string | null;
  directionalSupportOnly?: boolean | null;
  text?: string | null;
  textPreview?: string | null;
  html?: string | null;
  previewUrl?: string | null;
};

export function buildDriveDisabledLookupResult(): ExternalLookupResult {
  return {
    ok: false,
    source: "drive",
    documents: [],
    skipped: true,
    reason: "drive_disabled",
  };
}

export function normalizeExternalDocumentDisplay(
  document: ExternalDocumentLike,
  fallbackId = "external-document"
): ExternalDocumentDisplay {
  const url =
    document.url ||
    document.finalUrl ||
    document.webViewLink ||
    document.webContentLink ||
    null;
  const source = resolveExternalDocumentSource(document, url);
  const textContent = document.text || document.textPreview || null;
  const status = resolveExternalDocumentDisplayStatus(document, source, textContent);
  const previewUrl =
    status === "ready"
      ? document.previewUrl || document.webViewLink || document.finalUrl || null
      : null;

  return {
    id: document.id || url || fallbackId,
    title:
      status === "referenced_not_retrieved" && document.directionalSupportOnly
        ? document.title || document.name || "Referenced OEM Support"
        : document.title || document.name || "Linked OEM / procedure document",
    url: null,
    source,
    status,
    reason:
      source === "legacy_egnyte"
        ? "legacy_egnyte_link"
        : document.reason || document.notes || undefined,
    previewUrl,
    html: status === "ready" ? document.html || null : null,
    textContent,
  };
}

export function redactExternalDocumentUrls(value: string): string {
  return value.replace(
    /https?:\/\/[^\s)>\]]+/gi,
    (url) =>
      isRestrictedExternalDocumentUrl(url)
        ? "[linked supporting document]"
        : url
  );
}

export function summarizeExternalDocumentForDisplay(document: ExternalDocumentDisplay): string {
  if (document.textContent?.trim()) {
    return redactExternalDocumentUrls(document.textContent.trim());
  }

  return getExternalDocumentTerminalSummary(document.status, document.reason);
}

export function getExternalDocumentTerminalSummary(
  status: ExternalDocumentDisplay["status"],
  reason?: string | null
): string {
  if (status === "ready") {
    return "Supporting document identified. Summary available from the case evidence.";
  }
  if (status === "access_limited") {
    return "Supporting document identified, but access was limited during review.";
  }
  if (status === "failed") {
    return "Supporting document reference was preserved, but preview could not be loaded.";
  }
  if (status === "referenced_not_retrieved") {
    return (
      "The estimate references OEM or procedure-level documentation that supports this repair path, " +
      "but the linked document was not retrieved into the file. Treat this as directional support, " +
      "not fully preserved proof."
    );
  }
  if (status === "directional_support_only") {
    return (
      "The estimate references OEM or procedure-level documentation that supports this repair path, " +
      "but the linked document was not retrieved into the file. Treat this as directional support, " +
      "not fully preserved proof."
    );
  }
  if (status === "skipped") {
    return "Supporting document lookup was skipped without blocking the case review.";
  }
  if (reason === "legacy_egnyte_link") {
    return "Legacy supporting document reference identified in the file review. Preview is unavailable, but the reference remains part of the evidence state.";
  }
  return "Supporting document identified in the file review. Preview is unavailable.";
}

function isRestrictedExternalDocumentUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("egnyte.com") ||
    lower.includes("drive.google.com") ||
    lower.includes("docs.google.com") ||
    lower.includes("googleusercontent.com")
  );
}

function resolveExternalDocumentSource(
  document: ExternalDocumentLike,
  url: string | null
): ExternalDocumentDisplay["source"] {
  const haystack = `${document.source ?? ""} ${document.sourceType ?? ""} ${url ?? ""}`.toLowerCase();
  if (haystack.includes("egnyte.com") || haystack.includes("legacy_egnyte")) {
    return "legacy_egnyte";
  }
  if (haystack.includes("drive") || haystack.includes("google_doc")) {
    return "drive";
  }
  return "external";
}

function resolveExternalDocumentDisplayStatus(
  document: ExternalDocumentLike,
  source: ExternalDocumentDisplay["source"],
  textContent: string | null
): ExternalDocumentDisplay["status"] {
  const rawStatus = document.status?.toLowerCase();
  if (source === "legacy_egnyte") return "preview_unavailable";
  if (document.directionalSupportOnly) return "directional_support_only";
  if (rawStatus === "directional_support_only") return "directional_support_only";
  if (rawStatus === "blocked") return "access_limited";
  if (rawStatus === "failed") return "failed";
  if (rawStatus === "skipped") return "referenced_not_retrieved";
  if (rawStatus === "ok" && (document.previewUrl || document.html || textContent)) {
    return "ready";
  }
  if (rawStatus === "ok") return "preview_unavailable";
  return "preview_unavailable";
}
