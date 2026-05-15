export interface EstimateOperation {
  panel: string
  component: string
  operation: string
  laborHours?: number
  rawLine: string
}

export interface ParsedEstimate {
  vehicle?: string
  vin?: string
  operations: EstimateOperation[]
  rawText: string
}

export function parseEstimate(text: string): ParsedEstimate {
  const operations: EstimateOperation[] = []
  const lines = text.split("\n")
  const normalizedText = text.replace(/\r/g, "")

  for (const line of lines) {
    const trimmed = line.trim()
    const match = trimmed.match(
      /\b(R&I|R\s*&\s*I|Remove\s*&\s*Install|Remove\/Install|Repl|Replace|Rpr|Repair|Blnd|Blend|Cal(?:ibration)?|Scan)\b\s+(.+?)(?:\s+(\d+(?:\.\d+)?))?$/i
    )

    if (match) {
      const operation = normalizeOperation(match[1])
      const component = match[2].trim()

      operations.push({
        operation,
        panel: component,
        component,
        laborHours: match[3] ? Number(match[3]) : undefined,
        rawLine: trimmed,
      })
    }
  }

  return {
    operations,
    rawText: normalizedText,
  }
}

function normalizeOperation(operation: string): string {
  const lower = operation.toLowerCase()

  if (
    lower === "r&i" ||
    lower === "r & i" ||
    lower === "remove & install" ||
    lower === "remove/install"
  ) {
    return "R&I"
  }

  if (lower === "replace") return "Repl"
  if (lower === "repair") return "Rpr"
  if (lower === "blend") return "Blnd"
  if (lower.startsWith("cal")) return "Cal"
  if (lower === "scan") return "Scan"

  return operation
}
