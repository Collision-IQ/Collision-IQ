export function procedureChunk(text: string, maxLength = 1200) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  const chunks: string[] = [];
  let current: string[] = [];

  const procedurePattern =
    /^(step\s*\d+|warning|note|procedure|calibration|inspection)/i;

  for (const line of lines) {

    const isProcedureLine = procedurePattern.test(line);

    if (isProcedureLine && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
    }

    current.push(line);

    const length = current.join(" ").length;

    if (length > maxLength) {
      chunks.push(current.join("\n"));
      current = [];
    }
  }

  if (current.length) {
    chunks.push(current.join("\n"));
  }

  return chunks;
}