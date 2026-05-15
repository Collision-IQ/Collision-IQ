type ProcedureInferenceDoc = {
  status?: string;
  title?: string | null;
  sourceType?: string | null;
  [key: string]: unknown;
};

type ProcedureSupportClassification =
  | "fully_documented_with_evidence"
  | "supported_by_reference"
  | "none";

export function inferProcedureSupport(
  linkedDocs: ProcedureInferenceDoc[],
  damageContext: unknown
) {
  const contextText = String(damageContext ?? "").toLowerCase();

  return linkedDocs.map((doc) => {
    const normalizedStatus = (doc.status || "").toLowerCase();

    if (normalizedStatus === "ok") {
      return {
        ...doc,
        supportClassification:
          "fully_documented_with_evidence" as ProcedureSupportClassification,
        inferredSupport: [] as string[],
      };
    }

    if (
      normalizedStatus === "referenced_not_retrieved" ||
      normalizedStatus === "skipped" ||
      normalizedStatus === "blocked" ||
      normalizedStatus === "failed"
    ) {
      const inferredSupport = [
        "calibration procedures",
        "scan requirements",
        "alignment / verification",
        "repair sequencing",
      ];

      if (contextText.includes("adas") || contextText.includes("sensor")) {
        inferredSupport.unshift("adas calibration dependencies");
      }

      return {
        ...doc,
        supportClassification: "supported_by_reference" as ProcedureSupportClassification,
        inferredSupport,
      };
    }

    return {
      ...doc,
      supportClassification: "none" as ProcedureSupportClassification,
      inferredSupport: [] as string[],
    };
  });
}
