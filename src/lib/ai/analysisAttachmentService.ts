import {
  collisionIqModels,
  collisionIqProvider,
  logCollisionIqModelDiagnostic,
} from "@/lib/modelConfig";
import { generatePrimaryText } from "@/lib/ai/providerTextGeneration";
import type { StoredAttachment } from "@/lib/uploadedAttachmentStore";
import {
  bufferToReusableDataUrl,
  extractPreviewDataFromBuffer,
} from "@/lib/attachments/extractPreviewData";
import {
  downloadDriveFile,
  extractDriveFileIdFromUrl,
  isDriveEnabled,
} from "@/lib/drive/download";
import { isOpenAiVisionCompatibleImage } from "@/lib/ai/openAiVisionInput";
import {
  hasImageOnlyPage,
  isSparsePdfText,
  probePdfTextLayer,
  type PdfPageTextProfile,
} from "@/lib/attachments/pdfTextLayerProbe";

type AttachmentVisionDeps = {
  summarizeImageAttachment?: (attachment: StoredAttachment) => Promise<string>;
  summarizePdfAttachment?: (attachment: StoredAttachment) => Promise<string>;
  profilePdfPages?: (buffer: Buffer) => Promise<PdfPageTextProfile[]>;
  downloadLinkedFile?: (fileIdOrUrl: string) => Promise<ArrayBuffer>;
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
  const linkedAttachments = await fetchDriveLinkedAttachments({
    attachments: normalizedAttachments,
    userIntent: params.userIntent ?? "",
    deps: params.deps,
  });

  return [...normalizedAttachments, ...linkedAttachments];
}

export function extractDriveUrls(text: string): string[] {
  if (!text.trim()) return [];

  const matches = text.match(/https?:\/\/[^\s)\]>"]+/gi) ?? [];
  return [
    ...new Set(
      matches.filter((value) => /(?:drive|docs)\.google\.com/i.test(value))
    ),
  ];
}

export function extractDriveFileId(urlValue: string): string | null {
  return extractDriveFileIdFromUrl(urlValue);
}

export const extractEgnyteUrls = extractDriveUrls;
export const extractEgnytePathFromUrl = extractDriveFileId;

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

  // A PDF's text layer misses what it only shows: totals pages that print as
  // images, photo and screenshot pages, scanned pages. The stored data URL
  // (uploads up to MAX_REUSABLE_DATA_URL_BYTES) lets the model read them, but
  // only a PDF with such a page gets that read: a normal estimate's text
  // layer already carries its content, and the summary is one model call.
  if (
    attachment.type === "application/pdf" &&
    attachment.imageDataUrl &&
    (await pdfHasImageOnlyContent(attachment, deps))
  ) {
    const summary = await (deps?.summarizePdfAttachment ?? summarizePdfAttachment)(attachment);
    return {
      ...attachment,
      text: mergeObservationText(attachment.text, summary),
    };
  }

  return attachment;
}

async function fetchDriveLinkedAttachments(params: {
  attachments: StoredAttachment[];
  userIntent: string;
  deps?: AttachmentVisionDeps;
}): Promise<StoredAttachment[]> {
  if (!isDriveEnabled()) {
    return [];
  }

  const urls = [
    ...params.attachments.flatMap((attachment) => extractDriveUrls(attachment.text || "")),
    ...extractDriveUrls(params.userIntent),
  ];
  const uniqueFileIds = [...new Set(urls.map(extractDriveFileId).filter(Boolean))] as string[];

  if (uniqueFileIds.length === 0) {
    return [];
  }

  const linkedAttachments = await Promise.all(
    uniqueFileIds.map(async (fileId, index) => {
      try {
        const downloaded = params.deps?.downloadLinkedFile
          ? {
              buffer: Buffer.from(await params.deps.downloadLinkedFile(fileId)),
              name: `drive-linked-${index + 1}`,
              mimeType: null,
            }
          : await downloadDriveFile(fileId);
        const buffer = downloaded.buffer;
        const filename = downloaded.name || `drive-linked-${index + 1}`;
        const mimeType = downloaded.mimeType || inferMimeType(filename);
        const preview = await extractPreviewDataFromBuffer({
          buffer,
          mimeType,
          filename,
        });
        const imageDataUrl = mimeType.startsWith("image/")
          ? bufferToReusableDataUrl({
              buffer,
              mimeType,
            })
          : undefined;
        const baseAttachment: StoredAttachment = {
          id: `drive:${index + 1}:${fileId}`,
          filename,
          type: mimeType,
          text: mergeObservationText(
            preview.text,
            `Drive-linked document source: ${fileId}`
          ),
          imageDataUrl,
          pageCount: preview.pageCount,
        };
        const normalized = await normalizeStoredAttachment(baseAttachment, params.deps);

        return {
          ...normalized,
          text: mergeObservationText(
            normalized.text,
            "Provenance: Drive-linked external document"
          ),
        };
      } catch (error) {
        console.error("[drive] external lookup failed (non-blocking)", {
          fileId,
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

  if (
    !isOpenAiVisionCompatibleImage({
      mime: attachment.type,
      imageDataUrl: attachment.imageDataUrl,
    })
  ) {
    return "";
  }

  try {
    logCollisionIqModelDiagnostic({
      stage: "analysis_image_attachment_summary",
      provider: "anthropic",
      role: "anthropicPrimary",
      model: collisionIqModels.anthropicPrimary,
    });
    const response = await generatePrimaryText({
      stage: "analysis_image_attachment_summary",
      effort: "medium",
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
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
              type: "input_image" as const,
              image_url: attachment.imageDataUrl,
              detail: "auto" as const,
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

/**
 * Page by page: any page that is an image (hasImageOnlyPage). The stored
 * attachment keeps no per-page counts, so the PDF it carries is probed here.
 * A PDF that cannot be probed falls back to the document average.
 */
async function pdfHasImageOnlyContent(attachment: StoredAttachment, deps?: AttachmentVisionDeps) {
  try {
    const base64 = (attachment.imageDataUrl ?? "").split(",", 2)[1] ?? "";
    const buffer = Buffer.from(base64, "base64");
    const pages = await (deps?.profilePdfPages ?? (async (bytes: Buffer) => (await probePdfTextLayer(bytes)).pages))(buffer);
    if (pages.length > 0) return hasImageOnlyPage(pages);
  } catch {
    // Unreadable bytes say nothing about the pages; use the text average.
  }
  return isSparsePdfText(attachment.text, attachment.pageCount);
}

async function summarizePdfAttachment(attachment: StoredAttachment) {
  if (!attachment.imageDataUrl || attachment.type !== "application/pdf") {
    return "";
  }
  // OpenClaw receives its input as JSON text, so a PDF would arrive as a
  // base64 string rather than a document; only Claude reads it natively.
  if (collisionIqProvider.primary === "openclaw") {
    return "";
  }

  try {
    const response = await generatePrimaryText({
      stage: "analysis_pdf_attachment_summary",
      effort: "medium",
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: `Review this PDF as a collision-repair source document.

Focus on the first page, totals page, photo/screenshot-heavy pages, and any low-text pages that still carry meaningful visual information.

Return concise plain text only with these labels:
- Document type:
- Key visible estimate facts:
- Visible damage/photo observations:
- Comparison or screenshot cues:
- Structural cues:
- Readable totals/support:

Only include grounded observations from the PDF. Do not claim hidden damage from photos alone; phrase it as an open verification concern.`,
            },
            {
              type: "input_file" as const,
              filename: attachment.filename,
              file_data: attachment.imageDataUrl,
            },
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
