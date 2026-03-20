import { jsPDF } from "jspdf";

interface Props {
  variant?: "left" | "right";
  analysis?: string;
}

/* ---------------- Issue extraction ---------------- */

function extractIssues(text?: string): string[] {
  if (!text) return [];

  const issues: string[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (
      lower.includes("risk") ||
      lower.includes("exposure") ||
      lower.includes("missing") ||
      lower.includes("gap") ||
      lower.includes("violate")
    ) {
      issues.push(line.replace(/[-*]/g, "").trim());
    }
  }

  return issues.slice(0, 5);
}

/* ---------------- Comparison extraction ---------------- */

type ComparisonRow = {
  category: string;
  shop: string;
  insurance: string;
};

function extractComparison(text?: string): ComparisonRow[] {
  if (!text) return [];

  const rows: ComparisonRow[] = [];
  const lines = text.split("\n");

  let currentCategory = "";

  for (const line of lines) {
    const clean = line.replace(/[-*]/g, "").trim();
    const lower = clean.toLowerCase();

    if (
      lower.includes("scope") ||
      lower.includes("labor") ||
      lower.includes("parts") ||
      lower.includes("refinish") ||
      lower.includes("adas")
    ) {
      currentCategory = clean.replace(":", "");
    }

    if (lower.startsWith("shop estimate")) {
      rows.push({
        category: currentCategory,
        shop: clean.replace("Shop Estimate:", "").trim(),
        insurance: "",
      });
    }

    if (lower.startsWith("insurance estimate")) {
      const last = rows[rows.length - 1];
      if (last) {
        last.insurance = clean.replace("Insurance Estimate:", "").trim();
      }
    }
  }

  return rows.slice(0, 5);
}

type Discrepancy = {
  category: string;
  shop: string;
  insurance: string;
};

function detectDiscrepancies(rows: ComparisonRow[]): Discrepancy[] {
  const issues: Discrepancy[] = [];

  rows.forEach((row) => {
    if (!row.shop || !row.insurance) return;

    if (row.shop !== row.insurance) {
      issues.push({
        category: row.category,
        shop: row.shop,
        insurance: row.insurance,
      });
    }
  });

  return issues;
}

function IssueCard({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
      {text}
    </div>
  );
}

function generateSupplement(issues: string[]) {
  if (!issues.length) return "";

  const intro = `Subject: Request for Repair Supplement

After reviewing the repair estimate and related documentation, several issues
have been identified that may affect repair safety, OEM compliance, or repair
quality. These items should be addressed before proceeding with repairs.

Identified Issues:
`;

  const list = issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n");

  const closing = `

Based on these findings, we respectfully request authorization for the
appropriate adjustments to ensure the repair follows OEM procedures and
industry standards.

Please advise if additional documentation is required.

Sincerely,
Repair Review System
Collision-IQ
`;

  return intro + list + closing;
}

/* ---------------- Component ---------------- */

export default function WorkspacePanel({ analysis }: Props) {
  const issues = extractIssues(analysis);
  const comparison = extractComparison(analysis);
  const discrepancies = detectDiscrepancies(comparison);
  const supplementLetter = generateSupplement(issues);

  function exportPDF() {
    if (!analysis) return;

    const doc = new jsPDF();

    let y = 20;

    doc.setFont("Helvetica", "Bold");
    doc.setFontSize(18);
    doc.text("Collision-IQ Analysis Report", 15, y);

    y += 12;

    doc.setFontSize(11);
    doc.setFont("Helvetica", "Normal");

    const riskScore =
      issues.length > 2 ? "High" : issues.length > 0 ? "Moderate" : "Low";
    const confidence = analysis ? "Moderate" : "Low";

    doc.text(`Risk Score: ${riskScore}`, 15, y);
    y += 6;

    doc.text(`Confidence: ${confidence}`, 15, y);
    y += 10;

    /* ---------------- Comparison Table ---------------- */

    if (comparison.length > 0) {
      doc.setFont("Helvetica", "Bold");
      doc.text("Estimate Comparison", 15, y);
      y += 8;

      doc.setFont("Helvetica", "Normal");

      comparison.forEach((row) => {
        const line = `${row.category} | Shop: ${row.shop} | Insurance: ${row.insurance}`;
        const lines = doc.splitTextToSize(line, 180);

        doc.text(lines, 15, y);
        y += lines.length * 6;
      });

      y += 6;
    }

    /* ---------------- Key Issues ---------------- */

    if (issues.length > 0) {
      doc.setFont("Helvetica", "Bold");
      doc.text("Key Issues", 15, y);
      y += 8;

      doc.setFont("Helvetica", "Normal");

      issues.forEach((issue) => {
        const lines = doc.splitTextToSize(`! ${issue}`, 180);
        doc.text(lines, 15, y);
        y += lines.length * 6;
      });

      y += 6;
    }

    /* ---------------- Full Analysis ---------------- */

    doc.setFont("Helvetica", "Bold");
    doc.text("Full Analysis", 15, y);
    y += 8;

    doc.setFont("Helvetica", "Normal");

    const bodyLines = doc.splitTextToSize(analysis, 180);
    doc.text(bodyLines, 15, y);

    doc.save("collision-iq-analysis.pdf");
  }

  return (
    <div className="flex flex-col h-full text-sm text-white">
      {/* Panel intro */}

      <div className="mb-4 rounded-xl bg-glass border-glass p-4 backdrop-blur-md">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-white/50">
          Repair Intelligence
        </h3>

        <p className="text-xs text-white/60">
          Uploaded files and structured repair analysis will appear here.
        </p>
      </div>

      {/* Analysis output */}

      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl bg-glass border-glass p-4 backdrop-blur-md">
        {discrepancies.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-white/40">
              Insurance vs Shop Estimate
            </div>

            <table className="w-full overflow-hidden rounded-lg border border-white/10 text-xs">
              <tbody>
                {discrepancies.map((row, i) => (
                  <tr key={i} className="border-t border-white/10">
                    <td className="px-2 py-2 text-white/80">{row.category}</td>

                    <td className="px-2 py-2 text-green-300">{row.shop}</td>

                    <td className="px-2 py-2 text-red-300">↓ {row.insurance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Comparison table */}

        {comparison.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-white/40">
              Estimate Comparison
            </div>

            <table className="w-full overflow-hidden rounded-lg border border-white/10 text-xs">
              <thead className="bg-white/5 text-white/60">
                <tr>
                  <th className="px-2 py-2 text-left">Category</th>
                  <th className="px-2 py-2 text-left">Shop</th>
                  <th className="px-2 py-2 text-left">Insurance</th>
                </tr>
              </thead>

              <tbody>
                {comparison.map((row, i) => (
                  <tr key={i} className="border-t border-white/10">
                    <td className="px-2 py-2 text-white/80">{row.category}</td>

                    <td className="px-2 py-2 text-white/60">{row.shop}</td>

                    <td className="px-2 py-2 text-red-300">{row.insurance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Issue cards */}

        {issues.length > 0 ? (
          <div className="flex flex-col gap-2">
            {issues.map((issue, i) => (
              <IssueCard key={i} text={issue} />
            ))}
          </div>
        ) : (
          <div className="text-xs text-white/40">
            Assistant output will appear here.
          </div>
        )}

        {/* Export button */}

        {analysis && (
          <button
            onClick={exportPDF}
            className="mt-4 w-full rounded-md border border-white/10 bg-white/5 hover:bg-white/10 p-3 text-xs"
          >
            Export PDF Report
          </button>
        )}

        {supplementLetter && (
          <button
            onClick={() => {
              const blob = new Blob([supplementLetter], { type: "text/plain" });
              const url = URL.createObjectURL(blob);

              const a = document.createElement("a");
              a.href = url;
              a.download = "collision-iq-supplement.txt";
              a.click();

              URL.revokeObjectURL(url);
            }}
            className="mt-2 w-full rounded-md border border-white/10 bg-accent/20 hover:bg-accent/30 p-3 text-xs"
          >
            Generate Supplement Letter
          </button>
        )}

        {supplementLetter && (
          <div className="mt-4 rounded-md border border-white/10 bg-black/60 p-3 text-xs whitespace-pre-wrap">
            {supplementLetter}
          </div>
        )}
      </div>
    </div>
  );
}
