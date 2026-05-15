/**
 * CaseRecord — shared contract all agents write into.
 *
 * Agents are expected to merge their results into a CaseRecord using
 * `mergeCaseRecord`. Every field is optional except the core identifiers so
 * partial agents can contribute without needing to populate the full document.
 *
 * Parse/validate at ingress (agent output, API boundary) with `CaseRecordSchema.parse()`
 * or `CaseRecordSchema.safeParse()`.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const SeveritySchema = z.enum(["low", "medium", "high"]);

export const FindingTypeSchema = z.enum([
  "adas_calibration_gap",
  "scan_missing",
  "supplement_opportunity",
  "procedure_missing",
  "parts_discrepancy",
  "documentation_gap",
  "labor_discrepancy",
  "safety_concern",
  "oem_requirement_unmet",
]);

/**
 * How firmly an agent's finding is anchored to evidence.
 *
 * - `documented`  — evidence is present and directly confirms the finding
 * - `referenced`  — a claim references evidence that has NOT been produced
 * - `inferred`    — derived from absence or indirect signals (e.g. no post-scan doc found)
 * - `unverified`  — agent flagged the issue but no evidence is attached yet
 */
export const EvidenceModeSchema = z.enum([
  "documented",
  "referenced",
  "inferred",
  "unverified",
]);

export const CaseEvidenceSourceTypeSchema = z.enum([
  "shop_estimate",
  "carrier_estimate",
  "supplement",
  "photo",
  "invoice",
  "sublet_document",
  "procedure_link",
  "scan_report",
  "calibration_report",
  "adas_report",
  "oem_documentation",
  "manual_note",
  "other_supporting_document",
]);

export const CaseEvidenceIngestionStateSchema = z.enum([
  "uploaded",
  "ingested",
  "referenced_not_produced",
  "access_limited",
  "skipped",
  "failed",
]);

export const ReviewStatusSchema = z.enum([
  "needs_human_review",
  "agent_complete",
  "human_reviewed",
  "escalated",
  "closed",
]);

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const CaseAttachmentSchema = z.object({
  /** Stable ID — matches evidenceRegistry IDs in the rest of the system */
  id: z.string(),
  filename: z.string(),
  sourceType: CaseEvidenceSourceTypeSchema,
  ingestionState: CaseEvidenceIngestionStateSchema,
  mimeType: z.string().optional(),
  extractedText: z.string().optional(),
  extractedSummary: z.string().optional(),
  url: z.string().optional(),
  uploadedAt: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Extracted Entities
// ---------------------------------------------------------------------------

export const VehicleEntitySchema = z.object({
  year: z.number().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  vin: z.string().optional(),
  trim: z.string().optional(),
  manufacturer: z.string().optional(),
  bodyStyle: z.string().optional(),
  series: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: z
    .enum(["vin_decoded", "attachment", "user", "inferred", "session", "unknown"])
    .optional(),
});

export const EstimateLineSchema = z.object({
  op: z.string(),
  component: z.string(),
  laborHours: z.number().optional(),
  amount: z.number().optional(),
  raw: z.string(),
});

export const EstimateEntitySchema = z.object({
  id: z.string(),
  type: z.enum(["shop", "carrier", "supplement"]),
  attachmentId: z.string().optional(),
  total: z.number().optional(),
  laborHours: z.number().optional(),
  insurer: z.string().optional(),
  rawText: z.string().optional(),
  lines: z.array(EstimateLineSchema).optional(),
});

export const PartEntitySchema = z.object({
  description: z.string(),
  partNumber: z.string().optional(),
  isOem: z.boolean().optional(),
  amount: z.number().optional(),
  /** ID of the estimate or attachment this part came from */
  sourceId: z.string().optional(),
});

export const OperationEntitySchema = z.object({
  id: z.string(),
  operation: z.string(),
  component: z.string(),
  laborHours: z.number().optional(),
  amount: z.number().optional(),
  /** ID of the estimate or attachment this operation came from */
  sourceId: z.string(),
});

export const DiagnosticEntitySchema = z.object({
  id: z.string(),
  type: z.enum(["pre_scan", "post_scan", "calibration_report", "adas_report"]),
  provider: z.string().optional(),
  dtcs: z.array(z.string()).optional(),
  outcome: z.string().optional(),
  attachmentId: z.string().optional(),
});

export const CalibrationEntitySchema = z.object({
  id: z.string(),
  /** Human-readable system name, e.g. "front radar", "surround camera" */
  system: z.string(),
  required: z.boolean(),
  documented: z.boolean(),
  attachmentId: z.string().optional(),
  notes: z.string().optional(),
});

export const ExtractedEntitiesSchema = z.object({
  vehicle: VehicleEntitySchema,
  estimates: z.array(EstimateEntitySchema),
  parts: z.array(PartEntitySchema),
  operations: z.array(OperationEntitySchema),
  diagnostics: z.array(DiagnosticEntitySchema),
  calibrations: z.array(CalibrationEntitySchema),
});

// ---------------------------------------------------------------------------
// Findings — the core output every agent writes
// ---------------------------------------------------------------------------

export const CaseFindingSchema = z.object({
  id: z.string(),
  type: FindingTypeSchema,
  severity: SeveritySchema,
  /**
   * Agent-assigned confidence in [0, 1].
   * 0 = complete guess, 1 = directly sourced from documentation.
   */
  confidence: z.number().min(0).max(1),
  evidence_mode: EvidenceModeSchema,
  /** IDs from `attachments[]` that support or contradict this finding */
  source_attachments: z.array(z.string()),
  /** Human-readable chain of reasoning — required, not optional */
  reasoning: z.string(),
  title: z.string().optional(),
  recommendation: z.string().optional(),
  /** Name/key of the agent that wrote this finding, e.g. "adas_agent" */
  agent: z.string().optional(),
  writtenAt: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Verification Gaps — things that need human or follow-up resolution
// ---------------------------------------------------------------------------

export const VerificationGapSchema = z.object({
  id: z.string(),
  description: z.string(),
  relatedFindingIds: z.array(z.string()),
  requiredDocumentType: CaseEvidenceSourceTypeSchema.optional(),
  urgency: SeveritySchema,
});

// ---------------------------------------------------------------------------
// Report Inputs — structured data for downstream report generators
// ---------------------------------------------------------------------------

export const ReportInputsSchema = z.object({
  customer: z.object({
    name: z.string().optional(),
    claimNumber: z.string().optional(),
    policyNumber: z.string().optional(),
    contactInfo: z.string().optional(),
  }),
  dispute: z.object({
    insurer: z.string().optional(),
    adjusterName: z.string().optional(),
    deniedItems: z.array(z.string()),
    disputeBasis: z.string().optional(),
  }),
  repair_intelligence: z.object({
    shopName: z.string().optional(),
    technicianNotes: z.string().optional(),
    repairStrategy: z.string().optional(),
  }),
});

// ---------------------------------------------------------------------------
// CaseRecord — the top-level shared contract
// ---------------------------------------------------------------------------

export const CaseRecordSchema = z.object({
  schema_version: z.literal("1.0"),
  case_id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),

  attachments: z.array(CaseAttachmentSchema),

  extracted_entities: ExtractedEntitiesSchema,

  findings: z.array(CaseFindingSchema),

  verification_gaps: z.array(VerificationGapSchema),

  report_inputs: ReportInputsSchema,

  review_status: ReviewStatusSchema,
});

// ---------------------------------------------------------------------------
// Derived TypeScript types
// ---------------------------------------------------------------------------

export type SeverityLevel = z.infer<typeof SeveritySchema>;
export type FindingType = z.infer<typeof FindingTypeSchema>;
export type EvidenceMode = z.infer<typeof EvidenceModeSchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export type CaseAttachment = z.infer<typeof CaseAttachmentSchema>;
export type VehicleEntity = z.infer<typeof VehicleEntitySchema>;
export type EstimateEntity = z.infer<typeof EstimateEntitySchema>;
export type EstimateLine = z.infer<typeof EstimateLineSchema>;
export type PartEntity = z.infer<typeof PartEntitySchema>;
export type OperationEntity = z.infer<typeof OperationEntitySchema>;
export type DiagnosticEntity = z.infer<typeof DiagnosticEntitySchema>;
export type CalibrationEntity = z.infer<typeof CalibrationEntitySchema>;
export type ExtractedEntities = z.infer<typeof ExtractedEntitiesSchema>;
export type CaseFinding = z.infer<typeof CaseFindingSchema>;
export type VerificationGap = z.infer<typeof VerificationGapSchema>;
export type ReportInputs = z.infer<typeof ReportInputsSchema>;
export type CaseRecord = z.infer<typeof CaseRecordSchema>;

// ---------------------------------------------------------------------------
// Factory — creates a blank CaseRecord
// ---------------------------------------------------------------------------

export function createEmptyCaseRecord(caseId: string): CaseRecord {
  const now = new Date().toISOString();
  return {
    schema_version: "1.0",
    case_id: caseId,
    created_at: now,
    updated_at: now,
    attachments: [],
    extracted_entities: {
      vehicle: {},
      estimates: [],
      parts: [],
      operations: [],
      diagnostics: [],
      calibrations: [],
    },
    findings: [],
    verification_gaps: [],
    report_inputs: {
      customer: {},
      dispute: { deniedItems: [] },
      repair_intelligence: {},
    },
    review_status: "needs_human_review",
  };
}

// ---------------------------------------------------------------------------
// Merge utility — agents call this to write their slice into the record
// ---------------------------------------------------------------------------

/**
 * Shallow-merges an agent's partial output into an existing CaseRecord.
 *
 * Arrays (findings, attachments, etc.) are appended — never replaced — so
 * multiple agents can run in any order without clobbering each other.
 *
 * `extracted_entities.vehicle` is merged field-by-field; existing defined
 * values are only overwritten when the incoming value is also defined.
 *
 * Always call `CaseRecordSchema.parse()` on the final record before persisting.
 */
export function mergeCaseRecord(
  base: CaseRecord,
  patch: Partial<Omit<CaseRecord, "schema_version" | "case_id" | "created_at">> & {
    extracted_entities?: Partial<ExtractedEntities>;
  },
): CaseRecord {
  const now = new Date().toISOString();

  const mergedEntities: ExtractedEntities = {
    vehicle: {
      ...base.extracted_entities.vehicle,
      ...(patch.extracted_entities?.vehicle ?? {}),
    },
    estimates: [
      ...base.extracted_entities.estimates,
      ...(patch.extracted_entities?.estimates ?? []),
    ],
    parts: [
      ...base.extracted_entities.parts,
      ...(patch.extracted_entities?.parts ?? []),
    ],
    operations: [
      ...base.extracted_entities.operations,
      ...(patch.extracted_entities?.operations ?? []),
    ],
    diagnostics: [
      ...base.extracted_entities.diagnostics,
      ...(patch.extracted_entities?.diagnostics ?? []),
    ],
    calibrations: [
      ...base.extracted_entities.calibrations,
      ...(patch.extracted_entities?.calibrations ?? []),
    ],
  };

  return {
    ...base,
    updated_at: now,
    attachments: [...base.attachments, ...(patch.attachments ?? [])],
    extracted_entities: mergedEntities,
    findings: [...base.findings, ...(patch.findings ?? [])],
    verification_gaps: [...base.verification_gaps, ...(patch.verification_gaps ?? [])],
    report_inputs: patch.report_inputs
      ? {
          customer: { ...base.report_inputs.customer, ...patch.report_inputs.customer },
          dispute: {
            ...base.report_inputs.dispute,
            ...patch.report_inputs.dispute,
            deniedItems: [
              ...base.report_inputs.dispute.deniedItems,
              ...(patch.report_inputs.dispute?.deniedItems ?? []),
            ],
          },
          repair_intelligence: {
            ...base.report_inputs.repair_intelligence,
            ...patch.report_inputs.repair_intelligence,
          },
        }
      : base.report_inputs,
    review_status: patch.review_status ?? base.review_status,
  };
}
