import {
  classifyDocument,
  type RepairDocumentType,
} from "../extractors/documentClassifier";
import {
  extractEstimateOps,
  type EstimateOperation,
} from "../extractors/estimateExtractor";
import {
  extractAdasFindings,
  type AdasFinding,
} from "../extractors/adasExtractor";
import {
  detectProcedures,
  type RequiredProcedure,
} from "../rules/procedureRules";
import {
  validateRepair,
  type ComplianceIssue,
} from "../validators/complianceValidator";

export interface RepairPipelineDocument {
  filename: string;
  mime?: string;
  text?: string;
}

export interface ClassifiedRepairDocument extends RepairPipelineDocument {
  type: RepairDocumentType;
}

export interface RepairPipelineResult {
  documents: ClassifiedRepairDocument[];
  operations: EstimateOperation[];
  adasFindings: AdasFinding[];
  requiredProcedures: RequiredProcedure[];
  missingProcedures: RequiredProcedure[];
  complianceIssues: ComplianceIssue[];
  supplementOpportunities: ComplianceIssue[];
  evidenceReferences: string[];
  riskScore: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
}

export function runRepairPipeline(
  documents: RepairPipelineDocument[]
): RepairPipelineResult {
  const classifiedDocuments = documents.map((document) => ({
    ...document,
    type: classifyDocument(document.filename, document.mime),
  }));

  const estimateText = classifiedDocuments
    .filter((document) => document.type === "estimate" || document.type === "document")
    .map((document) => document.text ?? "")
    .join("\n\n");
  const shopEstimateText =
    findDocumentText(classifiedDocuments, ["shop", "body shop", "repair facility"]) ?? estimateText;
  const insurerEstimateText =
    findDocumentText(classifiedDocuments, ["insurer", "insurance", "carrier", "sor"]) ?? null;

  const adasText = classifiedDocuments
    .filter((document) => document.type === "adas_report" || document.type === "oem_procedure")
    .map((document) => document.text ?? "")
    .join("\n\n");

  const operations = extractEstimateOps(shopEstimateText);
  const requiredProcedures = detectProcedures(operations);
  const validationText = insurerEstimateText ?? `${estimateText}\n\n${adasText}`;
  const validation = validateRepair(validationText, requiredProcedures);
  const adasFindings = extractAdasFindings(adasText);
  const evidenceReferences = buildEvidenceReferences(
    validation.missingProcedures,
    validation.complianceIssues,
    adasFindings
  );

  return {
    documents: classifiedDocuments,
    operations,
    adasFindings,
    requiredProcedures,
    missingProcedures: validation.missingProcedures,
    complianceIssues: validation.complianceIssues,
    supplementOpportunities: validation.supplementOpportunities,
    evidenceReferences,
    riskScore: calculateRiskScore(validation.complianceIssues),
    confidence: calculateConfidence(classifiedDocuments, operations, adasFindings),
  };
}

function findDocumentText(
  documents: ClassifiedRepairDocument[],
  keywords: string[]
): string | undefined {
  return documents.find((document) => {
    const haystack = `${document.filename} ${document.mime ?? ""}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  })?.text;
}

function buildEvidenceReferences(
  missingProcedures: RequiredProcedure[],
  complianceIssues: ComplianceIssue[],
  adasFindings: AdasFinding[]
): string[] {
  const references = [
    ...missingProcedures.map(
      (procedure) =>
        `${procedure.procedure}: ${procedure.evidenceBasis} | Triggered by ${procedure.matchedOperation}`
    ),
    ...complianceIssues.map(
      (issue) => `${issue.issue}: ${issue.evidenceBasis} | ${issue.reference}`
    ),
    ...adasFindings.map(
      (finding) => `${finding.finding}: ${finding.evidence} | ADAS report reference`
    ),
  ];

  return [...new Set(references)].slice(0, 8);
}

function calculateRiskScore(
  issues: ComplianceIssue[]
): RepairPipelineResult["riskScore"] {
  if (issues.some((issue) => issue.severity === "high")) return "high";
  if (issues.some((issue) => issue.severity === "medium")) return "medium";
  return "low";
}

function calculateConfidence(
  documents: ClassifiedRepairDocument[],
  operations: EstimateOperation[],
  adasFindings: AdasFinding[]
): RepairPipelineResult["confidence"] {
  if (
    documents.length >= 2 &&
    operations.length >= 2 &&
    adasFindings.length > 0
  ) {
    return "high";
  }

  if (operations.length > 0 || adasFindings.length > 0) {
    return "medium";
  }

  return "low";
}
