/* eslint-disable @typescript-eslint/no-require-imports */
// Stall guard for the direct browser→blob upload: on CORS-blocked mobile
// environments the blob client retries PUTs without its promise settling, so
// the catch-based chunked-relay fallback never fired and uploads sat at
// UPLOADING forever. These tests pin the watchdog: no progress → abort +
// reject (fallback runs); steady progress → never trips; finish() disarms.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilenameWithAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const absolute = path.join(process.cwd(), "src", request.slice(2));
    return originalResolveFilename.call(this, absolute, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function registerTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const { createUploadStallGuard, uploadFileViaChunkedRelay } = require("./chunkedBlobUpload.ts");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  let passed = 0;
  let failed = 0;
  async function run(name, fn) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL - ${name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }

  await run("a hung upload with no progress trips the guard and aborts", async () => {
    const guard = createUploadStallGuard(60);
    const hungUpload = new Promise(() => {}); // never settles (CORS retry loop)
    await assert.rejects(
      Promise.race([hungUpload, guard.stalled]),
      /no progress .*falling back to the chunked relay/i
    );
    assert.equal(guard.abortSignal.aborted, true, "transfer is aborted");
    guard.finish();
  });

  await run("steady progress keeps resetting the timer — slow uploads survive", async () => {
    const guard = createUploadStallGuard(80);
    let stalledFired = false;
    guard.stalled.catch(() => {
      stalledFired = true;
    });
    // Simulate a slow but live transfer: progress every 30ms for ~4 windows.
    for (let tick = 0; tick < 10; tick += 1) {
      await sleep(30);
      guard.onUploadProgress();
    }
    assert.equal(stalledFired, false, "guard never tripped while bytes moved");
    assert.equal(guard.abortSignal.aborted, false);
    guard.finish();
  });

  await run("finish() disarms the guard so completed uploads never reject later", async () => {
    const guard = createUploadStallGuard(40);
    guard.stalled.catch(() => {
      throw new Error("guard fired after finish()");
    });
    guard.finish();
    await sleep(90);
    assert.equal(guard.abortSignal.aborted, false);
  });

  await run("relay mints FRESH auth headers for every request (init/chunks/assemble)", async () => {
    // Clerk tokens expire after ~60s; a static Authorization header captured
    // before the 30s stall goes stale mid-relay and the route 401s with
    // "No authenticated Clerk session was found for this request".
    const seenAuth = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      seenAuth.push(init?.headers?.Authorization ?? null);
      const target = String(url);
      const json = (body) => ({ ok: true, status: 200, json: async () => body });
      if (target.includes("action=init")) {
        return json({ sessionId: "test-session-1234", chunkBytes: 4, totalChunks: 2 });
      }
      if (target.includes("action=chunk")) return json({});
      if (target.includes("action=assemble")) {
        return json({
          url: "https://blob/x",
          downloadUrl: "https://blob/x?sig",
          pathname: "uploads/x",
          contentType: "image/jpeg",
        });
      }
      throw new Error(`unexpected fetch: ${target}`);
    };
    try {
      let mint = 0;
      const file = new File([new Uint8Array(8)], "photo.jpg", { type: "image/jpeg" });
      const result = await uploadFileViaChunkedRelay(file, {
        headers: { Authorization: "Bearer stale-static" },
        getHeaders: async () => ({ Authorization: `Bearer fresh-${(mint += 1)}` }),
      });
      assert.equal(result.pathname, "uploads/x");
      // init + 2 chunks + assemble = 4 requests, each with its own fresh mint.
      assert.deepEqual(seenAuth, [
        "Bearer fresh-1",
        "Bearer fresh-2",
        "Bearer fresh-3",
        "Bearer fresh-4",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await run("relay still works with static headers when getHeaders is not provided", async () => {
    const seenAuth = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      seenAuth.push(init?.headers?.Authorization ?? null);
      const target = String(url);
      const json = (body) => ({ ok: true, status: 200, json: async () => body });
      if (target.includes("action=init")) {
        return json({ sessionId: "test-session-1234", chunkBytes: 8, totalChunks: 1 });
      }
      if (target.includes("action=chunk")) return json({});
      return json({ url: "u", downloadUrl: "d", pathname: "p", contentType: "c" });
    };
    try {
      const file = new File([new Uint8Array(8)], "doc.pdf", { type: "application/pdf" });
      await uploadFileViaChunkedRelay(file, { headers: { Authorization: "Bearer static" } });
      assert.deepEqual(seenAuth, ["Bearer static", "Bearer static", "Bearer static"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log(`\nchunkedBlobUpload: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
