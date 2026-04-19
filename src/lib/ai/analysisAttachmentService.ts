import { collisionIqModels } from "@/lib/modelConfig";
import { openai } from "@/lib/openai";
import type { StoredAttachment } from "@/lib/uploadedAttachmentStore";
import {
  bufferToReusableDataUrl,
  extractPreviewDataFromBuffer,
} from "@/lib/attachments/extractPreviewData";
import { downloadEgnyteFile } from "@/app/api/egnyte/client";

type AttachmentVisionDeps = {
  summarizeImageAttachment?: (attachment: StoredAttachment) => Promise<string>;
  summarizePdfAttachment?: (attachment: StoredAttachment) => Promise<string>;
  downloadLinkedFile?: (path: string) => Promise<ArrayBuffer>;
};

export async function enrichAnalysisAttachments(params: {
  attachments: StoredAttachment[];
  userIntent?: string | null;
  deps?: AttachmentVisionDeps;
}): Promise<StoredAttachment[]> {
  const normalizedAttachments = await Promise.all(
    params.attachments.map((attachment) =>
      normalizeStoredAttachment(attachment, params.deps)
    )
  );
  const linkedAttachments = await fetchEgnyteLinkedAttachments({
    attachments: normalizedAttachments,
    userIntent: params.userIntent ?? "",
    deps: params.deps,
  });

  return [...normalizedAttachments, ...linkedAttachments];
}

export function extractEgnyteUrls(text: string): string[] {
  if (!text.trim()) return [];

  const matches = text.match(/https?:\/\/[^\s)\]>"]+/gi) ?? [];
  return [...new Set(matches.filter((value) => /egnyte\.com/i.test(value)))];
}

export function extractEgnytePathFromUrl(urlValue: string): string | null {
  try {
    const url = new URL(urlValue);
    const searchPath = url.searchParams.get("path");
    if (searchPath) {
      return normalizeEgnytePath(searchPath);
    }

    const hashPath = new URLSearchParams(url.hash.replace(/^#/, "")).get("path");
    if (hashPath) {
      return normalizeEgnytePath(hashPath);
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const markerIndex = segments.findIndex((segment) =>
      ["d", "dd", "dl", "shared-files"].includes(segment.toLowerCase())
    );

    if (markerIndex >= 0) {
      return normalizeEgnytePath(`/${segments.slice(markerIndex + 1).join("/")}`);
    }

    return normalizeEgnytePath(url.pathname);
  } catch {
    return null;
  }
}

async function normalizeStoredAttachment(
  attachment: StoredAttachment,
  deps?: AttachmentVisionDeps
): Promise<StoredAttachment> {
  if (attachment.type.startsWith("image/") && attachment.imageDataUrl) {
    const summary = await (deps?.summarizeImageAttachment ?? summarizeImageAttachment)(attachment);
    return {
      ...attachment,
      text: mergeObservationText(attachment.text, summary),
    };
  }

  if (attachment.type === "application/pdf" && attachment.imageDataUrl) {
    const summary = await (deps?.summarizePdfAttachment ?? summarizePdfAttachment)(attachment);
    return {
      ...attachment,
      text: mergeObservationText(attachment.text, summary),
    };
  }

  return attachment;
}

async function fetchEgnyteLinkedAttachments(params: {
  attachments: StoredAttachment[];
  userIntent: string;
  deps?: AttachmentVisionDeps;
}): Promise<StoredAttachment[]> {
  const urls = [
    ...params.attachments.flatMap((attachment) => extractEgnyteUrls(attachment.text || "")),
    ...extractEgnyteUrls(params.userIntent),
  ];
  const uniquePaths = [...new Set(urls.map(extractEgnytePathFromUrl).filter(Boolean))] as string[];

  if (uniquePaths.length === 0) {
    return [];
  }

  const linkedAttachments = await Promise.all(
    uniquePaths.map(async (pathValue, index) => {
      try {
        const buffer = Buffer.from(
          await (params.deps?.downloadLinkedFile ?? downloadEgnyteFile)(pathValue)
        );
        const filename = pathValue.split("/").pop() || `egnyte-linked-${index + 1}`;
        const mimeType = inferMimeType(filename);
        const preview = await extractPreviewDataFromBuffer({
          buffer,
          mimeType,
          filename,
        });
        const imageDataUrl = bufferToReusableDataUrl({
          buffer,
          mimeType,
        });
        const baseAttachment: StoredAttachment = {
          id: `egnyte:${index + 1}:${filename}`,
          filename,
          type: mimeType,
          text: mergeObservationText(
            preview.text,
            `Egnyte linked document source: ${pathValue}`
          ),
          imageDataUrl,
          pageCount: preview.pageCount,
        };
        const normalized = await normalizeStoredAttachment(baseAttachment, params.deps);

        return {
          ...normalized,
          text: mergeObservationText(
            normalized.text,
            "Provenance: Egnyte linked document"
          ),
        };
      } catch (error) {
        console.warn("[analysis-attachments] egnyte linked-document fetch failed", {
          path: pathValue,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    })
  );

  return linkedAttachments.filter((value): value is StoredAttachment => Boolean(value));
}

async function summarizeImageAttachment(attachment: StoredAttachment) {
  if (!attachment.imageDataUrl) {
    return "";
  }

  try {
    const response = await openai.responses.create({
      model: collisionIqModels.primary,
      temperature: 0.1,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Summarize this collision-related image as structured plain text.

Return concise plain text only with these labels:
- Document type:
- Visible damage zones:
- Visible repair cues:
- Damage severity:
- Estimate validation signals / open verification concerns:
- Readable estimate text:
- Visible identifiers:
- Structural cues:
- Suspension / wheel-opening cues:

Document type should be one of: damage photo, estimate screenshot, comparison screenshot, document photo, unknown.
Prefer grounded observations only.
Treat the image as evidence of visible condition only. Do not claim hidden damage from the image alone.
If visible damage raises concern for related verification, phrase it as an open verification concern, for example: visible damage may support structural verification or suspension component inspection pending teardown/documentation.`,
            },
            {
              type: "input_image",
              image_url: attachment.imageDataUrl,
              detail: "auto",
            },
          ],
        },
      ],
    });

    return response.output_text?.trim() ?? "";
  } catch (error) {
    console.warn("[analysis-attachments] image normalization failed", {
      filename: attachment.filename,
      mimeType: attachment.type || "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

async function summarizePdfAttachment(attachment: StoredAttachment) {
  if (!attachment.imageDataUrl || attachment.type !== "application/pdf") {
    return "";
  }

  try {
    const response = await openai.responses.create({
      model: collisionIqModels.primary,
      temperature: 0.1,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Review this PDF as a collision-repair source document.

Focus on the first page, totals page, photo/screenshot-heavy pages, and any low-text pages that still carry meaningful visual information.

Return concise plain text only with these labels:
- Document type:
- Key visible estimate facts:
- Visible damage/photo observations:
- Comparison or screenshot cues:
- Structural cues:
- Readable totals/support:

Only include grounded observations from the PDF.`,
            },
            {
              type: "input_file",
              filename: attachment.filename,
              file_data: attachment.imageDataUrl,
            } as unknown as { type: "input_file"; filename: string; file_data: string },
          ],
        },
      ],
    });

    return response.output_text?.trim() ?? "";
  } catch (error) {
    console.warn("[analysis-attachments] pdf vision normalization failed", {
      filename: attachment.filename,
      mimeType: attachment.type || "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

function mergeObservationText(baseText: string, addition: string) {
  const trimmedAddition = addition.trim();
  if (!trimmedAddition) {
    return baseText;
  }

  if (!baseText.trim()) {
    return trimmedAddition;
  }

  return `${baseText}\n\n${trimmedAddition}`;
}

function normalizeEgnytePath(value: string): string | null {
  const decoded = decodeURIComponent(value).trim();
  if (!decoded) return null;
  return decoded.startsWith("/") ? decoded : `/${decoded}`;
}

function inferMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
