import { drive_v3 } from "googleapis";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import { cleanPdfText } from "../rag/cleantext";
import vision from "@google-cloud/vision";

const visionClient = new vision.ImageAnnotatorClient(); 

export async function extractDriveText(
  drive: drive_v3.Drive,
  file: drive_v3.Schema$File
) {
  const mime = file.mimeType || "";
  const id = file.id!;
  const name = file.name || "Untitled";

  try {
    // ------------------------------
    // Google Docs
    // ------------------------------
    if (mime === "application/vnd.google-apps.document") {
      const res = await drive.files.export(
        { fileId: id, mimeType: "text/plain" },
        { responseType: "text" }
      );

      return {
        ok: true as const,
        text: String(res.data || ""),
        kind: "gdoc" as const,
        name,
      };
    }

    // ------------------------------
    // PDF Files
    // ------------------------------
    if (mime === "application/pdf") {
      const res = await drive.files.get(
      { fileId: id, alt: "media" },
      { responseType: "arraybuffer" }
    );

    const buffer = Buffer.from(res.data as ArrayBuffer);

    const parsed = await pdf(buffer);

    if (!parsed.text || parsed.text.trim().length < 20) {
      console.log("PDF likely scanned:", name);

      return {
        ok: false as const,
        reason: "PDF text too short, may be scanned image",
        name,
      };
    }

    const cleaned = cleanPdfText(parsed.text);

      return {
        ok: true as const,
        text: cleaned,
        kind: "pdf" as const,
        name,
      };
    }

    // ------------------------------
    // DOCX Files
    // ------------------------------
    if (
      mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const res = await drive.files.get(
        { fileId: id, alt: "media" },
        { responseType: "arraybuffer" }
      );

      const buffer = Buffer.from(res.data as ArrayBuffer);
      const result = await mammoth.extractRawText({ buffer });

      return {
        ok: true as const,
        text: result.value,
        kind: "docx" as const,
        name,
      };
    }

    // ------------------------------
    // Plain Text
    // ------------------------------
    if (mime === "text/plain") {
      const res = await drive.files.get(
        { fileId: id, alt: "media" },
        { responseType: "text" }
      );

      return {
        ok: true as const,
        text: String(res.data || ""),
        kind: "text" as const,
        name,
      };
    }
    // ------------------------------
    // Image OCR (PNG / JPG)
    // ------------------------------
    if (
      mime === "image/png" ||
      mime === "image/jpeg" ||
      mime === "image/jpg"
    ) {
      const res = await drive.files.get(
        { fileId: id, alt: "media" },
        { responseType: "arraybuffer" }
      );

      const buffer = Buffer.from(res.data as ArrayBuffer);

      const [result] = await visionClient.textDetection({
        image: { content: buffer }
      });

      const detections = result.textAnnotations;

      const text = detections?.[0]?.description || "";

      if (!text.trim()) {
        return {
          ok: false as const,
          reason: "OCR returned empty text",
          name,
        };
      }

      return {
        ok: true as const,
        text,
        kind: "image-ocr" as const,
        name,
      };
    }
    // ------------------------------
    // Unsupported file type
    // ------------------------------
    return {
      ok: false as const,
      reason: `Unsupported mimeType: ${mime}`,
      name,
    };
  } catch (err) {
    return {
      ok: false as const,
      reason: `Extraction failed: ${(err as Error).message}`,
      name,
    };
  }
}