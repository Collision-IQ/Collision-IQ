import type { AnalysisResult } from "../types/analysis";
import { detectAppraisalOpportunity } from "./appraisalEngine";
import { buildRepairStory } from "./buildRepairStory";

export function buildNarrative(result: AnalysisResult): string {
  const story = buildRepairStory(result.rawEstimateText || "");
  const findings = result.findings;

  let narrative = buildEstimateOpening(story);

  const structureInsight = evaluateStructure(story);
  if (structureInsight) {
    narrative += ` ${structureInsight}`;
  }

  const keyFindings = findings.slice(0, 3);

  for (const finding of keyFindings) {
    narrative += buildFindingExplanation(finding);
  }

  const leverage = detectLeverage(findings);
  if (leverage) {
    narrative += `\n\n${leverage}`;
  }

  const appraisal = detectAppraisalOpportunity(result);

  if (appraisal.shouldRecommend) {
    narrative += `\n\nAt this point, this is moving out of a normal supplement discussion. ${appraisal.reasons.join(
      ", "
    )}. This is where appraisal becomes a valid path.`;
  }

  return narrative.trim();
}

function buildEstimateOpening(
  story: ReturnType<typeof buildRepairStory>
): string {
  if (!story.zones.length) {
    return "Looking at this estimate as a whole, the repair scope isn't clearly defined from the extracted data.";
  }

  return `Looking at this estimate as a whole, this is a ${story.complexity} involving ${story.zones.join(", ")}.`;
}

function evaluateStructure(
  story: ReturnType<typeof buildRepairStory>
): string {
  if (!story.zones.length) return "";

  if (story.structural) {
    return "There are also structural indicators in the estimate, which raises the stakes on repair depth, support, and verification.";
  }

  if (story.zones.length >= 2) {
    return "The scope itself isn't the issue - what matters is how the operations are structured and supported across the repair zones involved.";
  }

  return "The scope looks relatively localized, which makes it even more important that the estimate clearly shows the repair depth and supporting operations.";
}

function buildFindingExplanation(
  finding: AnalysisResult["findings"][number]
): string {
  if (finding.status === "not_detected") {
    return ` The estimate doesn't clearly show ${finding.title.toLowerCase()}, which matters because ${finding.detail.toLowerCase()}.`;
  }

  if (finding.status === "present") {
    return ` ${finding.title} is actually accounted for, even if it's written differently.`;
  }

  return ` ${finding.title} is referenced, but not clearly confirmed.`;
}

function detectLeverage(findings: AnalysisResult["findings"]): string {
  const hasGap = findings.some((finding) => finding.status === "not_detected");
  const hasHigh = findings.some((finding) => finding.severity === "high");

  if (hasGap && hasHigh) {
    return "This isn't just a missing detail - it shifts liability. If it's not addressed, whoever completes the repair owns the outcome. That's where the leverage is.";
  }

  if (hasGap) {
    return "This is the kind of gap that typically gets challenged because it directly affects cost and responsibility.";
  }

  return "";
}
