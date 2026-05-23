import type { ExportModel } from "@/lib/ai/builders/buildExportModel";

export type CaseContextFile = {
  id?: string;
  name: string;
  type?: string;
  url?: string;
};

export type CaseContextExport = {
  label: string;
  type?: string;
  url?: string;
};

export type CaseContextFact = {
  label: string;
  value: string;
};

export type CaseContext = {
  intent: string;
  vehicleLabel?: string;
  uploadedFiles: CaseContextFile[];
  extractedFacts: CaseContextFact[];
  transcriptSummary?: string;
  determination?: ExportModel["determination"];
  supportGaps: string[];
  exports: CaseContextExport[];
};

export function buildCaseContext(params: {
  intent?: string | null;
  exportModel: ExportModel;
  transcriptSummary?: string | null;
  uploadedFiles?: CaseContextFile[] | null;
  exports?: CaseContextExport[] | null;
}): CaseContext {
  const { exportModel } = params;

  const extractedFacts: Array<CaseContextFact | null> = [
    exportModel.vehicle?.year
      ? { label: "Year", value: String(exportModel.vehicle.year) }
      : null,
    exportModel.vehicle?.make
      ? { label: "Make", value: exportModel.vehicle.make }
      : null,
    exportModel.vehicle?.model
      ? { label: "Model", value: exportModel.vehicle.model }
      : null,
    exportModel.vehicle?.trim
      ? { label: "Trim", value: exportModel.vehicle.trim }
      : null,
    exportModel.reportFields?.vin
      ? { label: "VIN", value: exportModel.reportFields.vin }
      : null,
    typeof exportModel.reportFields?.mileage === "number"
      ? {
          label: "Mileage",
          value: exportModel.reportFields.mileage.toLocaleString("en-US"),
        }
      : null,
    exportModel.reportFields?.insurer
      ? { label: "Insurer", value: exportModel.reportFields.insurer }
      : null,
    typeof exportModel.reportFields?.estimateTotal === "number"
      ? {
          label: "Estimate Total",
          value: `$${exportModel.reportFields.estimateTotal.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`,
        }
      : null,
  ];

  return {
    intent: params.intent?.trim() || "Continue with this case",
    vehicleLabel:
      exportModel.vehicle?.label || exportModel.reportFields?.vehicleLabel,
    uploadedFiles: params.uploadedFiles ?? [],
    extractedFacts: extractedFacts.filter(Boolean) as CaseContextFact[],
    transcriptSummary: params.transcriptSummary?.trim() || undefined,
    determination: exportModel.determination,
    supportGaps: exportModel.determination?.missingFactors ?? [],
    exports: params.exports ?? [],
  };
}
