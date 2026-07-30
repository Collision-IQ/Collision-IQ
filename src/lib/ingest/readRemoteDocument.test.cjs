/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: RO 22047 — carrier-website links inside estimate boilerplate
// (bot-protected hosts) hung the analysis route for 74+ seconds per link because
// readRemoteDocument fetched with no timeout. Every remote fetch must give up
// within the configured budget and report a "failed" result instead of stalling.
const assert = require("node:assert/strict");
const http = require("node:http");
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

const {
  readRemoteDocument,
  getRemoteDocumentFetchTimeoutMs,
} = require("./readRemoteDocument.ts");

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

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

(async () => {
  await run("timeout is env-configurable with a bounded default", () => {
    delete process.env.LINKED_EVIDENCE_FETCH_TIMEOUT_MS;
    assert.equal(getRemoteDocumentFetchTimeoutMs(), 8000);
    process.env.LINKED_EVIDENCE_FETCH_TIMEOUT_MS = "250";
    assert.equal(getRemoteDocumentFetchTimeoutMs(), 250);
    process.env.LINKED_EVIDENCE_FETCH_TIMEOUT_MS = "not-a-number";
    assert.equal(getRemoteDocumentFetchTimeoutMs(), 8000);
  });

  await run("hanging host fails fast with a timeout note instead of stalling", async () => {
    // Server accepts the connection and never responds — the tarpit shape that
    // stalled the analysis route.
    const sockets = new Set();
    const server = http.createServer(() => { /* never respond */ });
    server.on("connection", (socket) => sockets.add(socket));
    const port = await listen(server);
    process.env.LINKED_EVIDENCE_FETCH_TIMEOUT_MS = "300";
    const startedAt = Date.now();
    const result = await readRemoteDocument(`http://127.0.0.1:${port}/claims`);
    const elapsedMs = Date.now() - startedAt;
    for (const socket of sockets) socket.destroy();
    server.close();
    assert.equal(result.status, "failed");
    assert.match(result.notes ?? "", /timed out after 300ms/);
    assert.ok(elapsedMs < 5000, `expected fast failure, took ${elapsedMs}ms`);
  });

  await run("slow BODY stream is also covered by the same budget", async () => {
    // Headers arrive immediately but the body drips forever — the timeout must
    // cover the arrayBuffer() read too, not just the header wait.
    const sockets = new Set();
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html><title>slow</title>");
      // keep the response open forever
    });
    server.on("connection", (socket) => sockets.add(socket));
    const port = await listen(server);
    process.env.LINKED_EVIDENCE_FETCH_TIMEOUT_MS = "300";
    const startedAt = Date.now();
    const result = await readRemoteDocument(`http://127.0.0.1:${port}/warranty`);
    const elapsedMs = Date.now() - startedAt;
    for (const socket of sockets) socket.destroy();
    server.close();
    assert.equal(result.status, "failed");
    assert.match(result.notes ?? "", /timed out after 300ms/);
    assert.ok(elapsedMs < 5000, `expected fast failure, took ${elapsedMs}ms`);
  });

  await run("healthy host still returns ok within the budget", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><title>Position Statement</title><body>OEM scan required</body></html>");
    });
    const port = await listen(server);
    process.env.LINKED_EVIDENCE_FETCH_TIMEOUT_MS = "2000";
    const result = await readRemoteDocument(`http://127.0.0.1:${port}/doc`);
    server.close();
    assert.equal(result.status, "ok");
    assert.equal(result.title, "Position Statement");
    assert.match(result.text, /OEM scan required/);
  });

  delete process.env.LINKED_EVIDENCE_FETCH_TIMEOUT_MS;
  console.log(`\nreadRemoteDocument: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
