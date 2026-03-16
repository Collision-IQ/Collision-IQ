import { ComparisonFacts } from "../extractors/comparisonExtractor";
import { OemRequirements } from "../extractors/oemProcedureExtractor";
import { auditRules } from "../rules/auditRules";
import { RepairAuditReport, type AuditRuleContext } from "../types/analysis";
import { evaluateAuditRules } from "./auditRuleEngine";

export function buildAuditFindings(
  facts: ComparisonFacts,
  oem: OemRequirements
): RepairAuditReport {
  const context: AuditRuleContext = {
    facts: {
      ...Object.fromEntries(
        Object.entries(facts.shop).map(([key, value]) => [`shop.${key}`, value])
      ),
      ...Object.fromEntries(
        Object.entries(facts.insurer).map(([key, value]) => [`insurer.${key}`, value])
      ),
      collisionDamageRequiresScan: oem.collisionDamageRequiresScan,
      frontBumperRequiresAccCalibration: oem.frontBumperRequiresAccCalibration,
      frontBumperRequiresKafasCalibration: oem.frontBumperRequiresKafasCalibration,
    },
  };

  const findings = evaluateAuditRules(auditRules, context);
  const missingFindings = findings.filter((finding) => finding.status === "missing");
  const includedFindings = findings.filter((finding) => finding.status === "included");

  const criticalIssues = missingFindings.filter(
    (finding) =>
      finding.severity === "high" &&
      (finding.category === "scan" ||
        finding.category === "calibration" ||
        finding.category === "qc")
  ).length;

  const procedureCompletenessScore = scoreFindings(
    missingFindings.filter(
      (finding) =>
        finding.category === "scan" ||
        finding.category === "calibration" ||
        finding.category === "corrosion"
    )
  );
  const qualityControlScore = scoreFindings(
    missingFindings.filter(
      (finding) => finding.category === "qc" || finding.category === "refinish"
    )
  );
  const partsExposureScore = scoreFindings(
    missingFindings.filter((finding) => finding.category === "parts")
  );
  const totalScore =
    procedureCompletenessScore + qualityControlScore + partsExposureScore;

  return {
    executiveSummary: buildExecutiveSummary({
      includedFindings,
      missingFindings,
      procedureCompletenessScore,
      qualityControlScore,
      partsExposureScore,
    }),
    findings,
    criticalIssues,
    riskScore: totalScore >= 10 ? "high" : totalScore >= 5 ? "moderate" : "low",
    confidence: "high",
    evidenceQuality: "strong",
  };
}

function buildExecutiveSummary(params: {
  includedFindings: RepairAuditReport["findings"];
  missingFindings: RepairAuditReport["findings"];
  procedureCompletenessScore: number;
  qualityControlScore: number;
  partsExposureScore: number;
}): string[] {
  const includedCoverage = summarizeTitles(
    params.includedFindings.filter(
      (finding) =>
        finding.category === "scan" ||
        finding.category === "calibration" ||
        finding.category === "corrosion" ||
        finding.title.includes("Alignment") ||
        finding.title.includes("Transport")
    )
  );
  const remainingGaps = summarizeTitles(
    params.missingFindings.filter((finding) => finding.category !== "parts")
  );
  const partsExposure = summarizeTitles(
    params.missingFindings.filter((finding) => finding.category === "parts")
  );

  return [
    includedCoverage
      ? `I compared the shop blueprint to the insurer estimate. The insurer already includes ${includedCoverage}.`
      : "I compared the shop blueprint to the insurer estimate using extracted operations from both documents.",
    remainingGaps
      ? `The insurer estimate still does not fully mirror the shop blueprint for ${remainingGaps}.`
      : "No remaining procedure or refinish mismatches were detected from the current comparison rules.",
    partsExposure
      ? `Parts sourcing exposure remains because the insurer estimate includes ${partsExposure}.`
      : "No non-OEM or recycled parts sourcing exposure was detected from the current extracted rules.",
    `Procedure completeness score: ${params.procedureCompletenessScore}. Quality-control completeness score: ${params.qualityControlScore}. Parts sourcing exposure score: ${params.partsExposureScore}.`,
  ];
}

function scoreFindings(findings: RepairAuditReport["findings"]): number {
  return findings.reduce((score, finding) => {
    if (finding.severity === "high") return score + 3;
    if (finding.severity === "medium") return score + 2;
    return score + 1;
  }, 0);
}

function summarizeTitles(findings: RepairAuditReport["findings"]): string {
  const titles = [...new Set(findings.map((finding) => finding.title))];

  if (titles.length === 0) return "";
  if (titles.length <= 3) return titles.join(", ");
  return `${titles.slice(0, 3).join(", ")}, and ${titles.length - 3} more item(s)`;
}
