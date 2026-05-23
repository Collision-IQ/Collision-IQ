export type NormalizedRemoteUrl = {
  originalUrl: string;
  normalizedUrl: string;
  sourceType:
    | "google_doc"
    | "google_drive"
    | "pdf"
    | "html"
    | "unknown";
};

function isGoogleDoc(url: URL) {
  return (
    url.hostname.includes("docs.google.com") &&
    url.pathname.includes("/document/")
  );
}

function isGoogleDrive(url: URL) {
  return url.hostname.includes("drive.google.com");
}

function isPdfUrl(url: URL) {
  return url.pathname.toLowerCase().endsWith(".pdf");
}

export function normalizeRemoteUrl(rawUrl: string): NormalizedRemoteUrl {
  const url = new URL(rawUrl);

  if (isGoogleDoc(url)) {
    const match = url.pathname.match(/\/document\/d\/([^/]+)/);

    if (match?.[1]) {
      const docId = match[1];
      return {
        originalUrl: rawUrl,
        normalizedUrl: `https://docs.google.com/document/d/${docId}/export?format=txt`,
        sourceType: "google_doc",
      };
    }
  }

  if (isGoogleDrive(url)) {
    return {
      originalUrl: rawUrl,
      normalizedUrl: rawUrl,
      sourceType: "google_drive",
    };
  }

  if (isPdfUrl(url)) {
    return {
      originalUrl: rawUrl,
      normalizedUrl: rawUrl,
      sourceType: "pdf",
    };
  }

  return {
    originalUrl: rawUrl,
    normalizedUrl: rawUrl,
    sourceType: "html",
  };
}
