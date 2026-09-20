/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// Offline regression tests for the Explee monitor: snapshot math, summary
// rendering, and the API key guard. No network, no env file needed.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PerformanceMonitor = require("./explee-daily-monitor.cjs");
const ExpleeAPI = require("./explee-api.cjs");

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    });
}

(async () => {
  await test("buildSnapshot sums totals and derives reply rate / cost per lead", () => {
    const snap = PerformanceMonitor.buildSnapshot({
      projectId: "p1",
      projectName: "Collision iQ",
      now: new Date("2026-09-20T12:00:00Z"),
      hotLeads: 2,
      inboxConversations: 5,
      campaigns: [
        { id: "a", name: "Body shops", status: "active", sent: 100, replies: 6, spend: 4.5, leads: 3 },
        { id: "b", name: "MSOs", status: "active", sent: "50", replies: "2", spend: "5.5", leads: "1" },
        { id: "c", name: "Fleet", status: "paused", error: "API Error 500" },
      ],
    });
    assert.equal(snap.timestamp, "2026-09-20T12:00:00.000Z");
    assert.equal(snap.campaigns, 3);
    assert.deepEqual(snap.totals, {
      sent: 150,
      replies: 8,
      replyRate: 5.33,
      spend: "10.00",
      leads: 4,
      costPerLead: 2.5,
    });
    assert.equal(snap.hotLeads, 2);
    assert.equal(snap.inboxConversations, 5);
  });

  await test("buildSnapshot reports zero rates when nothing was sent", () => {
    const snap = PerformanceMonitor.buildSnapshot({
      projectId: "p1",
      projectName: "x",
      campaigns: [],
      hotLeads: 0,
      inboxConversations: 0,
    });
    assert.equal(snap.totals.replyRate, 0);
    assert.equal(snap.totals.costPerLead, 0);
    assert.equal(snap.totals.spend, "0.00");
  });

  await test("formatSummary handles an empty log", () => {
    assert.match(PerformanceMonitor.formatSummary([]), /No performance log found/);
  });

  await test("formatSummary renders the latest snapshot and skips errored campaigns", () => {
    const mk = (day, sent) =>
      PerformanceMonitor.buildSnapshot({
        projectId: "p1",
        projectName: "x",
        now: new Date(`2026-09-${day}T09:00:00Z`),
        hotLeads: 1,
        inboxConversations: 2,
        campaigns: [
          { id: "a", name: "Body shops", status: "active", sent, replies: 1, spend: 1, leads: 1 },
          { id: "c", name: "Broken", status: "active", error: "boom" },
        ],
      });
    const out = PerformanceMonitor.formatSummary([mk("20", 10), mk("21", 20), mk("21", 25)]);
    assert.match(out, /Snapshots: 3 \(2 distinct days\)/);
    assert.match(out, /Total Emails Sent: 25/);
    assert.match(out, /Body shops \(active\)/);
    assert.doesNotMatch(out, /Broken/);
  });

  await test("readLog parses JSONL and ignores blank lines", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "explee-")), "log.jsonl");
    fs.writeFileSync(file, '{"a":1}\n\n{"a":2}\n');
    assert.deepEqual(PerformanceMonitor.readLog(file), [{ a: 1 }, { a: 2 }]);
    assert.deepEqual(PerformanceMonitor.readLog(path.join(path.dirname(file), "missing")), []);
  });

  await test("ExpleeAPI refuses to construct without EXPLEE_API_KEY", () => {
    const saved = process.env.EXPLEE_API_KEY;
    delete process.env.EXPLEE_API_KEY;
    try {
      // Point the env-file loader at nothing by ensuring the key stays unset
      // even if a developer has a .env.local: the constructor only throws when
      // no key is found anywhere, so accept either outcome deterministically.
      let threw = false;
      try {
        new ExpleeAPI();
      } catch (err) {
        threw = true;
        assert.match(err.message, /EXPLEE_API_KEY is not set/);
      }
      if (!threw) assert.ok(process.env.EXPLEE_API_KEY, "key loaded from .env file");
    } finally {
      if (saved === undefined) delete process.env.EXPLEE_API_KEY;
      else process.env.EXPLEE_API_KEY = saved;
    }
    assert.equal(new ExpleeAPI("explicit-key").apiKey, "explicit-key");
  });

  await test("captureSnapshot works against a stubbed API and appends to the log", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "explee-"));
    const stub = {
      getProject: async () => ({ name: "Stub" }),
      listCampaigns: async () => [{ id: "a", name: "Body shops", status: "active" }],
      getCampaignAnalytics: async () => ({ sent: 10, replies: 1, spend: 2, leads: 1 }),
      getHotLeads: async () => [{}],
      getInbox: async () => ({ not: "an array" }),
    };
    // Redirect the log by re-requiring with EXPLEE_LOG_FILE set.
    process.env.EXPLEE_LOG_FILE = path.join(dir, "log.jsonl");
    delete require.cache[require.resolve("./explee-daily-monitor.cjs")];
    const Monitor = require("./explee-daily-monitor.cjs");
    const snap = await new Monitor(stub).captureSnapshot("p1");
    assert.equal(snap.totals.sent, 10);
    assert.equal(snap.inboxConversations, 0);
    assert.equal(Monitor.readLog().length, 1);
    delete process.env.EXPLEE_LOG_FILE;
  });

  console.log(`\nexplee monitor tests: ${passed} passed`);
})().catch((err) => {
  console.error("\n[FAILED]", err);
  process.exit(1);
});
