import type { AnalysisFinding, AnalysisResult } from "../types/analysis";

export function buildNarrative(params: {
  findings: AnalysisFinding[];
  summary: AnalysisResult["summary"];
}): string {
  const included = params.findings.filter((finding) => finding.status === "included");
  const missingOrReduced = params.findings.filter(
    (finding) => finding.status === "missing" || finding.status === "reduced"
  );
  const exposure = params.findings.filter((finding) => finding.status === "exposure");

  const lines: string[] = [];

  lines.push("## EXECUTIVE TECHNICAL SUMMARY");
  lines.push("");
  lines.push(
    `- I compared the shop blueprint to the insurer estimate and found ${included.length} documented included operation(s), ${missingOrReduced.length} missing or reduced item(s), and ${exposure.length} exposure item(s).`
  );
  if (included.length > 0) {
    lines.push(`- Insurer included: ${summarizeTitles(included)}.`);
  }
  if (missingOrReduced.length > 0) {
    lines.push(`- Still not fully matched: ${summarizeTitles(missingOrReduced)}.`);
  }
  if (exposure.length > 0) {
    lines.push(`- Parts or sourcing exposure: ${summarizeTitles(exposure)}.`);
  }
  lines.push(`- Risk score: ${params.summary.riskScore}.`);
  lines.push(`- Confidence: ${params.summary.confidence}.`);
  lines.push(`- Critical issues: ${params.summary.criticalIssues}.`);
  lines.push(`- Evidence quality: ${params.summary.evidenceQuality}.`);
  lines.push("");

  const buckets: Array<{ title: string; findings: AnalysisFinding[] }> = [
    { title: "Included Coverage", findings: included },
    {
      title: "Critical Findings",
      findings: missingOrReduced.filter((finding) => finding.bucket === "critical"),
    },
    {
      title: "ADAS Findings",
      findings: params.findings.filter((finding) => finding.bucket === "adas"),
    },
    {
      title: "Quality Findings",
      findings: params.findings.filter((finding) => finding.bucket === "quality"),
    },
    {
      title: "Compliance Findings",
      findings: params.findings.filter((finding) => finding.bucket === "compliance"),
    },
    {
      title: "Supplement Opportunities",
      findings: params.findings.filter((finding) => finding.bucket === "supplement"),
    },
    {
      title: "Parts Sourcing Exposure",
      findings: params.findings.filter((finding) => finding.bucket === "parts"),
    },
  ];

  for (const bucket of buckets) {
    lines.push(`## ${bucket.title.toUpperCase()}`);
    lines.push("");

    if (bucket.findings.length === 0) {
      lines.push(`- No ${bucket.title.toLowerCase()} identified.`);
      lines.push("");
      continue;
    }

    for (const finding of bucket.findings) {
      lines.push(
        `- ${finding.title} [${finding.status} | ${finding.severity}]: ${finding.detail}`
      );
    }
    lines.push("");
  }

  lines.push("## BOTTOM LINE");
  lines.push("");
  if (missingOrReduced.length > 0 || exposure.length > 0) {
    lines.push(
      `The insurer estimate includes meaningful coverage, but it still carries ${missingOrReduced.length + exposure.length} documented mismatch or exposure item(s).`
    );
  } else {
    lines.push("The insurer estimate mirrors the documented operations evaluated in this review.");
  }

  return lines.join("\n");
}

function summarizeTitles(findings: AnalysisFinding[]): string {
  const titles = [...new Set(findings.map((finding) => finding.title))];

  if (titles.length === 0) return "none";
  if (titles.length <= 4) return titles.join(", ");
  return `${titles.slice(0, 4).join(", ")}, and ${titles.length - 4} more item(s)`;
}
