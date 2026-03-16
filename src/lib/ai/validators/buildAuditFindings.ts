import {
  RepairAuditReport,
  type AuditRuleContext,
} from "../types/analysis";
import { ComparisonFacts } from "../extractors/comparisonExtractor";
import { OemRequirements } from "../extractors/oemProcedureExtractor";
import {
  evaluateAuditRules,
  type AuditRuleDefinition,
} from "./auditRuleEngine";

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

  const findings = evaluateAuditRules(getAuditRules(), context);

  const criticalIssues = findings.filter(
    (finding) => finding.severity === "high" && finding.status === "missing"
  ).length;
  const weightedScore =
    findings.filter((finding) => finding.severity === "high" && finding.status === "missing").length * 3 +
    findings.filter((finding) => finding.severity === "medium" && finding.status === "missing").length * 2 +
    findings.filter((finding) => finding.severity === "low" && finding.status === "missing").length;

  const riskScore =
    weightedScore >= 6 ? "high" : weightedScore >= 3 ? "moderate" : "low";

  return {
    executiveSummary: [
      "This comparison is based on extracted estimate operations and OEM procedure triggers.",
      "Conclusions are limited to what is documented in the uploaded files.",
    ],
    findings,
    criticalIssues,
    riskScore,
    confidence: "high",
    evidenceQuality: "strong",
  };
}

function getAuditRules(): AuditRuleDefinition[] {
  return [
    {
      id: "scan-prepost",
      category: "scan",
      trigger: (context) =>
        context.facts.collisionDamageRequiresScan === true &&
        (context.facts["shop.preScan"] === true || context.facts["shop.postScan"] === true),
      evaluate: (context) =>
        context.facts["insurer.preScan"] && context.facts["insurer.postScan"]
          ? "included"
          : "missing",
      severity: "high",
      severityByStatus: {
        included: "low",
      },
      title: "Pre/Post Diagnostic Scan",
      rationale:
        "BMW procedure requires pre and post scan when the vehicle has sustained collision damage.",
      evidence: [{ source: "BMW ADAS procedure", page: 1 }],
      conclusion: {
        included: "Insurance estimate includes pre-scan and post-scan.",
        missing: "Insurance estimate is missing one or more required diagnostic scans.",
        not_shown: "Pre/post diagnostic scan is not established from the provided documents.",
      },
    },
    {
      id: "cal-acc",
      category: "calibration",
      trigger: (context) =>
        context.facts.frontBumperRequiresAccCalibration === true &&
        context.facts["shop.accCalibration"] === true,
      evaluate: (context) =>
        context.facts["insurer.accCalibration"] ? "included" : "missing",
      severity: "high",
      severityByStatus: {
        included: "low",
      },
      title: "ACC Dynamic Calibration",
      rationale:
        "BMW procedure ties ACC dynamic calibration to front bumper removal/installation.",
      evidence: [{ source: "BMW ADAS procedure", page: 2 }],
      conclusion: {
        included: "Insurance estimate includes ACC dynamic calibration.",
        missing: "Insurance estimate is missing ACC dynamic calibration.",
        not_shown: "ACC dynamic calibration is not established from the provided documents.",
      },
    },
    {
      id: "cal-kafas",
      category: "calibration",
      trigger: (context) =>
        context.facts.frontBumperRequiresKafasCalibration === true &&
        context.facts["shop.kafasCalibration"] === true,
      evaluate: (context) =>
        context.facts["insurer.kafasCalibration"] ? "included" : "missing",
      severity: "high",
      severityByStatus: {
        included: "low",
      },
      title: "KAFAS Camera Dynamic Calibration",
      rationale:
        "BMW procedure ties KAFAS camera dynamic calibration to front bumper removal/installation.",
      evidence: [{ source: "BMW ADAS procedure", page: 3 }],
      conclusion: {
        included: "Insurance estimate includes KAFAS camera dynamic calibration.",
        missing: "Insurance estimate is missing KAFAS camera dynamic calibration.",
        not_shown:
          "KAFAS camera dynamic calibration is not established from the provided documents.",
      },
    },
    {
      id: "corrosion-cavitywax",
      category: "corrosion",
      trigger: (context) => context.facts["shop.cavityWax"] === true,
      evaluate: (context) =>
        context.facts["insurer.cavityWax"] ? "included" : "missing",
      severity: "medium",
      severityByStatus: {
        included: "low",
      },
      title: "Corrosion Protection Materials",
      rationale:
        "The shop estimate includes cavity wax as a manual line item tied to the repair plan.",
      evidence: [{ source: "Shop estimate", page: 3 }],
      conclusion: {
        included: "Insurance estimate includes corrosion protection material.",
        missing:
          "Insurance estimate does not show cavity wax / corrosion protection material.",
        not_shown:
          "Corrosion protection material is not established from the provided documents.",
      },
    },
    {
      id: "supplement-calibration-transport",
      category: "qc",
      trigger: (context) => context.facts["shop.calibrationTransport"] === true,
      evaluate: (context) =>
        context.facts["insurer.calibrationTransport"] ? "included" : "missing",
      severity: "medium",
      severityByStatus: {
        included: "low",
      },
      title: "Calibration Transport",
      rationale:
        "The shop estimate shows transport to or from sublet calibration services.",
      evidence: [{ source: "Shop estimate", page: 3 }],
      conclusion: {
        included: "Insurance estimate includes calibration transport.",
        missing: "Insurance estimate does not show calibration transport.",
        not_shown:
          "Calibration transport is not established from the provided documents.",
      },
    },
    {
      id: "refinish-finish-sand-polish",
      category: "refinish",
      trigger: (context) => context.facts["shop.finishSandPolish"] === true,
      evaluate: (context) =>
        context.facts["insurer.finishSandPolish"] ? "included" : "missing",
      severity: "medium",
      severityByStatus: {
        included: "low",
      },
      title: "Finish Sand and Polish",
      rationale:
        "The shop estimate includes finish sand and polish as a refinishing operation.",
      evidence: [{ source: "Shop estimate", page: 3 }],
      conclusion: {
        included: "Insurance estimate includes finish sand and polish.",
        missing: "Insurance estimate does not show finish sand and polish.",
        not_shown:
          "Finish sand and polish is not established from the provided documents.",
      },
    },
  ];
}
