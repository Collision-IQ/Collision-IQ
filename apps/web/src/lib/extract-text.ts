import fs from 'fs';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export async function extractTextFromFile(filepath: string, mimetype: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filepath);

  if (mimetype === 'application/pdf') {
    const data = await pdfParse(fileBuffer);
    return data.text;
  }

  if (
    mimetype ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    return result.value;
  }

  throw new Error(`Unsupported file type: ${mimetype}`);
}
