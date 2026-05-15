declare module "pdf-parse" {
  type PdfParseResult = {
    text: string;
    numpages?: number;
    info?: unknown;
    metadata?: unknown;
    version?: string;
  };

  function pdfParse(
    data: Buffer | Uint8Array | ArrayBuffer,
    options?: unknown
  ): Promise<PdfParseResult>;

  export default pdfParse;
}
