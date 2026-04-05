import type { AnalysisResult, RepairIntelligenceReport, VehicleIdentity } from "./types/analysis";

export type StructuralConcept =
  | "structural_measurement_verification"
  | "structural_setup_required"
  | "pull_or_realignment_required"
  | "structural_repair_or_sectioning_required"
  | "support_replacement_scope";

export type StructuralApplicability = {
  materialProfile: "standard" | "aluminum_sensitive";
  structuralMeasurementVerification: boolean;
  structuralSetupRequired: boolean;
  pullOrRealignmentRequired: boolean;
  structuralRepairOrSectioningRequired: boolean;
  supportReplacementScope: boolean;
  reasons: Partial<Record<StructuralConcept, string[]>>;
};

type StructuralSource = {
  vehicle?: VehicleIdentity | null;
  rawText?: string | null;
  evidenceTexts?: string[];
  requiredProcedures?: string[];
  presentProcedures?: string[];
  missingProcedures?: string[];
  issueTexts?: string[];
};

export function deriveStructuralApplicability(
  source: StructuralSource
): StructuralApplicability {
  const rawText = [
    source.rawText,
    ...(source.evidenceTexts ?? []),
    ...(source.issueTexts ?? []),
    ...(source.requiredProcedures ?? []),
    ...(source.presentProcedures ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const materialProfile = detectMaterialProfile(source.vehicle, rawText);
  const explicitMeasurement = hasAffirmativeSignal(rawText, [
    "3d measure",
    "three dimensional measure",
    "three-dimensional measure",
    "measure",
    "measuring",
    "dimension",
    "datum",
    "structural measurement",
    "tram",
    "fixture",
  ]);
  const explicitSetup = hasAffirmativeSignal(rawText, [
    "frame setup",
    "bench setup",
    "setup and measure",
    "fixture setup",
  ]);
  const explicitPull = hasAffirmativeSignal(rawText, [
    " pull ",
    " pulling",
    "frame pull",
    "realignment",
    "straighten",
  ]);
  const explicitRepairOrSection = hasAffirmativeSignal(rawText, [
    "sectioning",
    "section repair",
    "structural repair",
    "rail repair",
    "pillar repair",
    "apron repair",
    "cut and weld",
    "structural section",
  ]);
  const supportReplacementScope = hasAny(rawText, [
    "tie bar",
    "lock support",
    "core support",
    "upper rail",
  ]);
  const strongVisualDistortion = hasAny(rawText, [
    "buckled",
    "kinked",
    "distorted",
    "twisted",
    "swayed",
    "moved rearward",
    "crushed to the rail",
    "rail damage",
  ]);
  const oemMeasurementSupport = hasAnyList(source.requiredProcedures, [
    "measurement",
    "measure",
    "dimensional verification",
    "structural measurement",
  ]);
  const oemSetupSupport = hasAnyList(source.requiredProcedures, [
    "frame setup",
    "bench setup",
    "setup and measure",
  ]);
  const oemPullSupport = hasAnyList(source.requiredProcedures, [
    "pull",
    "realignment",
    "straighten",
  ]);
  const oemRepairSupport = hasAnyList(source.requiredProcedures, [
    "sectioning",
    "structural repair",
    "rail repair",
    "apron repair",
  ]);

  const structuralMeasurementVerification =
    explicitMeasurement ||
    oemMeasurementSupport ||
    supportReplacementScope ||
    explicitPull ||
    explicitSetup ||
    strongVisualDistortion;
  const structuralSetupRequired =
    explicitSetup ||
    oemSetupSupport ||
    strongVisualDistortion;
  const pullOrRealignmentRequired =
    explicitPull ||
    oemPullSupport ||
    strongVisualDistortion;
  const structuralRepairOrSectioningRequired =
    explicitRepairOrSection ||
    oemRepairSupport;

  const guardedSetup =
    materialProfile === "aluminum_sensitive" && !explicitSetup && !oemSetupSupport && !strongVisualDistortion
      ? false
      : structuralSetupRequired;
  const guardedPull =
    materialProfile === "aluminum_sensitive" && !explicitPull && !oemPullSupport && !strongVisualDistortion
      ? false
      : pullOrRealignmentRequired;
  const guardedRepair =
    materialProfile === "aluminum_sensitive" && !explicitRepairOrSection && !oemRepairSupport
      ? false
      : structuralRepairOrSectioningRequired;

  return {
    materialProfile,
    structuralMeasurementVerification,
    structuralSetupRequired: guardedSetup,
    pullOrRealignmentRequired: guardedPull,
    structuralRepairOrSectioningRequired: guardedRepair,
    supportReplacementScope,
    reasons: {
      structural_measurement_verification: collectReasons(
        [
          explicitMeasurement && "estimate text supports dimensional or structural measuring",
          oemMeasurementSupport && "required procedure support references dimensional verification",
          supportReplacementScope && "support replacement scope warrants geometry confirmation",
          strongVisualDistortion && "visual evidence suggests distortion requiring measurement confirmation",
        ]
      ),
      structural_setup_required: collectReasons(
        [
          explicitSetup && "estimate text supports structural setup or benching",
          oemSetupSupport && "required procedures support setup/benching",
          strongVisualDistortion && "visual evidence suggests setup before verification",
        ]
      ),
      pull_or_realignment_required: collectReasons(
        [
          explicitPull && "estimate text explicitly supports pull or realignment",
          oemPullSupport && "required procedures support pull or realignment",
          strongVisualDistortion && "visual evidence suggests correction of distortion",
        ]
      ),
      structural_repair_or_sectioning_required: collectReasons(
        [
          explicitRepairOrSection && "estimate text explicitly supports structural repair or sectioning",
          oemRepairSupport && "required procedures support structural repair or sectioning",
        ]
      ),
      support_replacement_scope: collectReasons(
        [
          supportReplacementScope && "support-area replacement or reconciliation scope is present",
        ]
      ),
    },
  };
}

export function deriveStructuralApplicabilityFromResult(
  result: AnalysisResult | RepairIntelligenceReport
): StructuralApplicability {
  if ("findings" in result) {
    return deriveStructuralApplicability({
      vehicle: result.vehicle,
      rawText: result.rawEstimateText,
      evidenceTexts: result.evidence.map((entry) => `${entry.source} ${entry.quote ?? ""}`),
      requiredProcedures: result.findings
        .filter((finding) => finding.status !== "present")
        .map((finding) => finding.title),
      presentProcedures: result.findings
        .filter((finding) => finding.status === "present")
        .map((finding) => finding.title),
      missingProcedures: result.supplements.map((finding) => finding.title),
      issueTexts: result.findings.map((finding) => `${finding.title} ${finding.detail}`),
    });
  }

  return deriveStructuralApplicability({
    vehicle: result.vehicle,
    rawText: result.sourceEstimateText,
    evidenceTexts: result.evidence.map((entry) => `${entry.title ?? ""} ${entry.snippet ?? ""}`),
    requiredProcedures: result.requiredProcedures.map((entry) => entry.procedure),
    presentProcedures: result.presentProcedures,
    missingProcedures: result.missingProcedures,
    issueTexts: result.issues.map((issue) => `${issue.title} ${issue.impact || issue.finding}`),
  });
}

export function isStructuralSupplementSupported(
  title: string,
  applicability: StructuralApplicability
): boolean {
  const lower = title.toLowerCase();

  if (lower.includes("structural measurement")) {
    return applicability.structuralMeasurementVerification;
  }

  if (
    lower.includes("setup and pull") ||
    lower.includes("frame setup") ||
    lower.includes("pull verification")
  ) {
    return applicability.structuralSetupRequired || applicability.pullOrRealignmentRequired;
  }

  if (
    lower.includes("sectioning") ||
    lower.includes("structural repair")
  ) {
    return applicability.structuralRepairOrSectioningRequired;
  }

  if (
    lower.includes("front structure scope") ||
    lower.includes("tie bar") ||
    lower.includes("lock support") ||
    lower.includes("core support") ||
    lower.includes("upper rail")
  ) {
    return applicability.supportReplacementScope;
  }

  return true;
}

export function filterStructuralTitles<T extends { title: string }>(
  items: T[],
  applicability: StructuralApplicability
): T[] {
  return items.filter((item) => isStructuralSupplementSupported(item.title, applicability));
}

function detectMaterialProfile(
  vehicle: VehicleIdentity | null | undefined,
  rawText: string
): StructuralApplicability["materialProfile"] {
  const make = (vehicle?.make || "").toLowerCase();
  const aluminumSensitiveMake =
    ["tesla", "rivian", "lucid", "audi", "jaguar", "land rover"].includes(make);
  const aluminumText = hasAny(rawText, [
    "aluminum",
    "aluminium",
    "cast aluminum",
    "cast-aluminum",
    "aluminum cast",
  ]);

  return aluminumSensitiveMake || aluminumText ? "aluminum_sensitive" : "standard";
}

function hasAny(text: string, tokens: string[]) {
  return tokens.some((token) => text.includes(token));
}

function hasAffirmativeSignal(text: string, tokens: string[]) {
  return tokens.some((token) => {
    let startIndex = 0;
    while (startIndex >= 0) {
      const index = text.indexOf(token, startIndex);
      if (index === -1) {
        return false;
      }

      const window = text.slice(Math.max(0, index - 24), index + token.length + 24);
      if (!/\b(?:no|not|without|absent|missing|unclear|not shown|no clear)\b/.test(window)) {
        return true;
      }

      startIndex = index + token.length;
    }

    return false;
  });
}

function hasAnyList(values: string[] | undefined, tokens: string[]) {
  const text = (values ?? []).join("\n").toLowerCase();
  return hasAny(text, tokens);
}

function collectReasons(values: Array<string | false>): string[] {
  return values.filter((value): value is string => Boolean(value));
}
