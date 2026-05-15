import vision from "@google-cloud/vision";

const client = new vision.ImageAnnotatorClient();

export async function extractImageText(buffer: Buffer): Promise<string> {
  try {
    const [result] = await client.textDetection({
      image: { content: buffer }
    });

    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      return "";
    }

    return detections[0].description || "";
  } catch (err) {
    console.error("OCR failed:", err);
    return "";
  }
}