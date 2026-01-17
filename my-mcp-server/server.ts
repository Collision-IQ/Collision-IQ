import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/**
 * Simple CSV parser (v1)
 * Later we can swap to a robust CSV parser if you have quoted commas, etc.
 */
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

// --- 1) Create MCP server (NOTE: TWO args: info + options)
const server = new Server(
  { name: "collision-iq-tools", version: "0.1.0" },
  {
    capabilities: {
      tools: {}, // required to advertise tool capability
    },
  }
);

// --- 2) Tool schemas (MCP expects JSON Schema-ish shapes)
const ParseCsvInputSchema = {
  type: "object",
  properties: {
    csvText: { type: "string", description: "CSV text to parse" },
    maxRows: { type: "number", description: "Maximum rows to return", default: 200 },
  },
  required: ["csvText"],
} as const;

const DocChecklistInputSchema = {
  type: "object",
  properties: {
    docType: {
      type: "string",
      enum: ["estimate", "supplement", "repair_procedure", "policy", "other"],
      default: "other",
    },
    text: { type: "string", description: "Document text to analyze" },
  },
  required: ["text"],
} as const;

// --- 3) tools/list handler
server.setRequestHandler(
  z.object({ method: z.literal("tools/list") }),
  async () => {
    return {
      tools: [
        {
          name: "parse_csv",
          description: "Parse CSV text into structured JSON (headers + rows).",
          inputSchema: ParseCsvInputSchema,
        },
        {
          name: "document_review_checklist",
          description: "Generate a documentation review checklist for estimates/policies/procedures.",
          inputSchema: DocChecklistInputSchema,
        },
      ],
    };
  }
);

// --- 4) tools/call handler
server.setRequestHandler(
  z.object({
    method: z.literal("tools/call"),
    params: z.object({
      name: z.string(),
      arguments: z.record(z.any()).optional(),
    }),
  }),
  async (req) => {
    const toolName = req.params.name;
    const args = req.params.arguments ?? {};

    if (toolName === "parse_csv") {
      const parsed = z
        .object({
          csvText: z.string().min(1),
          maxRows: z.number().int().min(1).max(500).default(200),
        })
        .parse(args);

      const { headers, rows } = parseCsv(parsed.csvText);
      const clipped = rows.slice(0, parsed.maxRows);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { headers, rowCount: rows.length, rows: clipped },
              null,
              2
            ),
          },
        ],
      };
    }

    if (toolName === "document_review_checklist") {
      const parsed = z
        .object({
          docType: z
            .enum(["estimate", "supplement", "repair_procedure", "policy", "other"])
            .default("other"),
          text: z.string().min(1),
        })
        .parse(args);

      const sample = parsed.text.slice(0, 2000);

      const checklistByType: Record<string, string[]> = {
        estimate: [
          "Confirm vehicle identifiers (Y/M/M, VIN if present)",
          "Identify sections (body/refinish/structural/safety systems)",
          "Identify parts types (OEM/aftermarket/recycled) and note any non-OEM",
          "Look for required operations (pre/post scan, calibrations, corrosion protection, seam sealer)",
          "Flag any missing OEM-required steps for supplement documentation",
        ],
        supplement: [
          "What changed vs original estimate?",
          "Which added ops are OEM-required?",
          "Any denied line items? Note reason + documentation to support",
        ],
        repair_procedure: [
          "Confirm applicability (model/trim/year/section)",
          "Extract MUST requirements (materials, weld type/count, adhesives, cure times)",
          "Identify calibrations, inspections, post-repair checks",
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
                docType: parsed.docType,
                extractedSample: sample,
                checklist: checklistByType[parsed.docType],
                note: "Informational/documentation strategy only — not legal advice.",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Unknown tool: ${toolName}`,
        },
      ],
    };
  }
);

// --- 5) Connect via stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
