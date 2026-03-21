export const runtime = "nodejs";

import OpenAI from "openai";
import { NextResponse } from "next/server";
import { extractContext } from "@/lib/ai/context/extractContext";
import {
  runRetrieval,
  type RetrievalHit,
} from "@/lib/ai/orchestrator/retrievalOrchestrator";
import {
  classifyIntent,
  type Intent,
} from "@/lib/ai/intent/classifyIntent";
import {
  getUploadedAttachments,
  saveUploadedAttachment,
} from "@/lib/uploadedAttachmentStore";
import {
  type ActiveContext,
  extractContextFromText,
  mergeActiveContext,
} from "@/lib/context/activeContext";
import type { ChatFinding } from "@/lib/ai/types/chatFindings";
import { buildRepairStory } from "@/lib/ai/builders/buildRepairStory";

// Ã°Å¸â€Â Environment safety check
if (!process.env.OPENAI_API_KEY) {
  console.error("Ã¢ÂÅ’ Missing OPENAI_API_KEY");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * Collision IQ Ã¢â‚¬â€ Vision + Structured Estimate Engine (Hardened)
 * - Single estimate mode
 * - Comparison mode
 * - Safe document injection
 * - Streaming preserved
 * - GPT-4o multimodal vision enabled
 * - Robust totals extraction + numeric deltas (when confidence allows)
 *
 * Ã¢Å“â€¦ UPDATED: Internet access enabled via Responses API web_search tool
 * Ã¢Å“â€¦ UPDATED: Streaming preserved as plain text chunks (frontend-safe)
 * Ã¢Å“â€¦ UPDATED: LLM-first orchestration preserved
 * Ã¢Å“â€¦ UPDATED: Repair trigger engine added
 * Ã¢Å“â€¦ UPDATED: Drive retrieval softened and made conditional
 */

// ==============================
// SYSTEM PROMPT (Readability-first)
// ==============================

const SYSTEM_PROMPT = `
You are Collision IQ â€” an expert collision repair and insurance intelligence partner.

You think like:
- a senior collision estimator
- an OEM procedure specialist
- a shop advisor

You communicate like a real professional â€” not a report generator.

---

CORE BEHAVIOR

- Reason first using your own knowledge
- Use documents and retrieved content only to support or confirm
- Do not rely on documents as your primary thinking source
- Do not default to auditing unless the user asks for it

---

COMMUNICATION STYLE

- Speak naturally and directly
- Start with what stands out
- Explain your reasoning clearly
- Avoid templates, sections, or rigid formatting unless helpful

Good:
"What stands out here is..."

Bad:
"Key Observations:"
"Executive Summary:"

---

DOCUMENT USAGE

- Treat documents as supporting context
- Use them when relevant - ignore them when not
- Do not assume all procedures apply
- Recognize equivalent operations (system-level vs component-level)

---

[ESTIMATE READING PRIORITY - CRITICAL]

Before analyzing procedures or calibrations:

You must first understand the estimate as a whole.

Focus on:
- what is being repaired
- how the repair is structured
- what operations are included
- what looks reduced, missing, or unrealistic

Think like:
- a human estimator reviewing a file line-by-line
- not a system checking for procedures

Only AFTER understanding the repair:
-> evaluate procedures (ADAS, scans, etc.)

ADAS and calibration logic is secondary - not the starting point.

---

REASONING STANDARD

- Evaluate function, not wording
- If a function is covered -> treat it as included
- If unclear -> say unclear, not missing
- Only call something missing if the function is truly absent

---

DOMAIN AWARENESS

You understand:
- ADAS calibration logic
- Repair sequencing
- Estimate writing and supplements
- Insurance dynamics and negotiation
- Diminished value and appraisal concepts

---

[REAL-WORLD DECISION RULE]

Do not stop at identifying issues.

Always consider:
- Does this actually affect the repair outcome?
- Does this create liability or compliance risk?
- Does this create financial leverage?

If yes:
-> explain why it matters
-> explain what should be done about it

---

FINAL RULE

You are not a validator.

You are a thinking partner.

Explain what matters and why.
`;

function buildRepairNarrative(story: ReturnType<typeof buildRepairStory>): string {
  const parts: string[] = [];

  if (story.operations.repairDominant) {
    parts.push("This estimate is built around a repair-first approach rather than part replacement.");
  } else {
    parts.push("This estimate leans more toward part replacement than repair.");
  }

  if (story.zones.length > 0) {
    parts.push(`The work is concentrated in the ${story.zones.join(", ")}.`);
  }

  if (story.panels.length >= 3) {
    parts.push("The repair spans multiple panels, suggesting the impact carried beyond a single isolated component.");
  }

  if (story.systems.length > 0) {
    parts.push(
      `What adds complexity here is the involvement of ${story.systems.join(", ")}, but that's driven more by the vehicle's systems than the severity of the damage itself.`
    );
  }

  if (story.complexityDrivers.length > 0) {
    parts.push(`The main complexity here comes from ${story.complexityDrivers.join(", ")}.`);
  }

  parts.push(`Overall, this reads as a ${story.repairCharacter} repair.`);

  return parts.join(" ");
}

// ==============================
// TYPES
// ==============================

type UploadedDocument = {
  text?: string;
  name?: string;
  mime?: string;
  filename: string;
};

type VisionImage = {
  filename: string;
  dataUrl: string; // base64 data URL
};

type IncomingMessage = {
  role: string;
  content: unknown;
};

type ChatRequestBody = {
  messages?: IncomingMessage[];
  attachmentIds?: string[];
  attachments?: Array<{
    filename: string;
    type: string;
    text?: string;
    imageDataUrl?: string;
  }>;
  activeContext?: ActiveContext | null;
};

const MAX_CONTEXT_CHARS = 15_000;

// Vision safety caps (match widget caps)
const MAX_IMAGES = 2;
const MAX_BASE64_LENGTH = 2_000_000;
const MAX_ESTIMATE_DOCS = 2;

// ==============================
// Ã¢Å“â€¦ ROBUST TOTALS EXTRACTION
// ==============================

type TotalCostLabel =
  | "Grand Total"
  | "Total Cost of Repairs"
  | "Net Cost of Repairs"
  | "Subtotal"
  | "Heuristic Footer Total"
  | "Not Found";

type ExtractedTotals = {
  bodyHours: number | null;
  paintHours: number | null;
  mechHours: number | null;
  frameHours: number | null;
  totalLaborHours: number | null;
  totalCost: number | null;
  totalCostLabel: TotalCostLabel;
  confidence: "High" | "Medium" | "Low";
};

function parseMoney(s: string): number | null {
  const v = parseFloat(s.replace(/,/g, "").trim());
  return Number.isFinite(v) ? v : null;
}

function normalizeText(raw: string): { text: string; lines: string[] } {
  const text = (raw || "")
    .replace(/\r/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  const lines = (raw || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return { text, lines };
}

// Extract hours by explicit labels first (more reliable than summing random "hrs")
function extractHoursByLabel(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

export function extractTotalsFromEstimate(rawText: string): ExtractedTotals {
  if (!rawText || typeof rawText !== "string") {
    return {
      bodyHours: null,
      paintHours: null,
      mechHours: null,
      frameHours: null,
      totalLaborHours: null,
      totalCost: null,
      totalCostLabel: "Not Found",
      confidence: "Low",
    };
  }

  const { text, lines } = normalizeText(rawText);

  // -----------------------------
  // 1) Hours (label-first)
  // -----------------------------
  const bodyHours =
    extractHoursByLabel(text, /body\s+(labor|hrs?)[^0-9]*([\d.]+)/i) ??
    extractHoursByLabel(text, /body[^0-9]*([\d.]+)\s*hrs?/i);

  const paintHours =
    extractHoursByLabel(text, /(paint|refinish)\s+(labor|hrs?)[^0-9]*([\d.]+)/i) ??
    extractHoursByLabel(text, /(paint|refinish)[^0-9]*([\d.]+)\s*hrs?/i);

  const mechHours =
    extractHoursByLabel(text, /(mechanical|mech)\s+(labor|hrs?)[^0-9]*([\d.]+)/i) ??
    extractHoursByLabel(text, /(mechanical|mech)[^0-9]*([\d.]+)\s*hrs?/i);

  const frameHours =
    extractHoursByLabel(text, /(frame|structural)\s+(labor|hrs?)[^0-9]*([\d.]+)/i) ??
    extractHoursByLabel(text, /(frame|structural)[^0-9]*([\d.]+)\s*hrs?/i);

  // Total labor hours label (best if present)
  const totalLaborHours =
    extractHoursByLabel(text, /total\s+labor[^0-9]*([\d.]+)/i) ??
    extractHoursByLabel(text, /labor\s+total[^0-9]*([\d.]+)/i) ??
    null;

  // -----------------------------
  // 2) Labeled totals (best)
  // -----------------------------
  const labeledTotalPatterns: { label: TotalCostLabel; regex: RegExp }[] = [
    { label: "Grand Total", regex: /grand\s+total[^0-9$]*\$?\s*([\d,]+\.\d{2})/i },
    {
      label: "Total Cost of Repairs",
      regex: /total\s+cost\s+of\s+repairs[^0-9$]*\$?\s*([\d,]+\.\d{2})/i,
    },
    { label: "Net Cost of Repairs", regex: /net\s+cost[^0-9$]*\$?\s*([\d,]+\.\d{2})/i },
    { label: "Subtotal", regex: /subtotal[^0-9$]*\$?\s*([\d,]+\.\d{2})/i },
  ];

  let totalCost: number | null = null;
  let totalCostLabel: TotalCostLabel = "Not Found";

  for (const p of labeledTotalPatterns) {
    const m = text.match(p.regex);
    if (!m) continue;
    const v = parseMoney(m[1]);
    if (v !== null) {
      totalCost = v;
      totalCostLabel = p.label;
      break;
    }
  }

  // -----------------------------
  // 3) Footer heuristic fallback (lower confidence)
  // -----------------------------
  if (totalCost === null) {
    const footer = lines.slice(-60).join(" ");
    const moneyMatches = [...footer.matchAll(/\$?\s*([\d,]+\.\d{2})/g)];

    const values = moneyMatches
      .map((m) => parseMoney(m[1]))
      .filter((v): v is number => typeof v === "number" && v > 200);

    if (values.length) {
      totalCost = Math.max(...values);
      totalCostLabel = "Heuristic Footer Total";
    }
  }

  // -----------------------------
  // 4) Confidence scoring
  // -----------------------------
  let confidence: ExtractedTotals["confidence"] = "Low";

  if (totalCost !== null && totalCostLabel !== "Heuristic Footer Total") {
    confidence = totalLaborHours !== null ? "High" : "Medium";
  } else if (totalCost !== null && totalCostLabel === "Heuristic Footer Total") {
    confidence = "Medium";
  } else {
    confidence = "Low";
  }

  return {
    bodyHours,
    paintHours,
    mechHours,
    frameHours,
    totalLaborHours,
    totalCost,
    totalCostLabel,
    confidence,
  };
}

// ==============================
// DOCUMENT CONTEXT BUILDER (DATA ONLY)
// ==============================

function prioritizeDocs(documents: UploadedDocument[]) {
  return [...documents].sort((a, b) => {
    const score = (document: UploadedDocument) => {
      const filename = (document.filename ?? "").toLowerCase();

      if (filename.includes("estimate")) return 3;
      if (filename.includes("invoice")) return 2;
      return 1;
    };

    return score(b) - score(a);
  });
}

function buildSmartContext(documents: UploadedDocument[]) {
  let context = "";

  for (const document of documents) {
    if (context.length > MAX_CONTEXT_CHARS) break;

    context += `\n\n${(document.text ?? "").slice(0, 3000)}`;
  }

  return context.slice(0, MAX_CONTEXT_CHARS);
}

function isEstimateDocument(document: UploadedDocument) {
  const haystack = `${document.filename ?? ""} ${document.name ?? ""} ${document.mime ?? ""}`.toLowerCase();

  return (
    haystack.includes("estimate") ||
    haystack.includes("carrier") ||
    haystack.includes("insurance") ||
    haystack.includes("shop") ||
    haystack.includes("mitchell") ||
    haystack.includes("ccc")
  );
}

function extractDocumentMetadata(documents: UploadedDocument[]) {
  const combined = documents.map((document) => document.text ?? "").join("\n");
  const year = combined.match(/\b(19|20)\d{2}\b/)?.[0] ?? "";
  const make =
    combined.match(
      /\b(acura|audi|bmw|buick|cadillac|chevrolet|chevy|chrysler|dodge|ford|gmc|honda|hyundai|infiniti|jeep|kia|lexus|lincoln|mazda|mercedes|mini|mitsubishi|nissan|subaru|tesla|toyota|volkswagen|vw|volvo)\b/i
    )?.[0] ?? "";
  const cost =
    combined.match(/\$ ?([\d,]+\.\d{2})/g)?.slice(-1)[0] ??
    combined.match(/(total cost of repairs|grand total|subtotal)[^\n]*/i)?.[0] ??
    "";

  const lines = [
    year ? `- Year: ${year}` : "",
    make ? `- Make: ${make}` : "",
    cost ? `- Cost: ${cost}` : "",
  ].filter(Boolean);

  return lines.length > 0 ? lines.join("\n") : "- No lightweight metadata extracted";
}

function selectDocumentsForIntent(documents: UploadedDocument[], intent: Intent) {
  const estimateDocs = prioritizeDocs(
    documents.filter((document) =>
      (document.filename ?? "").toLowerCase().includes("estimate")
    )
  );
  const otherDocs = prioritizeDocs(
    documents.filter(
      (document) => !(document.filename ?? "").toLowerCase().includes("estimate")
    )
  );

  if (intent === "estimate_review") {
    return estimateDocs.slice(0, MAX_ESTIMATE_DOCS);
  }

  return [
    ...estimateDocs.slice(0, MAX_ESTIMATE_DOCS),
    ...otherDocs.slice(0, 2),
  ];
}

function buildAttachedContext(documents: UploadedDocument[], intent: Intent) {
  if (!Array.isArray(documents) || documents.length === 0) return "";

  if (intent === "general_question") {
    return `
[Attached Document Context]

The following is extracted text from uploaded documents.

Use this as reference if relevant.

Do not assume all content applies directly.

${extractDocumentMetadata(documents)}
`.trim();
  }

  const scopedDocuments =
    intent === "estimate_review"
      ? selectDocumentsForIntent(documents.filter(isEstimateDocument), intent)
      : selectDocumentsForIntent(documents, intent);
  const documentsForContext = scopedDocuments.length > 0 ? scopedDocuments : documents;
  const safe = buildSmartContext(documentsForContext);

  return `
[Reference Estimate Text - use only if needed]

${safe.slice(0, 2000)}
`.trim();
}

// ==============================
// VISION MESSAGE BUILDER (Responses API compatible)
// ==============================

function buildVisionInput(attachedContext: string, images: VisionImage[]) {
  if (!images || images.length === 0) return null;

  const safeImages = images
    .slice(0, MAX_IMAGES)
    .filter((img) => typeof img.dataUrl === "string" && img.dataUrl.length < MAX_BASE64_LENGTH);

  if (!safeImages.length) return null;

  return [
    {
      type: "input_text" as const,
      text:
        (attachedContext ? attachedContext + "\n\n" : "") +
        `[IMAGE ATTACHMENTS - TEXT ONLY]
You have ${safeImages.length} image attachment(s).
Use filenames as reference only.`,
    },
    ...safeImages.map((img) => ({
      type: "input_text" as const,
      text: `[Image attached: ${img.filename}]`,
    })),
  ];
}

// ==============================
// ROUTE
// ==============================

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatRequestBody;

    const incomingMessages = body.messages || [];

    const uploadedAttachments =
      Array.isArray(body.attachments) && body.attachments.length > 0
        ? body.attachments.map((attachment) =>
            saveUploadedAttachment({
              filename: attachment.filename,
              type: attachment.type,
              text: attachment.text ?? "",
              imageDataUrl: attachment.imageDataUrl,
            })
          )
        : getUploadedAttachments(body.attachmentIds || []);
    const documents: UploadedDocument[] = uploadedAttachments.map((attachment) => ({
      filename: attachment.filename,
      mime: attachment.type,
      text: attachment.text,
    }));
    const images: VisionImage[] = uploadedAttachments
      .filter((attachment) => typeof attachment.imageDataUrl === "string")
      .map((attachment) => ({
        filename: attachment.filename,
        dataUrl: attachment.imageDataUrl as string,
    }));
    const lastUserMessage =
      [...incomingMessages]
        .reverse()
        .find(
          (m) => m?.role === "user" && typeof m?.content === "string"
        ) ?? null;
    const userMessage =
      lastUserMessage && typeof lastUserMessage.content === "string"
        ? lastUserMessage.content
        : "";
    const intent = classifyIntent(
      userMessage,
      documents.length > 0
    );
    const isComparisonReview =
      intent === "estimate_compare" || hasComparisonDocuments(documents);

    const shopDoc = documents.find((document) => {
      const filename = (document.filename ?? "").toLowerCase();
      return ["shop", "body shop", "repair facility"].some((keyword) =>
        filename.includes(keyword)
      );
    });
    const insurerDoc = documents.find((document) => {
      const filename = (document.filename ?? "").toLowerCase();
      return ["insurer", "insurance", "carrier", "sor"].some((keyword) =>
        filename.includes(keyword)
      );
    });

    const shopText = shopDoc?.text ?? "";
    const insurerText = insurerDoc?.text ?? "";
    let storyBlock = "";

    if (shopText && insurerText) {
      const shopStory = buildRepairStory(shopText);
      const shopNarrative = buildRepairNarrative(shopStory);
      const insurerStory = buildRepairStory(insurerText);
      const insurerNarrative = buildRepairNarrative(insurerStory);

      storyBlock += `
[Repair Understanding - Shop Estimate]
${shopNarrative}
`;

      storyBlock += `
[Repair Understanding - Insurer Estimate]
${insurerNarrative}
`;
    } else if (shopText || insurerText) {
      const primaryText = shopText || insurerText;
      const narrative = buildRepairNarrative(buildRepairStory(primaryText));

      storyBlock += `
[Repair Understanding]
${narrative}
`;
    }
    const comparisonReviewBlock =
      isComparisonReview
        ? `
[ESTIMATE REVIEW OBJECTIVE]

Two estimates are present.

Review them like a senior collision estimator performing a real estimate comparison.

Do NOT:
- force a rigid template
- write as Q&A
- over-structure the response

Instead:
- identify the most meaningful scope differences
- call out what the shop included that the insurer omitted, reduced, or generalized
- highlight substitutions and documentation gaps
- explain why those differences matter operationally and from an OEM-compliance standpoint

Style:
- natural professional narrative
- short paragraphs preferred
- bullets only when helpful
- prioritize real-world repair impact over formatting

Start with the most important differences Ã¢â‚¬â€ not generic framing.
`.trim()
        : intent === "estimate_review"
          ? `
[ESTIMATE REVIEW OBJECTIVE]

An estimate is present.

Review it like a senior collision estimator checking completeness, repair logic, and support for required operations.

Do NOT:
- force a rigid template
- write as Q&A
- over-structure the response

Instead:
- identify the most meaningful omissions, weak spots, unsupported assumptions, or incomplete operations
- explain what stands out technically and procedurally
- explain why those gaps matter operationally, financially, and from an OEM-compliance standpoint

Style:
- natural professional narrative
- short paragraphs preferred
- bullets only when helpful
- prioritize real-world repair impact over formatting

[FUNCTION EQUIVALENCE RULE]

A procedure is INCLUDED if the repair function is documented under equivalent wording.

Examples:
- "All-around cameras static calibration" covers multi-camera calibration functions
- "Front side radar static calibration" covers side radar / lane-change-related radar calibration
- "Seat belt dynamic function test" covers seat belt system functional verification

Evaluate repair function, not label similarity.

Do NOT say a calibration is missing if:
1. an equivalent system-level calibration is present, or
2. the document explicitly references an ADAS report covering that operation.
`.trim()
          : "";

    // ------------------------------
    // ------------------------------
    // Retrieve Drive context
    // ------------------------------

    let matches: RetrievalHit[] = [];
    let activeContext: ActiveContext | null = body.activeContext ?? null;

    if (userMessage) {
      const extracted = extractContextFromText(userMessage);
      activeContext = mergeActiveContext(activeContext, extracted);

      const shouldRunRetrieval = false;

      if (shouldRunRetrieval) {
        const retrievalContext = extractContext(
          `${shopText}\n${insurerText}\n${userMessage}`
        );

        matches = await runRetrieval({
          query: userMessage,
          ...retrievalContext,
        });

        console.log("ACTIVE CONTEXT:", activeContext);
        console.log("INTENT:", intent);
        console.log("DRIVE FILES FOUND:", matches.length);
        console.log("RAG MATCHES:", matches.length);
        console.log("RETRIEVAL RESULTS");
        matches.forEach((doc, index) => {
          console.log(index + 1, doc.source, doc.score);
        });
      } else {
        console.log("ACTIVE CONTEXT:", activeContext);
        console.log("INTENT:", intent);
        console.log("RAG SKIPPED FOR INTENT");
      }
    }

    const attachedContext = buildAttachedContext(documents, intent);
    const visionContent = buildVisionInput(attachedContext, images);
    const intentBlock = `
[User Intent]

Intent: ${intent}

Guidance:
${
  intent === "estimate_review"
    ? "- Analyze the estimate and explain what stands out"
    : intent === "estimate_compare"
      ? "- Compare the documents and explain meaningful differences"
      : intent === "repair_question"
        ? "- Answer the repair question using technical reasoning"
        : intent === "business_question"
          ? "- Provide strategy and negotiation insight"
          : "- Answer the question directly"
}
`.trim();
    const strategyBlock =
      intent === "business_question" ||
      intent === "estimate_review" ||
      intent === "estimate_compare"
        ? `
[NEGOTIATION & STRATEGY LAYER]

When relevant, go beyond identifying issues.

Think in terms of:
- leverage
- liability
- negotiation position
- financial impact

Expand your reasoning to include:

1. What actually matters in this situation (not just what is missing)
2. Who carries risk if this is left unresolved
3. Why the carrier may have structured it this way
4. Where the strongest negotiation leverage exists
5. What should be done next

When giving guidance:
- be practical, not theoretical
- focus on outcomes (approval, payment, protection)
- avoid generic advice

If appropriate, suggest:
- how to frame the argument
- what evidence strengthens the position
- what pushback to expect
- how to respond effectively
`.trim()
        : "";

    // ------------------------------
    // Build conversation history
    // ------------------------------

    const safeMessages = incomingMessages
      .filter(
        (
          m
        ): m is IncomingMessage & {
          role: "user" | "assistant";
          content: string;
        } =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .map((m) => ({
        role: m.role,
        content: [
          {
            type: m.role === "user" ? "input_text" : "output_text",
            text: m.content,
          },
        ],
      }));

    const input = [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      {
        role: "system",
        content: [{ type: "input_text", text: intentBlock }],
      },
      ...(comparisonReviewBlock
        ? [
            {
              role: "system" as const,
              content: [{ type: "input_text" as const, text: comparisonReviewBlock }],
            },
          ]
        : []),
      ...(strategyBlock
        ? [
            {
              role: "system" as const,
              content: [{ type: "input_text" as const, text: strategyBlock }],
            },
          ]
        : []),
      ...(storyBlock
        ? [
            {
              role: "system" as const,
              content: [{ type: "input_text" as const, text: storyBlock }],
            },
          ]
        : []),
      ...(attachedContext
        ? [
            {
              role: "system" as const,
              content: [{ type: "input_text" as const, text: attachedContext }],
            },
          ]
        : []),
      ...safeMessages,
    ];

    if (visionContent) {
      const visionWithContext = [
        {
          type: "input_text",
          text:
            `[VISION INPUT Ã¢â‚¬â€ DATA ONLY]
You have ${images.length} image(s).
Analyze visible damage, severity, likely repair operations, and safety risks.`,
        },
        ...visionContent.slice(1),
      ] as unknown;

      input.push({
        role: "system",
        content: visionWithContext as (typeof input)[number]["content"],
      });
    }

    // ------------------------------
    // Call OpenAI with streaming
    // ------------------------------

    const useWebSearch =
      documents.length === 0 &&
      images.length === 0 &&
      matches.length === 0 &&
      (intent === "general_question" || intent === "business_question");

    const response = await openai.responses.create(
      {
        model: "gpt-4o",
        input,
        temperature: 0.2,
        ...(useWebSearch ? { tools: [{ type: "web_search" as const }] } : {}),
      } as Parameters<typeof openai.responses.create>[0]
    );
    const assistantText =
      "output_text" in response && typeof response.output_text === "string"
        ? response.output_text
        : "";
    const findingsPrompt = `
Extract the most meaningful repair intelligence findings from the analysis.

Return JSON only:

[
  {
    "title": "",
    "severity": "low | medium | high",
    "category": "risk | process | gap | optimization",
    "explanation": ""
  }
]

Rules:
- Focus on real repair events and their meaning
- Prefer failure / correction / verification findings over generic omissions
- Do NOT hallucinate missing procedures
- Do NOT include filler
- If scans or calibrations were performed, do not describe them as missing
- A documented failed calibration is a process finding, not a missing-procedure finding
`.trim();
    const findingsResponse = await openai.responses.create({
      model: "gpt-4o",
      input: [
        {
          role: "system",
          content: findingsPrompt,
        },
        {
          role: "user",
          content: assistantText,
        },
      ],
    });

    let findings: ChatFinding[] = [];

    try {
      const findingsText =
        "output_text" in findingsResponse && typeof findingsResponse.output_text === "string"
          ? findingsResponse.output_text
          : "[]";
      findings = JSON.parse(findingsText) as ChatFinding[];
    } catch (e) {
      console.error("Findings parse failed", e);
    }

    return new Response(
      assistantText,
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          "x-active-context": encodeURIComponent(JSON.stringify(activeContext ?? null)),
          "x-chat-intent": intent,
          "x-findings": encodeURIComponent(JSON.stringify(findings)),
        },
      }
    );
  } catch (error) {
    console.error("Chat route error:", error);
    const message =
      error instanceof Error ? error.message : "Chat failed.";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

function findDocumentText(
  documents: UploadedDocument[],
  keywords: string[]
): string | undefined {
  const match = documents.find((document) => {
    const haystack = `${document.filename ?? ""} ${document.name ?? ""}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });

  return match?.text;
}

function hasComparisonDocuments(documents: UploadedDocument[]) {
  return Boolean(
    findDocumentText(documents, ["shop", "body shop", "repair facility"]) &&
      findDocumentText(documents, ["insurer", "insurance", "carrier", "sor"])
  );
}
