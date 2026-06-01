import { describe, expect, it } from "vitest";
import { isOpenAiVisionCompatibleImage } from "@/lib/ai/openAiVisionInput";

describe("isOpenAiVisionCompatibleImage", () => {
  it("returns false for HEIC images", () => {
    expect(
      isOpenAiVisionCompatibleImage({
        mime: "image/heic",
        imageDataUrl: "data:image/heic;base64,AAA=",
      })
    ).toBe(false);
  });

  it("returns false for HEIF images", () => {
    expect(
      isOpenAiVisionCompatibleImage({
        mime: "image/heif",
        imageDataUrl: "data:image/heif;base64,AAA=",
      })
    ).toBe(false);
  });

  it("returns true for JPEG images", () => {
    expect(
      isOpenAiVisionCompatibleImage({
        mime: "image/jpeg",
        imageDataUrl: "data:image/jpeg;base64,AAA=",
      })
    ).toBe(true);
  });

  it("returns false for PDFs", () => {
    expect(
      isOpenAiVisionCompatibleImage({
        mime: "application/pdf",
        imageDataUrl: "data:application/pdf;base64,AAA=",
      })
    ).toBe(false);
  });

  it("handles mixed attachment eligibility", () => {
    const attachments = [
      { mime: "image/heic", imageDataUrl: "data:image/heic;base64,AAA=" },
      { mime: "image/jpeg", imageDataUrl: "data:image/jpeg;base64,AAA=" },
      { mime: "application/pdf", imageDataUrl: "data:application/pdf;base64,AAA=" },
      { mime: "image/png", imageDataUrl: "data:image/png;base64,AAA=" },
    ];

    const eligible = attachments.filter((attachment) =>
      isOpenAiVisionCompatibleImage(attachment)
    );

    expect(eligible).toHaveLength(2);
    expect(eligible.map((attachment) => attachment.mime)).toEqual([
      "image/jpeg",
      "image/png",
    ]);
  });

  it("prefers data URL mime when available", () => {
    expect(
      isOpenAiVisionCompatibleImage({
        mime: "image/heic",
        imageDataUrl: "data:image/jpeg;base64,AAA=",
      })
    ).toBe(true);
  });
});
