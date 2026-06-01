const OPENAI_VISION_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function normalizeMimeType(value?: string | null): string | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "image/jpg") {
    return "image/jpeg";
  }

  return normalized;
}

function extractDataUrlMimeType(dataUrl?: string | null): string | null {
  if (!dataUrl) return null;
  if (!dataUrl.startsWith("data:")) return null;

  const delimiter = dataUrl.indexOf(";");
  const commaDelimiter = dataUrl.indexOf(",");
  const end = delimiter >= 0 ? delimiter : commaDelimiter;
  if (end <= 5) return null;

  return normalizeMimeType(dataUrl.slice(5, end));
}

export function isOpenAiVisionCompatibleImage(params: {
  mime?: string | null;
  imageDataUrl?: string | null;
}) {
  if (!params.imageDataUrl) {
    return false;
  }

  const dataUrlMimeType = extractDataUrlMimeType(params.imageDataUrl);
  const documentMimeType = normalizeMimeType(params.mime);
  const candidates = [dataUrlMimeType, documentMimeType].filter(
    (candidate): candidate is string => Boolean(candidate)
  );

  if (!candidates.length) {
    return false;
  }

  return candidates.some((candidate) => OPENAI_VISION_IMAGE_MIME_TYPES.has(candidate));
}
