export function chunkText(
  text: string,
  chunkSize = 4500,
  overlap = 500
): string[] {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let i = 0;

  while (i < clean.length) {
    const end = Math.min(i + chunkSize, clean.length);
    chunks.push(clean.slice(i, end));
    if (end === clean.length) break;
    i = Math.max(0, end - overlap);
  }

  return chunks;
}