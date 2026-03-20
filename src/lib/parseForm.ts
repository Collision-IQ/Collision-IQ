// src/lib/parseForm.ts

import { IncomingForm, File } from 'formidable';
import { Readable } from 'stream';

export type ParsedFiles = {
  files: File[];
};

type FormidableRequestLike = Readable & {
  headers: Record<string, string>;
  method?: string;
};

export function parseForm(req: Request): Promise<ParsedFiles> {
  return new Promise(async (resolve, reject) => {
    const form = new IncomingForm({
      multiples: true,
      keepExtensions: true,
    });

    // Convert Web Request → Node stream (required for formidable)
    const buffer = Buffer.from(await req.arrayBuffer());
    const stream = Readable.from(buffer) as FormidableRequestLike;

    stream.headers = Object.fromEntries(req.headers.entries());
    stream.method = req.method;

    form.parse(stream as unknown as Parameters<typeof form.parse>[0], (err, _fields, files) => {
      if (err) return reject(err);

      const uploaded =
        Array.isArray(files.files)
          ? files.files
          : files.files
          ? [files.files]
          : [];

      resolve({ files: uploaded });
    });
  });
}
