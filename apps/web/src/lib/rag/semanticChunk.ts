export function semanticChunk(text: string, maxLength = 900) {
  const paragraphs = text
    .split(/\n\s*\n/) // split by blank lines
    .map(p => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > maxLength) {
      if (current) chunks.push(current.trim());
      current = p;
    } else {
      current += (current ? "\n\n" : "") + p;
    }
  }

  if (current) chunks.push(current.trim());

  return chunks;
}