import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPastedImageName,
  extractPastedImageFiles,
  hasMeaningfulClipboardText,
} from "@/components/chatWidget/attachmentUtils";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const NOW = new Date(2026, 8, 1, 10, 5, 30); // 2026-09-01 10:05:30 local

function imageFile(name: string, type = "image/png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("screenshot paste intake", () => {
  it("attaches a pasted screenshot", () => {
    const files = extractPastedImageFiles({ files: [imageFile("image.png")], plainText: "" }, NOW);
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe("image/png");
  });

  it("gives generically-named clipboard bitmaps a unique timestamped name", () => {
    const files = extractPastedImageFiles({ files: [imageFile("image.png")], plainText: "" }, NOW);
    expect(files[0].name).toBe("screenshot-2026-09-01-100530.png");
  });

  it("keeps multiple pasted images distinguishable", () => {
    const files = extractPastedImageFiles(
      { files: [imageFile("image.png"), imageFile("image.png")], plainText: "" },
      NOW
    );
    expect(files.map((file) => file.name)).toEqual([
      "screenshot-2026-09-01-100530.png",
      "screenshot-2026-09-01-100530-2.png",
    ]);
  });

  it("treats an empty filename as generic", () => {
    const files = extractPastedImageFiles({ files: [imageFile("")], plainText: "" }, NOW);
    expect(files[0].name).toBe("screenshot-2026-09-01-100530.png");
  });

  it("preserves a real filename when an actual image file is pasted", () => {
    const files = extractPastedImageFiles(
      { files: [imageFile("rear-bumper-damage.jpg", "image/jpeg")], plainText: "" },
      NOW
    );
    expect(files[0].name).toBe("rear-bumper-damage.jpg");
  });

  it("preserves the file's bytes and type when renaming", async () => {
    const original = imageFile("image.png");
    const [renamed] = extractPastedImageFiles({ files: [original], plainText: "" }, NOW);
    expect(renamed.type).toBe("image/png");
    expect(renamed.size).toBe(original.size);
    expect(new Uint8Array(await renamed.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("not hijacking ordinary pastes", () => {
  it("ignores a plain text paste", () => {
    expect(extractPastedImageFiles({ files: [], plainText: "RO 22108" }, NOW)).toEqual([]);
  });

  it("ignores a paste carrying both text and a bitmap", () => {
    // Excel, Word and Outlook put BOTH on the clipboard. Attaching on
    // image-presence alone would staple a screenshot to every copied cell.
    const files = extractPastedImageFiles(
      { files: [imageFile("image.png")], plainText: "Labor\t2.5\tRefinish" },
      NOW
    );
    expect(files).toEqual([]);
  });

  it("ignores whitespace-only text as not meaningful", () => {
    expect(hasMeaningfulClipboardText("   \n\t ")).toBe(false);
    expect(extractPastedImageFiles({ files: [imageFile("image.png")], plainText: "  " }, NOW)).toHaveLength(1);
  });

  it("ignores a pasted non-image file", () => {
    const pdf = new File([new Uint8Array([1])], "estimate.pdf", { type: "application/pdf" });
    expect(extractPastedImageFiles({ files: [pdf], plainText: "" }, NOW)).toEqual([]);
  });

  it("selects only the images out of a mixed clipboard", () => {
    const pdf = new File([new Uint8Array([1])], "estimate.pdf", { type: "application/pdf" });
    const files = extractPastedImageFiles({ files: [pdf, imageFile("image.png")], plainText: "" }, NOW);
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe("image/png");
  });
});

describe("naming", () => {
  it("maps vision-capable types to their conventional extension", () => {
    expect(buildPastedImageName("image/jpeg", NOW, 0)).toMatch(/\.jpg$/);
    expect(buildPastedImageName("image/webp", NOW, 0)).toMatch(/\.webp$/);
    expect(buildPastedImageName("image/gif", NOW, 0)).toMatch(/\.gif$/);
  });

  it("falls back to a sanitized subtype for unusual image types", () => {
    expect(buildPastedImageName("image/svg+xml", NOW, 0)).toMatch(/\.svgxml$/);
    expect(buildPastedImageName("image/", NOW, 0)).toMatch(/\.png$/);
  });

  it("zero-pads so names sort chronologically", () => {
    expect(buildPastedImageName("image/png", new Date(2026, 0, 5, 9, 3, 7), 0)).toBe(
      "screenshot-2026-01-05-090307.png"
    );
  });
});

describe("composer wiring", () => {
  const widget = read("src/components/ChatWidget.tsx");

  it("binds paste on the composer textarea", () => {
    expect(widget).toMatch(/onPaste=\{handleComposerPaste\}/);
  });

  it("routes pasted images through the same intake as drag-drop and the picker", () => {
    const handler = widget.slice(
      widget.indexOf("function handleComposerPaste"),
      widget.indexOf("function removeAttachment")
    );
    expect(handler).toMatch(/handleFilesSelected\(pastedImages\)/);
    // Same guards as the drop handler, so plan limits still apply.
    expect(handler).toMatch(/if \(disabled \|\| uploadLimitsLoading\) return;/);
  });

  it("falls back to clipboard items when files is empty", () => {
    const handler = widget.slice(
      widget.indexOf("function handleComposerPaste"),
      widget.indexOf("function removeAttachment")
    );
    expect(handler).toMatch(/clipboardData\.items/);
    expect(handler).toMatch(/getAsFile\(\)/);
  });

  it("only consumes the event when an image is actually attached", () => {
    const handler = widget.slice(
      widget.indexOf("function handleComposerPaste"),
      widget.indexOf("function removeAttachment")
    );
    expect(handler.indexOf("if (!pastedImages.length) return;")).toBeLessThan(
      handler.indexOf("event.preventDefault();")
    );
  });
});
