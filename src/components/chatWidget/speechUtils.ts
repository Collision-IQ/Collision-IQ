import { cleanPresentationMarkdown } from "@/lib/ui/presentationText";

const VALUATION_URL_PATTERN = /For a full valuation, continue at https:\/\/www\.collision\.academy\/?/gi;
const NUMBERED_APPRAISAL_SECTION_PATTERN =
  /(?:[ \t]*\n[ \t]*|[ \t]+)([1-6]\.\s+(?:Appraisal Recommendation|Award Posture|Why the selected posture is better supported|What remains not final-award confidence|Specific line\/item vulnerabilities|Whether final award is ready or deferred)\b)/gi;
const APPRAISAL_BLOCK_LABEL_PATTERN =
  /(?:[ \t]*\n[ \t]*|[ \t]+)((?:Carrier vulnerabilities|Shop vulnerabilities|Final award|Bottom line|Better supported than SOR-2|Vulnerable on the Shop estimate|Well supported in SOR-2|Better supported|Vulnerable)\b\s*:?\s*)/gi;
const OPERATION_CHAIN_BOUNDARY_PATTERN =
  /\s+(?=(?:Because|Carrier vulnerabilities|Shop vulnerabilities|Final award|Bottom line|Better supported than SOR-2|Vulnerable on the Shop estimate|Well supported in SOR-2|[1-6]\.\s+(?:Appraisal Recommendation|Award Posture|Why the selected posture is better supported|What remains not final-award confidence|Specific line\/item vulnerabilities|Whether final award is ready or deferred))\b)/i;

export function formatAssistantMessage(content: string): string {
  return cleanPresentationMarkdown(
    content.replace(
      VALUATION_URL_PATTERN,
      "[Continue for full valuation](https://www.collision.academy/)"
    )
  );
}

export function formatAssistantDisplayMessage(content: string): string {
  return enforceLiveChatLineBreaks(formatAssistantMessage(content));
}

function enforceLiveChatLineBreaks(value: string): string {
  return formatInlineOperationChains(value)
    .replace(NUMBERED_APPRAISAL_SECTION_PATTERN, "\n\n$1")
    .replace(/(?:[ \t]*\n[ \t]*|[ \t]+)(#{2,3}\s+)/g, "\n\n$1")
    .replace(APPRAISAL_BLOCK_LABEL_PATTERN, "\n\n$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatInlineOperationChains(value: string): string {
  const chainStart = value.search(/\bquarter replacement path\b/i);
  if (chainStart < 0) return value;

  const afterStart = value.slice(chainStart);
  const boundaryMatch = OPERATION_CHAIN_BOUNDARY_PATTERN.exec(afterStart);
  const chainEnd = boundaryMatch ? chainStart + boundaryMatch.index : value.length;
  const chain = value.slice(chainStart, chainEnd);
  const bullets = buildOperationBullets(chain);

  if (bullets.length < 3) return value;

  const prefix = value.slice(0, chainStart).trimEnd();
  const suffix = value.slice(chainEnd);
  const lead = prefix
    ? `${prefix.replace(/\b(?:the file supports|the reviewed file supports|supports|recognizes)\s*(?:the\s*)?$/i, "").trimEnd()}\n\nThe file recognizes the major supported operations:`
    : "The file recognizes the major supported operations:";

  return `${lead}\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}${suffix}`;
}

function buildOperationBullets(chain: string): string[] {
  const normalized = chain.toLowerCase();
  const bullets: string[] = [];

  if (/\bquarter replacement path\b/i.test(chain)) {
    bullets.push("quarter replacement path");
  }
  if (/\brear bumper replacement\/overhaul\b/i.test(chain)) {
    bullets.push("rear bumper replacement or overhaul");
  } else if (/\brear bumper replacement\b/i.test(chain) || /\brear bumper overhaul\b/i.test(chain)) {
    bullets.push("rear bumper replacement or overhaul");
  }
  if (/\btail lamp pocket\/fuel pocket\b/i.test(chain) || (/\btail lamp pocket\b/i.test(chain) && /\bfuel pocket\b/i.test(chain))) {
    bullets.push("tail lamp pocket and fuel pocket work");
  }
  if (/\bblind spot radar\b/i.test(chain)) {
    bullets.push(/\bbracket\b/i.test(chain) ? "blind spot radar and bracket replacement" : "blind spot radar replacement");
  }

  const setupMeasurePull = ["setup", "set up", "measure", "pull", "calibration", "alignment"].filter((term) =>
    normalized.includes(term)
  );
  if (setupMeasurePull.length >= 2) {
    bullets.push("setup, measure, pull, calibration, and alignment");
  } else if (/\brelated calibration activity\b|\bcalibration activity\b/i.test(chain)) {
    bullets.push("scan, calibration, and alignment activity");
  }

  return bullets;
}

export function toSpeechText(content: string): string {
  return formatAssistantMessage(content)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[`*_>#-]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSpeechTextIntoChunks(content: string, maxLength = 900): string[] {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences.map((value) => value.trim()).filter(Boolean)) {
    if (sentence.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let index = 0; index < sentence.length; index += maxLength) {
        chunks.push(sentence.slice(index, index + maxLength).trim());
      }
      continue;
    }

    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function canUseBrowserReadAloud() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
