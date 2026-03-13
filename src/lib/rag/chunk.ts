import { procedureChunk } from "./procedureChunk";

export function chunkText(
  text: string,
  chunkSize = 1200,
  overlap = 150
): string[] {

  const clean = (text || "").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];

  // Try procedure-aware chunking first
  const procedureChunks = procedureChunk(text, chunkSize);

  if (procedureChunks.length > 1) {
    return procedureChunks.map(c => c.text);
  }

  // --------
  // Split into paragraphs first
  // --------
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const p of paragraphs) {

    if ((current + "\n\n" + p).length > chunkSize) {

      if (current) chunks.push(current.trim());

      // overlap to preserve context
      current = current.slice(-overlap) + "\n\n" + p;

    } else {

      current += (current ? "\n\n" : "") + p;

    }
  }

  if (current) chunks.push(current.trim());

  return chunks;
}