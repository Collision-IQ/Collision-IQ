import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Simple CSV parser (v1). Later we can swap to robust csv-parse.
function parseCsv(csvText: string) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length === 0) return { headers: [] as string[], rows: [] as Record<string, string>[] };

  const headers = lines[0].split(",").map((s) => s.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",").map((s) => s.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = cells[i] ?? ""));
    return obj;
  });

  return { headers, rows };
}

const server = new McpServer({
  name: "collision-iq-tools",
  version: "0.1.0",
});

// Tool 1: Parse CSV text -> structured JSON
server.tool(
  "parse_csv",
  {
    csvText: z.string().min(1),
    maxRows: z.number().int().min(1).max(500).default(200),
  },
  async ({ csvText, maxRows }: { csvText: string; maxRows: number }) => {
    const { headers, rows } = parseCsv(csvText);
    const clipped = rows.slice(0, maxRows);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              headers,
              rowCount: rows.length,
              rows: clipped,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 2: Document checklist generator
server.tool(
  "document_review_checklist",
  {
    docType: z
      .enum(["estimate", "supplement", "repair_procedure", "policy", "other"])
      .default("other"),
    text: z.string().min(1),
  },
  async ({ docType, text }: { docType: string; text: string }) => {
    const sample = text.slice(0, 2000);

    const checklistByType: Record<string, string[]> = {
      estimate: [
        "Confirm vehicle identifiers (Y/M/M, VIN if present)",
        "Identify repair sections (body, refinish, structural, safety systems)",
        "Identify parts types (OEM / aftermarket / recycled) and note any non-OEM",
        "Look for procedure references (pre/post scans, calibrations, weld/bond notes)",
        "Flag missing operations (ADAS calibration, scans, corrosion protection, seam sealer, etc.)",
      ],
      supplement: [
        "What changed vs. original estimate?",
        "Which added operations are OEM-required?",
        "Any denied line items? Note reason + documentation needed to support",
      ],
      repair_procedure: [
        "Confirm applicability (model/trim/year, section)",
        "Extract MUST requirements (materials, weld type/count, adhesives, cure times)",
        "Identify calibrations and post-repair checks",
      ],
      policy: [
        "Locate appraisal clause language",
        "Locate parts language (OEM vs LKQ vs AM)",
        "Locate repair standards/safety language",
        "Locate dispute/escalation steps",
      ],
      other: [
        "Identify document purpose and key requirements",
        "Extract key fields/dates/entities",
        "List missing info and recommended next steps",
      ],
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              docType,
              extractedSample: sample,
              checklist: checklistByType[docType],
              note: "Structured helper only (no legal advice). Use Next.js/OpenAI to generate final narrative.",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
