import type { CustomerReport } from "./generateCustomerReport";

type RenderCustomerReportHtmlInput = {
  report: CustomerReport;
  vehicle: string;
  vin?: string | null;
  insurer?: string | null;
  mileage?: string | null;
  estimateTotal?: string | null;
  generatedAt: string;
};

function renderList(items: string[]) {
  if (items.length === 0) {
    return "<li>None noted.</li>";
  }

  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
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
  const { report } = input;

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
      Simple, customer-friendly explanation of the repair situation and what the next steps mean.
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
      <h2>Overview</h2>
      <p>${escapeHtml(report.overview)}</p>
    </div>

    <div class="section">
      <h2>What Was Found</h2>
      <ul>${renderList(report.whatWasFound)}</ul>
    </div>

    <div class="section">
      <h2>What Needs To Happen</h2>
      <ul>${renderList(report.whatNeedsToHappen)}</ul>
    </div>

    <div class="section">
      <h2>Why These Repairs Matter</h2>
      <p>${escapeHtml(report.whyTheseRepairsMatter)}</p>
    </div>

    <div class="section">
      <h2>Safety And Technology</h2>
      <ul>${renderList(report.safetyAndTechnology)}</ul>
    </div>

    <div class="section">
      <h2>What May Still Need To Be Confirmed</h2>
      <ul>${renderList(report.whatMayStillNeedToBeConfirmed)}</ul>
    </div>

    <div class="section">
      <h2>What The Customer Should Expect</h2>
      <ul>${renderList(report.whatTheCustomerShouldExpect)}</ul>
    </div>

    <div class="section">
      <h2>Reassurance</h2>
      <p>${escapeHtml(report.reassurance)}</p>
    </div>

    <div class="footer">
      This report is intended to explain the repair situation in plain language for the vehicle owner.
    </div>
  </div>
</body>
</html>
`.trim();
}
