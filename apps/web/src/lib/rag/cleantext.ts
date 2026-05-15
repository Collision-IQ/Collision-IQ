export function cleanPdfText(text: string) {
  return text
    // normalize line endings
    .replace(/\r\n/g, "\n")

    // remove excessive whitespace
    .replace(/[ \t]+/g, " ")

    // fix broken line wraps
    .replace(/([a-z])\n([a-z])/gi, "$1 $2")

    // collapse multiple newlines
    .replace(/\n{3,}/g, "\n\n")

    // remove page numbers like "Page 1"
    .replace(/Page\s+\d+/gi, "")

    // trim
    .trim();
}