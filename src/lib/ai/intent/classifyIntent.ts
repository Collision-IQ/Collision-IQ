export type Intent =
  | "estimate_review"
  | "estimate_compare"
  | "repair_question"
  | "business_question"
  | "general_question";

export function classifyIntent(
  message: string,
  hasAttachments: boolean
): Intent {
  const text = message.toLowerCase();

  if (
    hasAttachments &&
    (text.includes("compare") ||
      text.includes("difference") ||
      text.includes("vs"))
  ) {
    return "estimate_compare";
  }

  if (
    hasAttachments &&
    (text.includes("review") ||
      text.includes("missing") ||
      text.includes("check estimate") ||
      text.includes("audit"))
  ) {
    return "estimate_review";
  }

  if (
    text.includes("calibration") ||
    text.includes("oem") ||
    text.includes("procedure") ||
    text.includes("repair")
  ) {
    return "repair_question";
  }

  if (
    text.includes("supplement") ||
    text.includes("adjuster") ||
    text.includes("insurance") ||
    text.includes("negotiate")
  ) {
    return "business_question";
  }

  return "general_question";
}
