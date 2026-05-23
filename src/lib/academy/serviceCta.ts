export type AcademyServiceCta = {
  serviceKey: "academy_diminished_value" | "academy_value_dispute" | "academy_appraisal_clause" | "academy_appraisal";
  title: string;
  button: string;
  reason: string;
  chips: string[];
};

export function selectAcademyServiceCta(params: {
  intentText?: string | null;
  estimateCount?: number;
  estimateDispute?: boolean;
  defaultReason?: string | null;
}): AcademyServiceCta {
  const text = (params.intentText ?? "").toLowerCase();

  if (/\b(diminished value|post[-\s]?repair value loss|loss in value|dv services?)\b|\bdv\b/.test(text)) {
    return {
      serviceKey: "academy_diminished_value",
      title: "Need help with diminished value?",
      button: "Start Diminished Value Review",
      reason: "The case context mentions diminished value or post-repair value loss.",
      chips: ["Preview only", "Low confidence"],
    };
  }

  if (/\b(acv|actual cash value|vehicle value|valuation|total loss|market value|market comps?|market comparables?|comparable listings?|value dispute)\b/.test(text)) {
    return {
      serviceKey: "academy_value_dispute",
      title: "Need help with valuation?",
      button: "Start Valuation Review",
      reason: "The case context includes valuation, ACV, total-loss, or market-comparable issues.",
      chips: ["Preview only", "Needs 3+ comps"],
    };
  }

  const twoEstimateDispute =
    params.estimateCount === 2 ||
    params.estimateDispute === true ||
    /\b(two estimates|2 estimates|carrier estimate|shop estimate|estimate dispute|estimate disagreement|right to appraisal|rta|appraisal clause)\b/.test(text);

  if (twoEstimateDispute) {
    return {
      serviceKey: "academy_appraisal_clause",
      title: "Need help resolving the estimate dispute?",
      button: "Start Right to Appraisal Review",
      reason: "The file appears to involve a two-estimate repair dispute without a stronger valuation or DV intent.",
      chips: ["RTA available"],
    };
  }

  return {
    serviceKey: "academy_appraisal",
    title: "Need professional support?",
    button: "Start Professional Services Review",
    reason: params.defaultReason || "The file has unresolved repair or documentation issues that may benefit from professional review.",
    chips: ["Preview only"],
  };
}
