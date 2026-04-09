export type ProcedureChunk = {
  text: string
  stepNumber?: number | null
  section?: string | null
}

export function procedureChunk(text: string, maxLength = 1200): ProcedureChunk[] {

  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)

  const chunks: ProcedureChunk[] = []

  let currentLines: string[] = []
  let currentHeader: string | null = null
  let currentStep: number | null = null

  const stepRegex = /^step\s*(\d+)/i

  const procedurePattern =
    /^(step\s*\d+|warning|caution|important|note|required|verify|pre[- ]?scan|post[- ]?scan|procedure|calibration|inspection|replacement|installation|removal)/i

  const headerPattern =
    /^[A-Z][A-Za-z\s]{8,}$/

  for (const line of lines) {

    const stepMatch = line.match(stepRegex)
    if (stepMatch) {
      currentStep = Number(stepMatch[1])
    }

    const isProcedureLine = procedurePattern.test(line)

    const isHeader =
      line.length < 120 &&
      headerPattern.test(line) &&
      !line.includes(".")

    if (isHeader) {
      currentHeader = line
    }

    if ((isProcedureLine || isHeader) && currentLines.length > 0) {

      chunks.push({
        text: currentLines.join("\n"),
        stepNumber: currentStep,
        section: currentHeader
      })

      currentLines = []

      if (currentHeader) {
        currentLines.push(`Procedure: ${currentHeader}`)
      }
    }

    if (currentLines.length === 0 && currentHeader) {
      currentLines.push(`Procedure: ${currentHeader}`)
    }

    currentLines.push(line)

    if (currentLines.join(" ").length > maxLength) {

      chunks.push({
        text: currentLines.join("\n"),
        stepNumber: currentStep,
        section: currentHeader
      })

      currentLines = []
    }
  }

  if (currentLines.length) {
    chunks.push({
      text: currentLines.join("\n"),
      stepNumber: currentStep,
      section: currentHeader
    })
  }

  return chunks
}