#!/usr/bin/env node
/* eslint-disable no-console, @typescript-eslint/no-require-imports */
//
// Re-embed all document_chunks with the current Voyage model, repopulating the
// embedding column from the existing content. Idempotent + resumable: it only
// touches rows whose embedding IS NULL, so it can be re-run after an interrupt.
//
// PREREQUISITE: run scripts/rag/01-migrate-embedding-1024.sql first (it clears
// old 1536-dim vectors and retypes the column to vector(1024)). This script
// aborts if the column dimension does not match the Voyage output dimension.
//
// Reads DATABASE_URL and VOYAGE_API_KEY from .env.local / .env (or the shell).
// Usage:  node scripts/rag/reembed-chunks-voyage.cjs
// Tunables: REEMBED_BATCH (default 100), REEMBED_DELAY_MS (default 200)

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const cwd = process.cwd();

// ── Load env from .env.local then .env (do not override the shell) ────────────
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
loadEnvFile(path.join(cwd, ".env.local"));
loadEnvFile(path.join(cwd, ".env"));

// ── @/ alias + on-the-fly TS compilation so we can reuse the app modules ──────
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWithAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(cwd, "src", request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
require.extensions[".ts"] = function compileTsModule(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const { prisma } = require(path.join(cwd, "src/lib/prisma.ts"));
const { embedTexts } = require(path.join(cwd, "src/lib/rag/embed.ts"));

const BATCH = Math.max(1, Number(process.env.REEMBED_BATCH || 100));
const DELAY_MS = Math.max(0, Number(process.env.REEMBED_DELAY_MS || 200));

function toVectorLiteral(embedding) {
  return `[${embedding.map((n) => (Number.isFinite(n) ? n : 0)).join(",")}]`;
}

async function readColumnDimension() {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT format_type(a.atttypid, a.atttypmod) AS t
       FROM pg_attribute a
       WHERE a.attrelid = 'document_chunks'::regclass AND a.attname = 'embedding'`
    );
    const m = /vector\((\d+)\)/i.exec(rows[0]?.t ?? "");
    return m ? Number(m[1]) : null; // null => unbounded "vector" (any dim ok)
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.VOYAGE_API_KEY?.trim()) {
    console.error("VOYAGE_API_KEY is not set. Aborting.");
    process.exit(1);
  }

  // Probe: confirm the embedder works and learn its output dimension.
  const probe = await prisma.$queryRawUnsafe(
    `SELECT content FROM document_chunks WHERE content IS NOT NULL AND btrim(content) <> '' LIMIT 1`
  );
  if (!probe.length) {
    console.log("No chunks with content found — nothing to embed.");
    await prisma.$disconnect();
    return;
  }
  const [probeEmbedding] = await embedTexts([probe[0].content]);
  if (!probeEmbedding || !probeEmbedding.length) {
    console.error("Voyage returned an empty embedding. Check VOYAGE_API_KEY / VOYAGE_EMBED_MODEL. Aborting.");
    process.exit(1);
  }
  const embedDim = probeEmbedding.length;
  const columnDim = await readColumnDimension();
  console.log(`Voyage output dimension: ${embedDim}; embedding column dimension: ${columnDim ?? "unbounded"}`);
  if (columnDim !== null && columnDim !== embedDim) {
    console.error(
      `Column is vector(${columnDim}) but Voyage produces ${embedDim}-dim vectors. ` +
        `Run scripts/rag/01-migrate-embedding-1024.sql first. Aborting.`
    );
    process.exit(1);
  }

  let total = 0;
  for (;;) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, content
       FROM document_chunks
       WHERE embedding IS NULL AND content IS NOT NULL AND btrim(content) <> ''
       ORDER BY id
       LIMIT ${BATCH}`
    );
    if (!rows.length) break;

    const embeddings = await embedTexts(rows.map((r) => r.content));
    let updated = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const embedding = embeddings[i];
      if (!embedding || !embedding.length) continue;
      await prisma.$executeRawUnsafe(
        `UPDATE document_chunks SET embedding = $1 WHERE id = $2`,
        toVectorLiteral(embedding),
        rows[i].id
      );
      updated += 1;
      total += 1;
    }
    console.log(`batch: updated ${updated}/${rows.length} (total ${total})`);
    if (updated === 0) {
      console.error("A full batch produced no embeddings — aborting to avoid an infinite loop.");
      break;
    }
    if (DELAY_MS) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  console.log(`Done. Re-embedded ${total} chunks.`);
  console.log("Next: (re)create the ANN index — see step 4 in 01-migrate-embedding-1024.sql.");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("[reembed] failed:", error instanceof Error ? error.message : String(error));
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
