import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

  McpServer,
  createStdioServer,
} from "@modelcontextprotocol/sdk";

function parseCsv(csvText: string) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0].split(",").map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const cells = line.split(",").map(c => c.trim());
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

createStdioServer(server);

// Tool 2: Document checklist generator (structured helper)
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
        "Find parts types (OEM/aftermarket/recycled) and note any non-OEM",
        "Look for procedure references (scans, calibrations, weld/bond notes)",
        "Flag missing operations (ADAS calibration, pre/post scans, corrosion protection, seam sealer, etc.)",
      ],
      supplement: [
        "What changed vs original estimate?",
        "Which added ops are OEM-required?",
        "Any denied line items? Note rationale + documentation to support",
      ],
      repair_procedure: [
        "Confirm applicability (model/trim/year, section)",
        "Extract must-do requirements (materials, weld type/count, adhesives, cure times)",
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
            { docType, extractedSample: sample, checklist: checklistByType[docType] },
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

