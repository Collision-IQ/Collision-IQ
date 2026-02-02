// src/lib/parseForm.ts

import { IncomingForm, File } from 'formidable';
import { Readable } from 'stream';

export type ParsedFiles = {
  files: File[];
};

export function parseForm(req: Request): Promise<ParsedFiles> {
  return new Promise(async (resolve, reject) => {
    const form = new IncomingForm({
      multiples: true,
      keepExtensions: true,
    });

    // Convert Web Request → Node stream (required for formidable)
    const buffer = Buffer.from(await req.arrayBuffer());
    const stream = Readable.from(buffer) as any;

    stream.headers = Object.fromEntries(req.headers.entries());
    stream.method = req.method;

    form.parse(stream, (err, _fields, files) => {
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
