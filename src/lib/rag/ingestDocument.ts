import { embedTexts } from "@/lib/rag/embed";
import { extractMetadata } from "@/lib/rag/metadata";
import { procedureChunk } from "@/lib/rag/procedureChunk";
import { upsertChunks } from "@/lib/rag/upsert";

export async function ingestDocument(params: {
  fileId: string;
  text: string;
  path: string;
  modifiedTime: string;
  sourceType: "google" | "onedrive1" | "onedrive2";
}) {
  const { fileId, text, path, modifiedTime, sourceType } = params;
  const rawChunks = procedureChunk(text);

  if (!rawChunks.length) {
    return 0;
  }

  const embeddings = await embedTexts(
    rawChunks.map((chunk) => (typeof chunk === "string" ? chunk : chunk.text))
  );

  const chunks = rawChunks
    .map((chunk, index) => {
      const chunkText = typeof chunk === "string" ? chunk : chunk.text;
      const embedding = embeddings[index];

      if (!embedding?.length) {
        return null;
      }

      const metadata = extractMetadata({
        text: chunkText,
        drivePath: path,
      });

      return {
        chunkIndex: index,
        content: chunkText,
        embedding,
        ...metadata,
      };
    })
    .filter(
      (
        chunk
      ): chunk is {
        chunkIndex: number;
        content: string;
        embedding: number[];
        system: string | null;
        component: string | null;
        procedure: string | null;
        docType?: string | null;
        authority?: number | null;
      } => Boolean(chunk)
    );

  if (!chunks.length) {
    return 0;
  }

  await upsertChunks({
    sourceType,
    driveFileId: fileId,
    drivePath: path,
    modifiedTime,
    chunks,
  });

  return chunks.length;
}
