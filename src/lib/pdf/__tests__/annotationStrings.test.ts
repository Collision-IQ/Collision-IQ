import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream } from "pdf-lib";

/**
 * The defect these lock down shipped in a real report and reached recipients.
 *
 * pdf-lib ships a CJS and an ESM build. Importing values from "pdf-lib" and
 * from "pdf-lib/cjs/core" puts two copies of every class in one bundle, and
 * PDFContext.obj() dispatches on `instanceof PDFObject` — false across module
 * instances. Every annotation string was consequently written as
 * `<< /value /FEFF... >>`, a dictionary containing a name, where the spec
 * requires a string object. Acrobat reads /Contents on a markup annotation
 * when the file opens and refuses the document: "Expected a string object."
 *
 * Under Node both specifiers resolve to the same build, so no test could see
 * it. What IS testable is the invariant the writer depends on, and the shape
 * of the output when it does not hold.
 */

/** Any dictionary whose only key is /value is a PDF object that was
 *  serialized by walking a class instance's fields instead of being written
 *  as itself. That is the fingerprint of the cross-instance bug. */
function countMisSerializedStrings(pdf: PDFDocument): number {
  let found = 0;
  const walk = (obj: unknown, depth: number): void => {
    if (depth > 6 || !(obj instanceof PDFDict)) return;
    const keys = obj.keys().map((key) => key.toString());
    if (keys.length === 1 && keys[0] === "/value") {
      found += 1;
      return;
    }
    for (const key of obj.keys()) walk(obj.get(key), depth + 1);
  };
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && !(obj instanceof PDFRawStream)) walk(obj, 0);
  }
  return found;
}

describe("annotation string entries", () => {
  it("writes a string object, not a dictionary, for a PDF string value", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const dict = pdf.context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      Contents: PDFHexString.fromText("Finding #1: missing operation"),
      T: PDFHexString.fromText("Collision IQ"),
      P: page.ref,
    });

    // The entry must be the string itself. When the writer cannot recognise
    // the class it recurses into the instance and emits a dictionary instead.
    expect(dict.get(PDFName.of("Contents"))).toBeInstanceOf(PDFHexString);
    expect(dict.get(PDFName.of("Contents"))).not.toBeInstanceOf(PDFDict);
  });

  it("produces a document with no mis-serialized strings", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const annot = pdf.context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      Rect: [0, 0, 10, 10],
      Contents: PDFHexString.fromText("comment"),
      NM: PDFHexString.fromText("id-1"),
      M: PDFHexString.fromText("D:20260902145709Z"),
      P: page.ref,
    });
    page.node.set(PDFName.of("Annots"), pdf.context.obj([pdf.context.register(annot)]));
    const reloaded = await PDFDocument.load(await pdf.save());

    expect(countMisSerializedStrings(reloaded)).toBe(0);
  });

  it("recognises the broken shape, so this check cannot pass vacuously", async () => {
    // Reproduce what the two-instance bundle produced: the string written as
    // the fields of an object rather than as a string.
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const annot = pdf.context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      Contents: { value: "FEFF0046" },
      P: page.ref,
    });
    page.node.set(PDFName.of("Annots"), pdf.context.obj([pdf.context.register(annot)]));
    const reloaded = await PDFDocument.load(await pdf.save());

    expect(countMisSerializedStrings(reloaded)).toBeGreaterThan(0);
  });
});
