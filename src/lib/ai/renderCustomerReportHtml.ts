import type { CustomerReport } from "./generateCustomerReport";
import {
  sanitizeCustomerReportForRender,
  toCustomerFacingList,
  toCustomerFacingText,
} from "./customerFacingText";
import {
  alignCustomerEstimatePostureText,
  stripEstimateComparisonLanguage,
  type EstimatePostureDecision,
} from "./estimatePosture";

type RenderCustomerReportHtmlInput = {
  report: CustomerReport;
  vehicle: string;
  vin?: string | null;
  insurer?: string | null;
  mileage?: string | null;
  estimateTotal?: string | null;
  generatedAt: string;
  selectedEstimatePosture?: EstimatePostureDecision;
};

function renderList(items: string[]) {
  if (items.length === 0) {
    return "<li>None noted.</li>";
  }

  return toCustomerFacingList(items).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderCustomerReportHtml(input: RenderCustomerReportHtmlInput): string {
  const report = sanitizeCustomerReportForRender(input.report);
  const comparisonAvailable = input.selectedEstimatePosture
    ? input.selectedEstimatePosture.comparisonAvailable !== false
    : true;
  const scrub = (text: string) =>
    comparisonAvailable ? text : stripEstimateComparisonLanguage(text);
  const openingSummary = toCustomerFacingText(scrub(report.openingSummary));
  const strongerPlan = toCustomerFacingText(
    input.selectedEstimatePosture
      ? alignCustomerEstimatePostureText(report.whichRepairPlanLooksStronger, input.selectedEstimatePosture)
      : scrub(report.whichRepairPlanLooksStronger)
  );
  const safetyFirst = toCustomerFacingText(scrub(report.safetyFirst));
  const bottomLine = toCustomerFacingText(scrub(report.bottomLine));
  const keyFindings = report.whatStillNeedsProof.map(scrub);
  const questionsToAsk = report.yourOptions.map(scrub);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(report.title)}</title>
  <style>
    body {
      font-family: Arial, Helvetica, sans-serif;
      background: #0b0b0d;
      color: #f3f3f4;
      margin: 0;
      padding: 0;
    }

    .page {
      padding: 40px 44px;
    }

    .brand {
      color: #f28c38;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }

    .title {
      font-size: 28px;
      font-weight: 700;
      margin: 0 0 8px 0;
      color: #ffffff;
    }

    .subtitle {
      font-size: 14px;
      color: #b8b8bd;
      margin-bottom: 24px;
    }

    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 24px;
      margin-bottom: 28px;
      padding: 18px 20px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
    }

    .meta-item {
      font-size: 13px;
      line-height: 1.5;
    }

    .meta-label {
      display: block;
      color: #9e9ea7;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 11px;
      margin-bottom: 4px;
    }

    .section {
      margin-bottom: 22px;
      padding: 18px 20px;
      border: 1px solid rgba(242, 140, 56, 0.18);
      border-radius: 16px;
      background: linear-gradient(180deg, rgba(242,140,56,0.08), rgba(255,255,255,0.02));
    }

    .section h2 {
      margin: 0 0 10px 0;
      font-size: 14px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #f2a15d;
    }

    .section p {
      margin: 0;
      font-size: 14px;
      line-height: 1.7;
      color: #f3f3f4;
    }

    ul {
      margin: 0;
      padding-left: 20px;
    }

    li {
      margin: 0 0 8px 0;
      line-height: 1.6;
      font-size: 14px;
      color: #f3f3f4;
    }

    .footer {
      margin-top: 28px;
      font-size: 12px;
      line-height: 1.6;
      color: #9e9ea7;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="brand">Collision Academy</div>
    <h1 class="title">${escapeHtml(report.title)}</h1>
    <div class="subtitle">
      Straight explanation for the vehicle owner about which repair path looks more accurate, what matters for safety, and the practical options from here.
    </div>

    <div class="meta">
      <div class="meta-item"><span class="meta-label">Vehicle</span>${escapeHtml(input.vehicle)}</div>
      <div class="meta-item"><span class="meta-label">VIN</span>${escapeHtml(input.vin ?? "Not provided")}</div>
      <div class="meta-item"><span class="meta-label">Insurer</span>${escapeHtml(input.insurer ?? "Not provided")}</div>
      <div class="meta-item"><span class="meta-label">Mileage</span>${escapeHtml(input.mileage ?? "Not provided")}</div>
      <div class="meta-item"><span class="meta-label">Estimate Total</span>${escapeHtml(input.estimateTotal ?? "Not provided")}</div>
      <div class="meta-item"><span class="meta-label">Generated</span>${escapeHtml(input.generatedAt)}</div>
    </div>

    <div class="section">
      <h2>Plain-English Summary</h2>
      <p>${escapeHtml(openingSummary)}</p>
    </div>

    <div class="section">
      <h2>What This Means for You</h2>
      <p>${escapeHtml([strongerPlan, bottomLine].filter(Boolean).join(" "))}</p>
    </div>

    <div class="section">
      <h2>Key Findings</h2>
      <ul>${renderList(keyFindings)}</ul>
    </div>

    <div class="section">
      <h2>Why These Items Matter</h2>
      <p>${escapeHtml(safetyFirst)}</p>
    </div>

    <div class="section">
      <h2>Questions to Ask</h2>
      <ul>${renderList(questionsToAsk)}</ul>
    </div>

    <div class="section">
      <h2>Supporting Documentation</h2>
      <ul>${renderList([
        ...keyFindings.slice(0, 4),
        "If repairs are complete, request the final invoice, scan, calibration, alignment, and delivery documentation.",
      ])}</ul>
    </div>

    <div class="section">
      <h2>Technical Appendix</h2>
      <ul>${renderList([
        "Repair completion status is not established from the reviewed file.",
        "If repairs are ongoing, open items should remain available for supplement review.",
        comparisonAvailable
          ? "The insurer or repair shop should explain whether each concern is already included."
          : "The repair shop should explain whether each concern is already included.",
        "If something is not included, ask why and whether it will be reviewed as a supplement.",
      ])}</ul>
    </div>

    <div class="footer">
      <p>This report is intended to explain the repair situation in plain language for the vehicle owner.</p>
      <p>Any policy-related or state-specific options should be read as practical guidance and then confirmed against the actual policy and claim record.</p>
    </div>
  </div>
</body>
</html>
`.trim();
}
