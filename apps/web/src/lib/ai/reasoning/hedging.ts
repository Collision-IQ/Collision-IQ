const HEDGE_RE =
  /\b(may|might|could|possibly|potentially|appears|appears to|seems|seems to)\b/gi;

export function assertNoHedging(text: string): string {
  return text
    .replace(HEDGE_RE, "not shown in the provided documents")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function deterministicConclusion(
  status: "included" | "missing" | "not_shown",
  includedText: string,
  missingText: string,
  unknownText: string
): string {
  if (status === "included") return includedText;
  if (status === "missing") return missingText;
  return unknownText;
}
