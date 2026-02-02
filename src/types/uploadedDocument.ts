// src/types/uploadedDocument.ts

export type UploadedDocument = {
  filename: string;
  type: string;   // MIME type (e.g. application/pdf, image/png)
  text: string;   // extracted plaintext (may be truncated)
};
