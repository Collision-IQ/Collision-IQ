const URL_REGEX =
  /\bhttps?:\/\/(?:[\w-]+\.)+[\w-]+(?:\/[\w\-._~:/?#[\]@!$&'()*+,;=%]*)?/gi;

export function extractLinksFromText(text: string): string[] {
  if (!text) return [];

  const matches = text.match(URL_REGEX) || [];

  const cleaned = matches
    .map((url) => url.trim())
    .map((url) => url.replace(/[)\].,;]+$/g, ""))
    .filter(Boolean);

  return [...new Set(cleaned)];
}

export function extractLinksFromFiles(
  files: Array<{ name?: string; text?: string | null; summary?: string | null }>
): string[] {
  const allText = files
    .map((file) => `${file.name || ""}\n${file.text || file.summary || ""}`)
    .join("\n\n");

  return extractLinksFromText(allText);
}
