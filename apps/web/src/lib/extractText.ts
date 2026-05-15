// src/lib/extractText.ts

import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';

export async function extractTextFromFile(
  filepath: string,
  mimetype: string
): Promise<string> {
  const buffer = await fs.readFile(filepath);

  // ---- PDF ----
  if (mimetype === 'application/pdf') {
    const result = await pdfParse(buffer);
    return result.text || '';
  }

  // ---- Images (OCR) ----
  if (
    mimetype === 'image/png' ||
    mimetype === 'image/jpeg' ||
    mimetype === 'image/jpg'
  ) {
    const result = await Tesseract.recognize(buffer, 'eng');
    return result.data.text || '';
  }

  // ---- Unsupported ----
  return '';
}
