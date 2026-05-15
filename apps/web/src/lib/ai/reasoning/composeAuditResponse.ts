import { assertNoHedging } from "./hedging";
import { RepairAuditReport } from "../types/analysis";

export function composeAuditResponse(report: RepairAuditReport): string {
  const lines: string[] = [];
  const documentationGroups = groupEvidenceBySource(report);
  const missingFindings = report.findings.filter(
    (finding) => finding.status === "missing"
  );
  const includedFindings = report.findings.filter(
    (finding) => finding.status === "included"
  );
  const missingOperationFindings = missingFindings.filter(
    (finding) => finding.category !== "parts"
  );
  const partsExposureFindings = missingFindings.filter(
    (finding) => finding.category === "parts"
  );
  const supplementFindings = report.findings.filter(
    (finding) =>
      finding.status === "missing" &&
      (finding.category === "corrosion" ||
        finding.category === "refinish" ||
        finding.category === "qc" ||
        finding.category === "parts")
  );

  lines.push("## DOCUMENTATION BASIS");
  lines.push("");

  for (const [source, entries] of documentationGroups) {
    lines.push(source.toUpperCase());
    for (const entry of entries) {
      lines.push(`- ${entry}`);
    }
    lines.push("");
  }

  lines.push("## EXECUTIVE TECHNICAL SUMMARY");
  lines.push("");
  for (const summaryLine of report.executiveSummary) {
    lines.push(`- ${summaryLine}`);
  }
  lines.push(
    `- Critical issues identified: ${report.criticalIssues}.`
  );
  lines.push(`- Risk score: ${report.riskScore}.`);
  lines.push(`- Confidence: ${report.confidence}.`);
  lines.push(`- Evidence quality: ${report.evidenceQuality}.`);
  if (missingOperationFindings.length > 0) {
    lines.push(
      `- Missing or reduced operations: ${missingOperationFindings.map((finding) => finding.title).join(", ")}.`
    );
  }
  if (partsExposureFindings.length > 0) {
    lines.push(
      `- Parts sourcing exposure: ${partsExposureFindings.map((finding) => finding.title).join(", ")}.`
    );
  }
  if (missingOperationFindings.length === 0 && partsExposureFindings.length === 0) {
    lines.push("- No missing documented operations were identified in this review.");
  }
  lines.push("");

  lines.push("## INCLUDED COVERAGE");
  lines.push("");
  if (includedFindings.length > 0) {
    for (const finding of includedFindings) {
      lines.push(`- ${finding.title}: ${finding.conclusion}`);
    }
  } else {
    lines.push("- No included insurer operations were confirmed by the current comparison rules.");
  }
  lines.push("");

  lines.push("## DETERMINISTIC FINDINGS");
  lines.push("");

  for (const finding of report.findings) {
    lines.push(`### ${finding.title}`);
    lines.push(`Status: ${formatStatus(finding.status)}`);
    lines.push("");
    lines.push(finding.conclusion);
    lines.push("");
  }

  lines.push("## MISSING OPERATIONS");
  lines.push("");
  if (missingOperationFindings.length > 0) {
    for (const finding of missingOperationFindings) {
      lines.push(`- ${finding.title}: ${finding.conclusion}`);
    }
  } else {
    lines.push("- No missing operations were identified in the provided documents.");
  }
  lines.push("");

  lines.push("## PARTS SOURCING EXPOSURE");
  lines.push("");
  if (partsExposureFindings.length > 0) {
    for (const finding of partsExposureFindings) {
      lines.push(`- ${finding.title}: ${finding.conclusion}`);
    }
  } else {
    lines.push("- No non-OEM or recycled parts sourcing exposure was identified in the provided documents.");
  }
  lines.push("");

  lines.push("## SUPPLEMENT OPPORTUNITIES");
  lines.push("");
  if (supplementFindings.length > 0) {
    for (const finding of supplementFindings) {
      lines.push(`- ${finding.title}: ${finding.conclusion}`);
    }
  } else {
    lines.push("- No supplement opportunities are shown in the provided documents.");
  }
  lines.push("");

  lines.push("## RISK ASSESSMENT");
  lines.push("");
  lines.push(`- Risk score: ${report.riskScore}.`);
  lines.push(`- Critical issues: ${report.criticalIssues}.`);
  lines.push(`- Evidence quality: ${report.evidenceQuality}.`);
  lines.push("");

  lines.push("## BOTTOM LINE");
  lines.push("");
  if (report.criticalIssues > 0) {
    lines.push(
      `The insurance estimate is missing ${report.criticalIssues} documented repair-critical procedure(s).`
    );
  } else if (missingFindings.length > 0) {
    lines.push(
      `The insurance estimate still carries ${missingFindings.length} documented mismatch or exposure item(s) identified in this review.`
    );
  } else {
    lines.push(
      "The insurance estimate includes the documented repair-critical procedures evaluated in this review."
    );
  }

  return assertNoHedging(lines.join("\n"));
}

function groupEvidenceBySource(report: RepairAuditReport) {
  const groups = new Map<string, string[]>();

  for (const finding of report.findings) {
    for (const evidence of finding.evidence) {
      const existing = groups.get(evidence.source) ?? [];
      const entry = `${finding.title}${evidence.page ? `, page ${evidence.page}` : ""}`;
      if (!existing.includes(entry)) {
        existing.push(entry);
      }
      groups.set(evidence.source, existing);
    }
  }

  return groups;
}

function formatStatus(status: string) {
  if (status === "included") return "Included";
  if (status === "missing") return "Missing";
  return "Not shown";
}
