import { z } from "zod";
import {
  McpServer,
  StdioServerTransport,
} from "@modelcontextprotocol/sdk/server";

// Small helper: parse CSV (simple, good enough for v1)
// If you want robust CSV later, we can add csv-parse.
function parseCsv(csvText: string) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length === 0) return { headers: [], rows: [] };

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

// Tool 1: Parse CSV text into structured JSON
server.tool(
  "parse_csv",
  {
    csvText: z.string().min(1),
    maxRows: z.number().int().min(1).max(500).default(200),
  },
  async ({ csvText, maxRows }) => {
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

// Tool 2: Summarize text docs (your Next.js app will call OpenAI; MCP just structures)
server.tool(
  "document_review_checklist",
  {
    docType: z.enum(["estimate", "supplement", "repair_procedure", "policy", "other"]).default("other"),
    text: z.string().min(1),
  },
  async ({ docType, text }) => {
    // This tool returns a checklist template + extracted “signals”
    // Later, we can add more structured extraction (VIN, carrier, line items, etc.)
    const sample = text.slice(0, 2000);

    const checklistByType: Record<string, string[]> = {
      estimate: [
        "Confirm vehicle identifiers (Y/M/M, VIN if present)",
        "Identify repair sections (body, refinish, structural, safety systems)",
        "Find parts types (OEM/aftermarket/recycled) and note any non-OEM",
        "Look for procedure references (OEM steps, calibrations, weld/bond notes)",
        "Flag missing operations (ADAS calibration, scans, corrosion protection, seam sealer, etc.)",
      ],
      supplement: [
        "What changed vs. original estimate?",
        "Which added operations are OEM-required?",
        "Any denied line items? Note reason and documentation to support",
      ],
      repair_procedure: [
        "Confirm applicability (model/trim/year, section)",
        "Extract must-do requirements (materials, weld count/type, adhesives, cure times)",
        "Identify calibrations and post-repair checks",
      ],
      policy: [
        "Find appraisal clause language",
        "Find parts language (OEM vs LKQ vs AM)",
        "Find safety / repair standards language",
        "Find dispute / escalation steps",
      ],
      other: [
        "Identify document purpose and key requirements",
        "Extract key fields, dates, entities",
        "List next steps and missing info",
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
              note: "This MCP tool is a structured helper. Your Next.js API will use OpenAI to generate the final narrative response.",
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
  // Server now listens on stdin/stdout for MCP JSON-RPC
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
