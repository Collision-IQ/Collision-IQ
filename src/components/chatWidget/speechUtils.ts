import { cleanPresentationMarkdown } from "@/lib/ui/presentationText";

const VALUATION_URL_PATTERN = /For a full valuation, continue at https:\/\/www\.collision\.academy\/?/gi;

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
  return value
    .replace(/[ \t]+([1-6]\.\s+[A-Z])/g, "\n\n$1")
    .replace(/[ \t]+(#{2,3}\s+)/g, "\n\n$1")
    .replace(
      /[ \t]+((?:Carrier vulnerabilities|Shop vulnerabilities|Final award|Bottom line|Better supported|Vulnerable)\b\s*:?\s*)/gi,
      "\n\n$1"
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toSpeechText(content: string): string {
  return formatAssistantMessage(content)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[`*_>#-]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canUseBrowserReadAloud() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
