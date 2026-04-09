const VALUATION_URL_PATTERN = /For a full valuation, continue at https:\/\/www\.collision\.academy\/?/gi;

export function formatAssistantMessage(content: string): string {
  return content.replace(
    VALUATION_URL_PATTERN,
    "[Continue for full valuation](https://www.collision.academy/)"
  );
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
