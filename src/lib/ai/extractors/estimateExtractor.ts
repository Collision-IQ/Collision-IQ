export interface EstimateLine {
  lineNo?: number;
  op: string;
  raw: string;
}

export interface ParsedEstimate {
  totalCost?: number;
  bodyHours?: number;
  paintHours?: number;
  rawText: string;
  allLines: string[];
  lines: EstimateLine[];
}

export interface EstimateOperation {
  operation: string;
  component: string;
  rawLine: string;
  laborHours?: number;
}

const PROCEDURE_PATTERNS = [
  /battery isolate|reset electrical components/i,
  /side impact sensor|impact sensor/i,
  /pre-?repair scan/i,
  /revv\s*adas\s+report/i,
  /in-?proc repair scan|in process repair scan|in-?process scan/i,
  /four[-\s]?wheel alignment/i,
  /radar calibration|camera calibration|steering angle sensor calibration/i,
  /seat weight sensor|zero point calibration/i,
  /power window initialization/i,
  /seat belt dynamic function test/i,
  /post-?repair scan/i,
  /oem documentation|procedure research|procedure support/i,
  /final road test|safety\s*&?\s*quality check/i,
  /mask jambs/i,
  /tint color/i,
  /finish sand.*polish/i,
  /cavity wax/i,
];

export function parseEstimate(text: string): ParsedEstimate {
  const lines = text.split("\n").map((line) => normalizeEstimateLineText(line).trim()).filter(Boolean);
  const out: ParsedEstimate = {
    rawText: text,
    allLines: lines,
    lines: [],
  };

  for (const line of lines) {
    const opMatch = line.match(
      /^#?\s*(\d+)?\s*(R&I|Repl|Rpr|Blnd|Subl|Algn|Proc)\s+(.*)$/i
    );

    if (opMatch) {
      out.lines.push({
        lineNo: opMatch[1] ? Number(opMatch[1]) : undefined,
        op: opMatch[2],
        raw: opMatch[3].trim(),
      });
    } else if (PROCEDURE_PATTERNS.some((pattern) => pattern.test(line))) {
      out.lines.push({
        op: "Proc",
        raw: line.replace(/^#\s*/, "").trim(),
      });
    }

    if (out.totalCost === undefined) {
      const totalMatch = line.match(/Grand Total\s+([\d,]+\.\d{2})/i);
      if (totalMatch) {
        out.totalCost = Number(totalMatch[1].replace(/,/g, ""));
      }
    }

    if (out.bodyHours === undefined) {
      const bodyMatch = line.match(/Body(?: Labor| Hrs?)?\s+([\d.]+)/i);
      if (bodyMatch) {
        out.bodyHours = Number(bodyMatch[1]);
      }
    }

    if (out.paintHours === undefined) {
      const paintMatch = line.match(/(?:Paint|Refinish)(?: Labor| Hrs?)?\s+([\d.]+)/i);
      if (paintMatch) {
        out.paintHours = Number(paintMatch[1]);
      }
    }
  }

  return out;
}

export function hasLine(parsed: ParsedEstimate, pattern: RegExp): boolean {
  return (
    parsed.lines.some((line) => pattern.test(line.raw)) ||
    parsed.allLines.some((line) => pattern.test(line))
  );
}

export function extractEstimateOps(text: string): EstimateOperation[] {
  const parsed = parseEstimate(text);

  return parsed.lines.map((line) => ({
    operation: normalizeOperation(line.op),
    component: stripTrailingLaborHours(line.raw),
    rawLine: line.lineNo ? `${line.lineNo} ${line.op} ${line.raw}` : `${line.op} ${line.raw}`,
    laborHours: extractTrailingLaborHours(line.raw),
  }));
}

export function normalizeEstimateLineText(value: string): string {
  return value
    .replace(/([A-Za-z)])\d(\d\.\d)\s*$/g, "$1 $2")
    .replace(/([A-Za-z)])(\d{1,2}\.\d)\s*$/g, "$1 $2")
    .replace(/([A-Za-z])(\d{2,}(?:\.\d{2})?)(Incl\.?|Included)\b/gi, "$1 $2 $3")
    .replace(/\s{2,}/g, " ");
}

function extractTrailingLaborHours(value: string): number | undefined {
  const normalized = normalizeEstimateLineText(value);
  const match = normalized.match(/^(.*?)(?:\s+(\d{1,2}(?:\.\d+)?))$/);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[2]);
  return Number.isFinite(hours) && hours <= 80 ? hours : undefined;
}

function stripTrailingLaborHours(value: string): string {
  const normalized = normalizeEstimateLineText(value);
  const match = normalized.match(/^(.*?)(?:\s+(\d{1,2}(?:\.\d+)?))$/);
  if (!match) return normalized.trim();
  const hours = Number(match[2]);
  return Number.isFinite(hours) && hours <= 80 ? match[1]?.trim() || normalized.trim() : normalized.trim();
}

function normalizeOperation(operation: string): string {
  const lower = operation.toLowerCase();

  if (lower === "subl") return "Subl";
  if (lower === "algn") return "Algn";
  if (lower === "proc") return "Proc";
  return operation;
}
