export interface EstimateOperation {
  panel: string
  operation: string
  laborHours?: number
}

export interface ParsedEstimate {
  vehicle?: string
  vin?: string
  operations: EstimateOperation[]
}

export function parseEstimate(text: string): ParsedEstimate {

  const operations: EstimateOperation[] = []

  const lines = text.split("\n")

  for (const line of lines) {

    const match = line.match(/(R&I|Repl|Rpr|Blnd)\s+(.*?)(\d+\.\d+)?$/i)

    if (match) {
      operations.push({
        operation: match[1],
        panel: match[2].trim(),
        laborHours: match[3] ? Number(match[3]) : undefined
      })
    }
  }

  return {
    operations
  }
}