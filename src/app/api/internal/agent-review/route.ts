import { NextRequest, NextResponse } from "next/server";
import { assertCompliantOutput } from "@/lib/ai/policy/assertCompliantOutput";
import { sanitizeOutput } from "@/lib/ai/policy/sanitizeOutput";
import { SAFE_ANALYSIS_RULES } from "@/lib/ai/policy/agentRules";
import { runEstimateAgent } from "@/lib/ai/agents/estimateAgent";
import { runADASAgent } from "@/lib/ai/agents/adasAgent";
import { runProcedureAgent } from "@/lib/ai/agents/procedureAgent";
import { runSupplementAgent } from "@/lib/ai/agents/supplementAgent";
import { extractEstimateOps, parseEstimate } from "@/lib/ai/extractors/estimateExtractor";
import {
  extractComparisonFacts,
  type ComparisonFacts,
} from "@/lib/ai/extractors/comparisonExtractor";
import { extractOemRequirements } from "@/lib/ai/extractors/oemProcedureExtractor";

type RetrievedDocumentSource = "google-drive" | "web";

type RetrievedDocument = {
  source: RetrievedDocumentSource;
  title: string;
  url?: string;
  text?: string;
  metadata?: Record<string, unknown>;
};

type AgentReviewRequestBody = {
  caseId?: unknown;
  jurisdiction?: unknown;
  mode?: unknown;
  userQuery?: unknown;
  shopEstimateText?: unknown;
  insurerEstimateText?: unknown;
  oemProcedureText?: unknown;
  retrievedDocuments?: unknown;
};

function safeJson(payload: unknown, init?: ResponseInit) {
  const safe = sanitizeOutput(payload);
  assertCompliantOutput(safe);
  return NextResponse.json(safe, init);
}

function unwrap(result: PromiseSettledResult<unknown>, agent: string) {
  if (result.status === "fulfilled") {
    return { ok: true, data: result.value };
  }

  return {
    ok: false,
    error: `${agent}_failed`,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRetrievedDocuments(input: unknown): RetrievedDocument[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized: RetrievedDocument[] = [];

  for (const item of input) {
    if (!isPlainObject(item)) {
      continue;
    }

    const source =
      item.source === "google-drive" || item.source === "web"
        ? item.source
        : null;
    const title = typeof item.title === "string" ? item.title.trim() : "";

    if (!source || !title) {
      continue;
    }

    normalized.push({
      source,
      title,
      url: typeof item.url === "string" ? item.url : undefined,
      text: typeof item.text === "string" ? item.text : undefined,
      metadata: isPlainObject(item.metadata) ? item.metadata : undefined,
    });
  }

  return normalized;
}

function buildDriveProcedureContextText(documents: RetrievedDocument[]): string {
  const procedureDocs = documents.filter((document) => {
    const haystack = `${document.title}\n${document.text ?? ""}`.toLowerCase();
    return /oem|procedure|calibration|scan|corrosion|position statement/.test(haystack);
  });

  return procedureDocs
    .map((document) => `${document.title}\n${document.text ?? ""}`.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);
}

function enrichComparisonFactsWithRetrievedDocs(
  facts: ComparisonFacts,
  documents: RetrievedDocument[]
): ComparisonFacts {
  const corpus = documents
    .map((document) => `${document.title}\n${document.text ?? ""}`)
    .join("\n")
    .toLowerCase();

  const insurer = { ...facts.insurer };

  if (/pre-?repair scan|pre-?scan/.test(corpus)) {
    insurer.preScan = true;
  }

  if (/cavity\s*wax|corrosion\s*protection/.test(corpus)) {
    insurer.cavityWax = true;
  }

  if (/transport.*calibration|calibration.*transport|sublet.*calibration/.test(corpus)) {
    insurer.calibrationTransport = true;
  }

  if (/finish\s*sand\s*(and|&)\s*polish/.test(corpus)) {
    insurer.finishSandPolish = true;
  }

  return {
    shop: facts.shop,
    insurer,
  };
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-internal-agent-key");

  if (!apiKey || apiKey !== process.env.INTERNAL_AGENT_API_KEY) {
    return safeJson({ error: "Unauthorized" }, { status: 401 });
  }

  let body: AgentReviewRequestBody;

  try {
    body = (await req.json()) as AgentReviewRequestBody;
  } catch {
    return safeJson({ error: "Invalid JSON body" }, { status: 400 });
  }

  const agentInput = {
    ...body,
    caseId: typeof body.caseId === "string" ? body.caseId : undefined,
    jurisdiction:
      typeof body.jurisdiction === "string" ? body.jurisdiction : undefined,
    mode: typeof body.mode === "string" ? body.mode : undefined,
    userQuery: typeof body.userQuery === "string" ? body.userQuery : undefined,
    shopEstimateText:
      typeof body.shopEstimateText === "string" ? body.shopEstimateText : "",
    insurerEstimateText:
      typeof body.insurerEstimateText === "string" ? body.insurerEstimateText : "",
    oemProcedureText:
      typeof body.oemProcedureText === "string" ? body.oemProcedureText : "",
    retrievedDocuments: normalizeRetrievedDocuments(body.retrievedDocuments),
    complianceRules: SAFE_ANALYSIS_RULES,
  };

  const driveDocuments = agentInput.retrievedDocuments.filter(
    (document) => document.source === "google-drive"
  );
  const driveProcedureContext = buildDriveProcedureContextText(driveDocuments);
  const effectiveProcedureText = [agentInput.oemProcedureText, driveProcedureContext]
    .filter(Boolean)
    .join("\n\n");

  const operations = extractEstimateOps(agentInput.shopEstimateText);
  const baseComparisonFacts = extractComparisonFacts(
    parseEstimate(agentInput.shopEstimateText),
    parseEstimate(agentInput.insurerEstimateText)
  );
  const comparisonFacts = enrichComparisonFactsWithRetrievedDocs(
    baseComparisonFacts,
    driveDocuments
  );
  const oemRequirements = extractOemRequirements(effectiveProcedureText);

  const [estimate, adas, procedure, supplement] = await Promise.allSettled([
    runEstimateAgent(agentInput),
    runADASAgent(operations),
    runProcedureAgent(comparisonFacts, oemRequirements),
    runSupplementAgent(comparisonFacts),
  ]);

  const result = {
    ok: true,
    retrieval: {
      documentsReceived: agentInput.retrievedDocuments.length,
      driveDocumentsUsed: driveDocuments.length,
    },
    findings: {
      estimate: unwrap(estimate, "estimate"),
      adas: unwrap(adas, "adas"),
      procedure: unwrap(procedure, "procedure"),
      supplement: unwrap(supplement, "supplement"),
    },
  };

  return safeJson(result);
}
