/**
 * U-4 text-layer reliability: which fonts genuinely break the text stream.
 *
 * RO 22140 (2025 Polestar 3) is the case this protects. Its SOR-2 prints
 * every one of its 196 line items and a totals block that reconciles to the
 * penny, but its fonts are non-embedded /ArialMT and /Arial-BoldMT with no
 * ToUnicode map. Reading that as a broken encoding capped extraction
 * confidence at 0.45, sent a perfectly readable document through the
 * glyph-repair fallback, and left the build reporting 24% coverage with the
 * delta marks suppressed. WinAnsiEncoding defines the code→character mapping
 * on its own; the absence of a ToUnicode map says nothing by itself.
 */

import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { assessPdfTextLayerReliability } from "../citationDensityRowAnchors";

type FontSpec = {
  subtype: string;
  baseFont: string;
  /** A base-encoding name, or a dict body for /Differences cases. */
  encoding?: string | Record<string, unknown>;
  toUnicode?: boolean;
  embedded?: boolean;
};

/** A one-page PDF whose only content is the font dictionaries under test. */
async function pdfWithFonts(fonts: FontSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const entries: Record<string, unknown> = {};

  fonts.forEach((spec, index) => {
    const font: Record<string, unknown> = {
      Type: "Font",
      Subtype: spec.subtype,
      BaseFont: spec.baseFont,
    };
    if (spec.encoding !== undefined) font.Encoding = spec.encoding;
    if (spec.embedded) {
      // Only the presence of a FontFile matters to the check, not its bytes.
      font.FontDescriptor = { Type: "FontDescriptor", FontName: spec.baseFont, FontFile2: {} };
    }
    if (spec.toUnicode) font.ToUnicode = {};
    entries[`F${index}`] = doc.context.register(doc.context.obj(font));
  });

  const resources = page.node.Resources();
  if (!resources) throw new Error("page has no Resources dictionary");
  resources.set(PDFName.of("Font"), doc.context.obj(entries));
  return doc.save();
}

describe("assessPdfTextLayerReliability", () => {
  it("trusts a non-embedded font that declares WinAnsiEncoding (RO 22140 SOR-2)", async () => {
    const bytes = await pdfWithFonts([
      { subtype: "TrueType", baseFont: "ArialMT", encoding: "WinAnsiEncoding" },
      { subtype: "TrueType", baseFont: "Arial-BoldMT", encoding: "WinAnsiEncoding" },
    ]);
    expect(await assessPdfTextLayerReliability(bytes)).toEqual({ reliable: true });
  });

  it.each(["MacRomanEncoding", "StandardEncoding", "MacExpertEncoding"])(
    "trusts a non-embedded font under %s",
    async (encoding) => {
      const bytes = await pdfWithFonts([{ subtype: "Type1", baseFont: "SomeVendorFont", encoding }]);
      expect((await assessPdfTextLayerReliability(bytes)).reliable).toBe(true);
    }
  );

  it("still flags a non-embedded font with no encoding and no ToUnicode map", async () => {
    const bytes = await pdfWithFonts([{ subtype: "TrueType", baseFont: "PeerNetPrinterFont" }]);
    const result = await assessPdfTextLayerReliability(bytes);
    expect(result.reliable).toBe(false);
    expect(result.reason).toContain("PeerNetPrinterFont");
  });

  it("still flags a non-embedded Type0 font, whose codes are glyph indices", async () => {
    const bytes = await pdfWithFonts([
      { subtype: "Type0", baseFont: "BrokenSubset+Custom", encoding: "Identity-H" },
    ]);
    expect((await assessPdfTextLayerReliability(bytes)).reliable).toBe(false);
  });

  it("does not let a Type0 font borrow a simple base encoding", async () => {
    // Nonsensical in a real producer, but it is what a naive encoding check
    // would wave through: the guard must key on Subtype, not on the name.
    const bytes = await pdfWithFonts([
      { subtype: "Type0", baseFont: "Custom-Identity", encoding: "WinAnsiEncoding" },
    ]);
    expect((await assessPdfTextLayerReliability(bytes)).reliable).toBe(false);
  });

  it("trusts an encoding dictionary whose BaseEncoding is known", async () => {
    const bytes = await pdfWithFonts([
      {
        subtype: "TrueType",
        baseFont: "ArialMT",
        encoding: {
          Type: "Encoding",
          BaseEncoding: "WinAnsiEncoding",
          Differences: [128, "Euro", "trademark"],
        },
      },
    ]);
    expect((await assessPdfTextLayerReliability(bytes)).reliable).toBe(true);
  });

  it("flags an encoding dictionary that remaps codes to opaque glyph names", async () => {
    // /g17 names a glyph in a program we do not have; the base encoding no
    // longer tells us what those codes mean.
    const bytes = await pdfWithFonts([
      {
        subtype: "TrueType",
        baseFont: "SubsetVendorFont",
        encoding: {
          Type: "Encoding",
          BaseEncoding: "WinAnsiEncoding",
          Differences: [32, "g17", "g18"],
        },
      },
    ]);
    expect((await assessPdfTextLayerReliability(bytes)).reliable).toBe(false);
  });

  it("flags an encoding dictionary with no BaseEncoding", async () => {
    const bytes = await pdfWithFonts([
      {
        subtype: "TrueType",
        baseFont: "UndefinedEncodingFont",
        encoding: { Type: "Encoding", Differences: [32, "space"] },
      },
    ]);
    expect((await assessPdfTextLayerReliability(bytes)).reliable).toBe(false);
  });

  it("keeps trusting embedded fonts and fonts carrying a ToUnicode map", async () => {
    const embedded = await pdfWithFonts([
      { subtype: "TrueType", baseFont: "AAAAAA+Tahoma", embedded: true },
    ]);
    expect((await assessPdfTextLayerReliability(embedded)).reliable).toBe(true);

    const mapped = await pdfWithFonts([
      { subtype: "Type0", baseFont: "AAAAAA+Tahoma", encoding: "Identity-H", toUnicode: true },
    ]);
    expect((await assessPdfTextLayerReliability(mapped)).reliable).toBe(true);
  });

  it("names every offending font in the reason, not just the first", async () => {
    const bytes = await pdfWithFonts([
      { subtype: "TrueType", baseFont: "BrokenOne" },
      { subtype: "TrueType", baseFont: "BrokenTwo" },
      { subtype: "TrueType", baseFont: "ArialMT", encoding: "WinAnsiEncoding" },
    ]);
    const result = await assessPdfTextLayerReliability(bytes);
    expect(result.reliable).toBe(false);
    expect(result.reason).toContain("BrokenOne");
    expect(result.reason).toContain("BrokenTwo");
    expect(result.reason).not.toContain("ArialMT");
  });
});
