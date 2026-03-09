export function procedureChunk(text: string, maxLength = 1200) {

  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let current: string[] = []

  const procedurePattern =
    /^(step\s*\d+|warning|caution|important|note|required|verify|pre[- ]?scan|post[- ]?scan|procedure|calibration|inspection|replacement|installation|removal|repairs? and inspections? required)/i

  for (const line of lines) {

    procedurePattern.lastIndex = 0
    const isProcedureLine = procedurePattern.test(line)

    const isHeader =
      line.length < 120 &&
      /^[A-Z][A-Za-z\s]{10,}$/.test(line) &&
      !line.includes(".")

    if ((isProcedureLine || isHeader) && current.length > 0) {
      chunks.push(current.join("\n"))
      current = []
    }

    current.push(line)

    const length = current.join(" ").length

    if (length > maxLength) {
      chunks.push(current.join("\n"))
      current = []
    }
  }

  if (current.length) {
    chunks.push(current.join("\n"))
  }

  return chunks
}