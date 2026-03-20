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
import {
  findProcedureMatches,
  hasProcedure,
  type CanonicalProcedureKey,
} from "../procedureEquivalence";

export interface RepairPipelineDocument {
  filename: string;
  mime?: string;
  text?: string;
}

export interface ClassifiedRepairDocument extends RepairPipelineDocument {
  type: RepairDocumentType;
}

export type RepairEventCategory =
  | "scan"
  | "calibration"
  | "inspection"
  | "alignment"
  | "sublet"
  | "transport"
  | "failure"
  | "verification"
  | "repair_operation";

export type RepairEventStatus =
  | "performed"
  | "failed"
  | "corrected"
  | "verified"
  | "documented";

export interface RepairEvent {
  category: RepairEventCategory;
  label: string;
  normalizedKey: string;
  status: RepairEventStatus;
  source: string;
  evidence: string;
}

export interface RepairStory {
  operationsPerformed: string[];
  failures: string[];
  corrections: string[];
  verificationSteps: string[];
  subletInvolvement: string[];
  summary: string[];
}

export interface ExtractedRepairSignals {
  preScan: boolean;
  inProcessScan: boolean;
  postScan: boolean;
  frontCameraCalibration: boolean;
  rearCameraCalibration: boolean;
  accCalibration: boolean;
  laneChangeCalibration: boolean;
  steeringAngleCalibration: boolean;
  seatBeltCheck: boolean;
  wheelAlignment: boolean;
  subletUsed: boolean;
  transportUsed: boolean;
  calibrationFailed: boolean;
  faultsCleared: boolean;
  invoiceConfirmed: boolean;
  events: RepairEvent[];
  story: RepairStory;
}

export interface RepairPipelineResult {
  documents: ClassifiedRepairDocument[];
  operations: EstimateOperation[];
  adasFindings: AdasFinding[];
  repairStory: RepairStory;
  requiredProcedures: RequiredProcedure[];
  missingProcedures: RequiredProcedure[];
  complianceIssues: ComplianceIssue[];
  supplementOpportunities: ComplianceIssue[];
  evidenceReferences: string[];
  riskScore: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
}

export interface ExtractedSignalsResult {
  documents: ClassifiedRepairDocument[];
  operations: EstimateOperation[];
  adasFindings: AdasFinding[];
  signalReferences: string[];
  confidence: "low" | "medium" | "high";
  repairSignals: ExtractedRepairSignals;
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function pushEvent(
  events: RepairEvent[],
  event: RepairEvent
) {
  const exists = events.some(
    (e) =>
      e.category === event.category &&
      e.normalizedKey === event.normalizedKey &&
      e.status === event.status &&
      e.evidence === event.evidence
  );

  if (!exists) events.push(event);
}

function buildRepairStory(events: RepairEvent[]): RepairStory {
  const byStatus = (status: RepairEventStatus) =>
    [...new Set(events.filter((e) => e.status === status).map((e) => e.label))];

  const subletInvolvement = [
    ...new Set(
      events
        .filter((e) => e.category === "sublet" || e.category === "transport")
        .map((e) => e.label)
    ),
  ];

  const operationsPerformed = byStatus("performed");
  const failures = byStatus("failed");
  const corrections = byStatus("corrected");
  const verificationSteps = [...new Set([
    ...byStatus("verified"),
    ...events
      .filter((e) => e.category === "scan" || e.category === "inspection")
      .map((e) => e.label),
  ])];

  const summary: string[] = [];

  if (operationsPerformed.length > 0) {
    summary.push(
      `Repair included ${operationsPerformed.slice(0, 5).join(", ")}${
        operationsPerformed.length > 5 ? ", and additional documented procedures" : ""
      }.`
    );
  }

  if (failures.length > 0) {
    summary.push(`A documented failure occurred: ${failures.join(", ")}.`);
  }

  if (corrections.length > 0 || subletInvolvement.length > 0) {
    summary.push(
      `Repair required correction / outside support: ${[...corrections, ...subletInvolvement]
        .slice(0, 5)
        .join(", ")}.`
    );
  }

  if (verificationSteps.length > 0) {
    summary.push(
      `Verification steps included ${verificationSteps.slice(0, 5).join(", ")}.`
    );
  }

  return {
    operationsPerformed,
    failures,
    corrections,
    verificationSteps,
    subletInvolvement,
    summary,
  };
}

function extractRepairSignalsFromText(
  documents: ClassifiedRepairDocument[]
): ExtractedRepairSignals {
  const events: RepairEvent[] = [];

  const docEntries = documents.map((document) => ({
    source: document.filename,
    raw: document.text ?? "",
  }));

  for (const doc of docEntries) {
    const lines = doc.raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);

    for (const line of lines) {
      const matches = findProcedureMatches(line);

      if (hasProcedure(matches, "pre_scan")) {
        pushEvent(events, {
          category: "scan",
          label: "Pre-repair scan",
          normalizedKey: "pre_scan",
          status: "performed",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "in_process_scan")) {
        pushEvent(events, {
          category: "scan",
          label: "In-process scan",
          normalizedKey: "in_process_scan",
          status: "performed",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "post_scan")) {
        pushEvent(events, {
          category: "scan",
          label: "Post-repair scan",
          normalizedKey: "post_scan",
          status: "performed",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "fault_clear")) {
        pushEvent(events, {
          category: "verification",
          label: "Faults cleared",
          normalizedKey: "faults_cleared",
          status: "verified",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "surround_camera_calibration")) {
        pushEvent(events, {
          category: "calibration",
          label: "All-around / surround camera calibration",
          normalizedKey: "surround_camera_calibration",
          status: "performed",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "front_camera_calibration")) {
        pushEvent(events, {
          category: "calibration",
          label: "Front camera calibration",
          normalizedKey: "front_camera_calibration",
          status: "performed",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "rear_camera_calibration")) {
        pushEvent(events, {
          category: "calibration",
          label: "Rear camera calibration",
          normalizedKey: "rear_camera_calibration",
          status: "performed",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "side_camera_calibration")) {
        pushEvent(events, {
          category: "calibration",
          label: "Side camera calibration",
          normalizedKey: "side_camera_calibration",
          status: "performed",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "front_side_radar_calibration")) {
        pushEvent(events, {
          category: "calibration",
          label: "Front side radar calibration",
          normalizedKey: "front_side_radar_calibration",
          status: "performed",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "acc_radar_calibration")) {
        pushEvent(events, {
          category: "calibration",
          label: "ACC / radar calibration",
          normalizedKey: "acc_calibration",
          status: "performed",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "steering_angle_calibration")) {
        pushEvent(events, {
          category: "calibration",
          label: "Steering angle sensor calibration",
          normalizedKey: "steering_angle_calibration",
          status: "performed",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "seat_belt_check")) {
        pushEvent(events, {
          category: "inspection",
          label: "Seat belt system check",
          normalizedKey: "seat_belt_check",
          status: "performed",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "wheel_alignment")) {
        pushEvent(events, {
          category: "alignment",
          label: "Wheel alignment",
          normalizedKey: "wheel_alignment",
          status: "performed",
          source: doc.source,
          evidence: line,
        });
      }

      if (hasProcedure(matches, "adas_report")) {
        pushEvent(events, {
          category: "verification",
          label: "ADAS report documented",
          normalizedKey: "adas_report",
          status: "verified",
          source: doc.source,
          evidence: line,
        });
      }

      const lower = line.toLowerCase();

      if (
        lower.includes("sublet") ||
        lower.includes("transport vehicle to & from sublet") ||
        lower.includes("transport vehicle to sublet") ||
        lower.includes("transport vehicle from sublet")
      ) {
        pushEvent(events, {
          category: "sublet",
          label: "Sublet calibration / diagnostic involvement",
          normalizedKey: "sublet_used",
          status: "documented",
          source: doc.source,
          evidence: line,
        });
      }

      if (includesAny(lower, ["failed calibration", "calibration attempt failed", "initial calibration attempt failed"])) {
        pushEvent(events, {
          category: "failure",
          label: "Calibration failure",
          normalizedKey: "calibration_failed",
          status: "failed",
          source: doc.source,
          evidence: line,
        });
      }

      if (includesAny(lower, ["invoice on file"])) {
        pushEvent(events, {
          category: "verification",
          label: "Invoice-backed documented operation",
          normalizedKey: "invoice_confirmed",
          status: "verified",
          source: doc.source,
          evidence: line,
        });
      }

      if (
        includesAny(lower, [
          "calibration performed",
          "rear peripheral camera calibration performed",
          "calibrate acc",
          "calibrate peripheral cameras",
        ])
      ) {
        pushEvent(events, {
          category: "verification",
          label: "Calibration completed / verified by invoice",
          normalizedKey: "calibration_completed",
          status: "verified",
          source: doc.source,
          evidence: line,
        });
      }
    }
  }

  const has = (key: string) => events.some((e) => e.normalizedKey === key);
  const story = buildRepairStory(events);

  return {
    preScan: has("pre_scan"),
    inProcessScan: has("in_process_scan"),
    postScan: has("post_scan"),

    frontCameraCalibration: has("front_camera_calibration"),
    rearCameraCalibration: has("rear_camera_calibration"),
    accCalibration: has("acc_calibration") || has("front_side_radar_calibration"),
    laneChangeCalibration: has("lane_change_calibration") || has("front_side_radar_calibration"),
    steeringAngleCalibration: has("steering_angle_calibration"),
    seatBeltCheck: has("seat_belt_check"),

    wheelAlignment: has("wheel_alignment"),
    subletUsed: has("sublet_used"),
    transportUsed: false,

    calibrationFailed: has("calibration_failed"),
    faultsCleared: has("faults_cleared"),
    invoiceConfirmed: has("invoice_confirmed") || has("adas_report"),

    events,
    story,
  };
}

export function extractSignals(
  documents: RepairPipelineDocument[]
): ExtractedSignalsResult {
  const classifiedDocuments = documents.map((document) => ({
    ...document,
    type: classifyDocument(document.filename, document.mime),
  }));

  const estimateText = classifiedDocuments
    .filter((document) => document.type === "estimate" || document.type === "document")
    .map((document) => document.text ?? "")
    .join("\n\n");

  const adasText = classifiedDocuments
    .filter((document) => document.type === "adas_report" || document.type === "oem_procedure")
    .map((document) => document.text ?? "")
    .join("\n\n");

  const operations = extractEstimateOps(estimateText);
  const adasFindings = extractAdasFindings(adasText);
  const repairSignals = extractRepairSignalsFromText(classifiedDocuments);
  const signalReferences = [
    ...operations.map((operation) => operation.rawLine),
    ...adasFindings.map((finding) => finding.finding),
    ...repairSignals.events.map((event) => `${event.label}: ${event.evidence}`),
  ];

  return {
    documents: classifiedDocuments,
    operations,
    adasFindings,
    signalReferences: [...new Set(signalReferences)].slice(0, 20),
    confidence: calculateConfidence(classifiedDocuments, operations, adasFindings),
    repairSignals,
  };
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
  const repairSignals = extractRepairSignalsFromText(classifiedDocuments);
  const repairStory = repairSignals.story;
  const evidenceReferences = buildEvidenceReferences(
    validation.missingProcedures,
    validation.complianceIssues,
    adasFindings
  );

  return {
    documents: classifiedDocuments,
    operations,
    adasFindings,
    repairStory,
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

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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
