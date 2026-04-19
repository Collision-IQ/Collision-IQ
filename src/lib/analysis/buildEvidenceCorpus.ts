type FileLike = {
  name?: string;
  text?: string | null;
  summary?: string | null;
};

type LinkedDocLike = {
  title?: string | null;
  url?: string;
  text?: string | null;
  status?: "ok" | "blocked" | "failed";
  sourceType?: string;
};

export const EVIDENCE_POLICY = `
LINKED EVIDENCE POLICY
- URLs found in estimate text or uploaded files should be treated as potential evidence sources.
- Retrieve accessible linked documents server-side and preserve their extracted text in the case.
- Use linked OEM procedures and linked ADAS reports as substantive evidence when successfully retrieved.
- If a link is blocked, private, or fails retrieval, do not pretend it was reviewed and do not assume the underlying record does not exist.
- Treat blocked or failed linked documents as referenced but not yet produced, or open to further documentation.
- When successfully retrieved linked evidence conflicts with generic assumptions, the linked case-specific evidence wins.
- Do not assume the model can browse arbitrary URLs at answer time. Only retrieved case evidence should be treated as reviewed.
`.trim();

export function buildEvidenceCorpus({
  estimateText,
  files,
  linkedEvidence,
}: {
  estimateText?: string;
  files?: FileLike[];
  linkedEvidence?: LinkedDocLike[];
}) {
  const parts: string[] = [];

  if (estimateText) {
    parts.push(`ESTIMATE\n${estimateText}`);
  }

  for (const file of files || []) {
    parts.push(
      `UPLOADED FILE: ${file.name || "Untitled"}\n${file.text || file.summary || ""}`
    );
  }

  for (const doc of linkedEvidence || []) {
    if (doc.status !== "ok") {
      parts.push(
        [
          `LINKED DOCUMENT REFERENCED BUT NOT PRODUCED: ${doc.title || "Untitled"}`,
          `URL: ${doc.url || "Unknown"}`,
          `TYPE: ${doc.sourceType || "unknown"}`,
          `STATUS: ${doc.status || "unknown"}`,
          "The link was detected as candidate evidence but the underlying content was not reviewed.",
        ].join("\n")
      );
      continue;
    }

    parts.push(
      [
        `LINKED DOCUMENT: ${doc.title || "Untitled"}`,
        `URL: ${doc.url || "Unknown"}`,
        `TYPE: ${doc.sourceType || "unknown"}`,
        doc.text || "",
      ].join("\n")
    );
  }

  return parts.join("\n\n");
}
