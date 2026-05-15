export function redactExportText(input: string): string {
  return input
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, "[REDACTED_VIN]")
    .replace(/\b(?:Claim|Claim #|Claim Number)[:\s#-]*[A-Z0-9-]+\b/gi, "Claim: [REDACTED]")
    .replace(/\b(?:Workfile ID|Workfile)[:\s#-]*[A-Z0-9-]+\b/gi, "Workfile ID: [REDACTED]")
    .replace(/\b(?:License|Plate|Tag)[:\s#-]*[A-Z0-9-]+\b/gi, "License: [REDACTED]");
}
