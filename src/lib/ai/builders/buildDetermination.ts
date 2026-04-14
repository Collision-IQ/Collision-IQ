import type { ExportModel } from "./buildExportModel";

type DeterminationInput = Omit<ExportModel, "determination">;

export type DeterminationStatus =
  | "repairable"
  | "uncertain"
  | "total_loss";

export interface Determination {
  status: DeterminationStatus;
  answer: string;
  confidence: "high" | "medium" | "low";
  missingFactors: string[];
}

export function buildDetermination(model: DeterminationInput): Determination {
  const text = `${model.repairPosition} ${model.positionStatement}`.toLowerCase();

  let status: DeterminationStatus = "uncertain";

  if (text.includes("total loss") || text.includes("not repairable")) {
    status = "total_loss";
  } else if (
    text.includes("repair") &&
    !text.includes("not repairable") &&
    !text.includes("total loss")
  ) {
    status = "repairable";
  }

  const missingFactors = model.supplementItems
    .filter(
      (item) =>
        item.kind === "missing_verification" ||
        item.kind === "missing_operation"
    )
    .slice(0, 4)
    .map((item) => item.title);

  let confidence: Determination["confidence"] = "medium";

  if (missingFactors.length >= 3) {
    confidence = "low";
  } else if (missingFactors.length === 0) {
    confidence = "high";
  }

  let answer = "";

  if (status === "repairable") {
    answer =
      missingFactors.length > 0
        ? "This vehicle appears provisionally repairable, but final confirmation depends on additional structural verification and supporting documentation."
        : "This vehicle appears repairable based on the current documentation.";
  }

  if (status === "uncertain") {
    answer =
      "Repairability cannot be fully confirmed based on the current file. Additional documentation is required.";
  }

  if (status === "total_loss") {
    answer =
      "This vehicle may not be repairable based on the current information.";
  }

  return {
    status,
    answer,
    confidence,
    missingFactors,
  };
}
