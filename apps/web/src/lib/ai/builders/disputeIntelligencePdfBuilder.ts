import { buildCarrierReport, type CarrierReportDocument } from "./carrierPdfBuilder";
import type { ExportBuilderInput } from "./exportTemplates";

/**
 * Backward-compatible alias for legacy callers.
 *
 * The former standalone dispute export is now merged into the unified Repair
 * Intelligence Report. Keep this export so older tests, imports, or queued jobs
 * do not break, but route them to the consolidated builder.
 */
export function buildDisputeIntelligencePdf(params: ExportBuilderInput): CarrierReportDocument {
  return buildCarrierReport(params);
}
