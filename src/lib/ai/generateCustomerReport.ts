import {
  CUSTOMER_REPORT_NON_BIAS_DIRECTIVE,
  NON_BIAS_ACCURACY_DIRECTIVE,
} from "@/lib/ai/nonBiasDirective";

export type CustomerReport = {
  title: string;
  overview: string;
  whatWasFound: string[];
  whatNeedsToHappen: string[];
  whyTheseRepairsMatter: string;
  safetyAndTechnology: string[];
  whatMayStillNeedToBeConfirmed: string[];
  whatTheCustomerShouldExpect: string[];
  reassurance: string;
};

export type GenerateCustomerReportInput = {
  vehicle: string;
  insurer?: string | null;
  estimateTotal?: string | null;
  determination: string;
  documentedPositives: string[];
  supportGaps: string[];
  estimateSummary: string;
  imageSummary?: string | null;
};

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No valid JSON object found in model response.");
  }

  return text.slice(start, end + 1);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

export async function generateCustomerReport(
  input: GenerateCustomerReportInput,
  deps: {
    generateText: (prompt: string) => Promise<string>;
  }
): Promise<CustomerReport> {
  const prompt = `
You are writing a detailed CUSTOMER REPORT for a vehicle owner.

Audience:
A normal vehicle owner with no collision repair background.

Tone:
Clear, calm, professional, reassuring, and specific.
Use plain English. Avoid jargon unless you immediately explain it in simple terms.

Goals:
- Explain the damage in a way a customer can understand.
- Explain what repairs appear necessary.
- Explain why the work matters for safety, function, fit, and value.
- Explain what still may need confirmation.
- Explain what the customer should expect next.

${NON_BIAS_ACCURACY_DIRECTIVE}

${CUSTOMER_REPORT_NON_BIAS_DIRECTIVE}

Important rules:
- Do not sound argumentative or insurer-facing.
- Do not mention internal confidence scores, structured analysis engines, or AI systems.
- Do not use bullet fragments that feel vague.
- Make the report detailed and helpful.
- Be specific to the vehicle and repair situation.
- Distinguish what is documented from what appears visible in photos and what still needs confirmation.
- Return JSON only.

Return exactly this shape:
{
  "title": "string",
  "overview": "string",
  "whatWasFound": ["string"],
  "whatNeedsToHappen": ["string"],
  "whyTheseRepairsMatter": "string",
  "safetyAndTechnology": ["string"],
  "whatMayStillNeedToBeConfirmed": ["string"],
  "whatTheCustomerShouldExpect": ["string"],
  "reassurance": "string"
}

Vehicle:
${input.vehicle}

Insurer:
${input.insurer ?? "Unknown"}

Estimate Total:
${input.estimateTotal ?? "Unknown"}

Repair Determination:
${input.determination}

Documented Positives:
${input.documentedPositives.length > 0 ? input.documentedPositives.map((item) => `- ${item}`).join("\n") : "- None listed"}

Support Gaps:
${input.supportGaps.length > 0 ? input.supportGaps.map((item) => `- ${item}`).join("\n") : "- None listed"}

Estimate Summary:
${input.estimateSummary}

Image Summary:
${input.imageSummary ?? "No image summary provided."}
`.trim();

  const raw = await deps.generateText(prompt);
  const parsed = JSON.parse(extractJsonObject(raw)) as Partial<CustomerReport>;

  return normalizeCustomerReport(parsed);
}

function normalizeCustomerReport(parsed: Partial<CustomerReport>): CustomerReport {
  return {
    title:
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim()
        : "Customer Report",
    overview: typeof parsed.overview === "string" ? parsed.overview.trim() : "",
    whatWasFound: asStringArray(parsed.whatWasFound),
    whatNeedsToHappen: asStringArray(parsed.whatNeedsToHappen),
    whyTheseRepairsMatter:
      typeof parsed.whyTheseRepairsMatter === "string"
        ? parsed.whyTheseRepairsMatter.trim()
        : "",
    safetyAndTechnology: asStringArray(parsed.safetyAndTechnology),
    whatMayStillNeedToBeConfirmed: asStringArray(parsed.whatMayStillNeedToBeConfirmed),
    whatTheCustomerShouldExpect: asStringArray(parsed.whatTheCustomerShouldExpect),
    reassurance: typeof parsed.reassurance === "string" ? parsed.reassurance.trim() : "",
  };
}
