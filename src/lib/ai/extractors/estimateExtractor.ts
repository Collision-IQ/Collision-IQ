export interface EstimateOperation {
  operation: string;
  component: string;
  rawLine: string;
  laborHours?: number;
}

export function extractEstimateOps(text: string): EstimateOperation[] {
  const operations: EstimateOperation[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(
      /\b(R&I|R\s*&\s*I|Remove\s*&\s*Install|Remove\/Install|Repl|Replace|Rpr|Repair|Blnd|Blend|Cal(?:ibration)?|Scan)\b\s+(.+?)(?:\s+(\d+(?:\.\d+)?))?$/i
    );

    if (!match) continue;

    operations.push({
      operation: normalizeOperation(match[1]),
      component: match[2].trim(),
      rawLine: trimmed,
      laborHours: match[3] ? Number(match[3]) : undefined,
    });
  }

  return operations;
}

function normalizeOperation(operation: string): string {
  const lower = operation.toLowerCase();

  if (
    lower === "r&i" ||
    lower === "r & i" ||
    lower === "remove & install" ||
    lower === "remove/install"
  ) {
    return "R&I";
  }

  if (lower === "replace") return "Repl";
  if (lower === "repair") return "Rpr";
  if (lower === "blend") return "Blnd";
  if (lower.startsWith("cal")) return "Cal";
  if (lower === "scan") return "Scan";

  return operation;
}
