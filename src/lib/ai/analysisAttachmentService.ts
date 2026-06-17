import { collisionIqModels } from "@/lib/modelConfig";
import { openai } from "@/lib/openai";
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

type AttachmentVisionDeps = {
  summarizeImageAttachment?: (attachment: StoredAttachment) => Promise<string>;
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
