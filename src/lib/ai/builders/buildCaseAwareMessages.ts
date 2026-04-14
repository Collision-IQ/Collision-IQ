import type { CaseContext } from "@/lib/context/buildCaseContext";

export function buildCaseAwareSystemPrompt(context: CaseContext): string {
  const facts = context.extractedFacts.length
    ? context.extractedFacts
        .map((fact) => `- ${fact.label}: ${fact.value}`)
        .join("\n")
    : "- None";

  const files = context.uploadedFiles.length
    ? context.uploadedFiles
        .map((file) => `- ${file.type ?? "file"}: ${file.name}`)
        .join("\n")
    : "- None";

  const exportsList = context.exports.length
    ? context.exports.map((item) => `- ${item.label}`).join("\n")
    : "- None";

  const supportGaps = context.supportGaps.length
    ? context.supportGaps.map((gap) => `- ${gap}`).join("\n")
    : "- None";

  const determinationText = context.determination
    ? [
        `- Status: ${context.determination.status}`,
        `- Answer: ${context.determination.answer}`,
        `- Confidence: ${context.determination.confidence}`,
      ].join("\n")
    : "- None";

  return [
    "You are continuing an existing Collision IQ case analysis.",
    "Do not behave like this is a fresh chat.",
    "Answer using the existing case context first.",
    "Lead with a direct answer, then explain the reason briefly.",
    "Do not ask the user to re-upload or restate information already present unless truly necessary.",
    "",
    `Original ask: ${context.intent}`,
    `Vehicle: ${context.vehicleLabel ?? "Unknown vehicle"}`,
    "",
    "Extracted facts:",
    facts,
    "",
    "Uploaded files:",
    files,
    "",
    "Transcript summary:",
    context.transcriptSummary || "None provided",
    "",
    "Current determination:",
    determinationText,
    "",
    "Support gaps / missing confirmations:",
    supportGaps,
    "",
    "Generated exports:",
    exportsList,
  ].join("\n");
}
