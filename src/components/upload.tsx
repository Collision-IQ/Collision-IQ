import { NextRequest, NextResponse } from 'next/server';
import { IncomingForm, Files } from 'formidable';
import fs from 'fs';
import { promisify } from 'util';
import { extractTextFromFile } from '@/lib/extract-text';
import { OpenAIEmbeddings } from '@langchain/openai';
import path from 'path';

export const config = {
  api: {
    bodyParser: false,
  },
};

type ParseResult = { fields: any; files: Files };

function parseForm(req: NextRequest): Promise<ParseResult> {
  const form = new IncomingForm({
    keepExtensions: true,
    multiples: true,
    uploadDir: '/tmp',
  });

  return new Promise((resolve, reject) => {
    form.parse(req as any, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function splitIntoChunks(text: string, maxTokens = 1000): string[] {
  const sentences = text.split(/(?<=[.?!])\s+/);
  const chunks: string[] = [];
  let chunk = '';

  for (const sentence of sentences) {
    if ((chunk + sentence).split(' ').length > maxTokens) {
      chunks.push(chunk.trim());
      chunk = sentence;
    } else {
      chunk += ' ' + sentence;
    }
  }

  if (chunk.trim()) chunks.push(chunk.trim());
  return chunks;
}

async function embedChunks(chunks: string[]) {
  const embedder = new OpenAIEmbeddings();
  return await embedder.embedDocuments(chunks);
}

export async function POST(req: NextRequest) {
  try {
    const { files } = await parseForm(req);

    if (!files || !files.file) {
      return NextResponse.json({ error: 'No files uploaded' }, { status: 400 });
    }

    const uploaded = Array.isArray(files.file) ? files.file : [files.file];
    const results: any[] = [];

    for (const file of uploaded) {
      const filepath = (file as any).filepath || (file as any).path;
      const mimetype = (file as any).mimetype || (file as any).type;
      const originalFilename = (file as any).originalFilename || path.basename(filepath);

      const text = await extractTextFromFile(filepath, mimetype);
      const chunks = splitIntoChunks(text, 1000);
      const embeddings = await embedChunks(chunks);

      results.push({
        filename: originalFilename,
        chunks: chunks.length,
        embedded: embeddings.length,
      });
    }

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    console.error('Upload error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
