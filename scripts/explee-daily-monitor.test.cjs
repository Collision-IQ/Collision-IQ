/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// Offline regression tests for the Explee tooling. No network, no env file.
// The route table below is pinned to docs/explee/openapi.json: a wrong path
// (the bug that shipped in the first draft) fails here, not in production.

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

/** Records every request and answers with `reply` (or 200 {}). */
function recordingApi(reply = {}) {
  const calls = [];
  const api = new ExpleeAPI({
    apiKey: "test-key",
    transport: async (req) => {
      calls.push(req);
      const r = typeof reply === "function" ? reply(req) : reply;
      return { status: r.status || 200, text: JSON.stringify(r.body === undefined ? r : r.body) };
    },
  });
  return { api, calls };
}

const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "explee", "openapi.json"), "utf8"));
const specHas = (method, routePath) => {
  const entry = SPEC.paths[routePath];
  return Boolean(entry && entry[method.toLowerCase()]);
};

(async () => {
  await test("every wrapper method hits a route that exists in the published spec", async () => {
    const { api, calls } = recordingApi({});
    const table = [
      [() => api.listProjects(), "GET", "/public/api/v1/autogtm/projects"],
      [() => api.getProjectAnalytics(7, "today"), "GET", "/public/api/v1/autogtm/projects/{project_id}/analytics"],
      [() => api.getProjectBudget(7), "GET", "/public/api/v1/autogtm/projects/{project_id}/budget"],
      [() => api.setProjectBudget(7, 10), "PATCH", "/public/api/v1/autogtm/projects/{project_id}/budget"],
      [() => api.getAutopilot(7), "GET", "/public/api/v1/autogtm/projects/{project_id}/autopilot"],
      [() => api.setAutopilot(7, { autopilot_enabled: false }), "PATCH", "/public/api/v1/autogtm/projects/{project_id}/autopilot"],
      [() => api.listCampaigns(7), "GET", "/public/api/v1/autogtm/campaigns"],
      [() => api.getCampaign(3), "GET", "/public/api/v1/autogtm/campaigns/{campaign_id}"],
      [() => api.updateCampaign(3, { name: "x" }), "PATCH", "/public/api/v1/autogtm/campaigns/{campaign_id}"],
      [() => api.getCampaignAnalytics(3, "7d"), "GET", "/public/api/v1/autogtm/campaigns/{campaign_id}/analytics"],
      [() => api.startCampaign(3), "POST", "/public/api/v1/autogtm/campaigns/{campaign_id}/start"],
      [() => api.stopCampaign(3), "POST", "/public/api/v1/autogtm/campaigns/{campaign_id}/stop"],
      [() => api.setCampaignBudget(3, 5), "PATCH", "/public/api/v1/autogtm/campaigns/{campaign_id}/budget"],
      [() => api.getInbox(3, { tab: "need_reply" }), "GET", "/public/api/v1/autogtm/campaigns/{campaign_id}/inbox"],
      [() => api.getConversation(3, "p1"), "GET", "/public/api/v1/autogtm/campaigns/{campaign_id}/inbox/{person_id}"],
      [() => api.replyToLead(3, "p1", "hi"), "POST", "/public/api/v1/autogtm/campaigns/{campaign_id}/inbox/{person_id}/reply"],
      [() => api.getLeadNote(3, "p1"), "GET", "/public/api/v1/autogtm/campaigns/{campaign_id}/inbox/{person_id}/note"],
      [() => api.setLeadNote(3, "p1", "n"), "POST", "/public/api/v1/autogtm/campaigns/{campaign_id}/inbox/{person_id}/note"],
      [() => api.getHotLeads({ campaignId: 3 }), "GET", "/public/api/v1/autogtm/hot-leads"],
      [() => api.getBalance(), "GET", "/public/api/v1/billing/balance"],
    ];
    for (const [call, method, template] of table) {
      assert.ok(specHas(method, template), `spec lacks ${method} ${template}`);
      calls.length = 0;
      await call();
      assert.equal(calls.length, 1, `${template} made ${calls.length} requests`);
      const url = new URL(calls[0].url);
      const concrete = template.replace("{project_id}", "7").replace("{campaign_id}", "3").replace("{person_id}", "p1");
      assert.equal(calls[0].method, method, template);
      assert.equal(url.pathname, concrete, template);
      assert.equal(calls[0].headers["X-API-Key"], "test-key");
    }
  });

  await test("query params and bodies match the spec's field names", async () => {
    const { api, calls } = recordingApi({});
    await api.listCampaigns(7);
    assert.equal(new URL(calls[0].url).searchParams.get("project_id"), "7");
    await api.listCampaigns();
    assert.equal(new URL(calls[1].url).search, "");
    await api.getProjectAnalytics(7);
    assert.equal(new URL(calls[2].url).searchParams.get("period"), "all");
    await api.getInbox(3, { tab: "need_reply", limit: 1 });
    assert.equal(new URL(calls[3].url).search, "?tab=need_reply&limit=1");
    await api.getHotLeads({ since: "2026-09-20T00:00:00Z", limit: 200 });
    assert.equal(new URL(calls[4].url).search, "?since=2026-09-20T00%3A00%3A00Z&limit=200");
    await api.setProjectBudget(7, "10");
    assert.deepEqual(JSON.parse(calls[5].body), { daily_budget_usd: 10 });
    await api.setCampaignBudget(3, 5);
    assert.deepEqual(JSON.parse(calls[6].body), { daily_limit_usd: 5 });
    await api.replyToLead(3, "p1", "Thanks!");
    assert.deepEqual(JSON.parse(calls[7].body), { body_text: "Thanks!" });
    assert.equal(calls[7].headers["Content-Type"], "application/json");
    assert.equal(calls[0].headers["Content-Type"], undefined);
  });

  await test("argument validation rejects bad ids, periods, tabs and budgets before any request", async () => {
    const { api, calls } = recordingApi({});
    await assert.rejects(() => api.getCampaign("abc"), /campaign id must be a positive integer/);
    await assert.rejects(() => api.getProjectAnalytics(7, "yesterday"), /period must be one of/);
    await assert.rejects(() => api.getInbox(3, { tab: "spam" }), /inbox tab must be one of/);
    await assert.rejects(() => api.setProjectBudget(7, 2.5), /whole number of USD/);
    await assert.rejects(() => api.setCampaignBudget(3, 301), /between 1 and 300/);
    await assert.rejects(() => api.setAutopilot(7, {}), /at least one setting/);
    await assert.rejects(() => api.replyToLead(3, "p1", "  "), /reply text required/);
    assert.equal(calls.length, 0);
  });

  await test("HTTP errors surface the status, route and API detail", async () => {
    const { api } = recordingApi({ status: 404, body: { detail: "Not Found" } });
    await assert.rejects(() => api.listProjects(), /API Error 404 on GET \/public\/api\/v1\/autogtm\/projects: "Not Found"/);
    const { api: api409 } = recordingApi({ status: 409, body: { detail: "autopilot manages budgets" } });
    await assert.rejects(() => api409.setCampaignBudget(3, 5), /API Error 409/);
  });

  await test("getProject resolves from the project list and returns null when absent", async () => {
    const { api } = recordingApi({ projects: [{ id: 7, domain: "collision-iq.ai", daily_budget_usd: 10 }], total: 1 });
    assert.deepEqual(await api.getProject("7"), { id: 7, domain: "collision-iq.ai", daily_budget_usd: 10 });
    assert.equal(await api.getProject(8), null);
  });

  await test("ExpleeAPI refuses to construct without a real EXPLEE_API_KEY", () => {
    const saved = process.env.EXPLEE_API_KEY;
    process.env.EXPLEE_API_KEY = "sk_explee_...";
    try {
      assert.throws(() => new ExpleeAPI(), /EXPLEE_API_KEY is not set/);
    } finally {
      if (saved === undefined) delete process.env.EXPLEE_API_KEY;
      else process.env.EXPLEE_API_KEY = saved;
    }
    assert.equal(new ExpleeAPI("explicit-key").apiKey, "explicit-key");
    assert.equal(new ExpleeAPI({ apiKey: "k", baseUrl: "https://x.test/v1/" }).baseUrl, "https://x.test/v1");
  });

  const PROJECT = { id: 7, domain: "collision-iq.ai", daily_budget_usd: 10 };
  const ALL = {
    project_id: 7, period: "all",
    total_emails_sent: 150, total_replies: 8, total_auto_replies: 3, overall_reply_rate_pct: 5.33,
    total_hot_leads: 4, total_spend_usd: 10.004,
    campaigns: [
      { campaign_id: 1, name: "Body shops", status: "sending", status_reason: null, emails_sent: 100, total_replies: 6, reply_rate_pct: 6, hot_leads: 3, spend_usd: 4.5, cost_per_lead_usd: 1.5, daily_budget_usd: 5, leads_pool_used: 100, leads_pool_total: 400, cold_lost: 2 },
      { campaign_id: 2, name: "MSOs", status: "paused", status_reason: "budget_pause", emails_sent: 50, total_replies: 2, reply_rate_pct: 4, hot_leads: 1, spend_usd: 5.5, cost_per_lead_usd: 5.5, daily_budget_usd: 5, leads_pool_used: 50, leads_pool_total: 90, cold_lost: 0 },
    ],
  };
  const TODAY = { total_emails_sent: 20, total_replies: 1, total_auto_replies: 0, overall_reply_rate_pct: 5, total_hot_leads: 1, total_spend_usd: 1.25, campaigns: [] };
  const CAMPAIGNS = [
    { id: 1, project_id: 7, name: "Body shops", status: "outreach", daily_limit_usd: 5 },
    { id: 2, project_id: 7, name: "MSOs", status: "listening", daily_limit_usd: 5 },
    { id: 3, project_id: 7, name: "Fleet", status: "discovery", daily_limit_usd: null },
  ];

  await test("buildSnapshot normalises the project rollup and fills in unreported campaigns", () => {
    const snap = PerformanceMonitor.buildSnapshot({
      project: PROJECT, allTime: ALL, today: TODAY, campaigns: CAMPAIGNS,
      needReply: { 1: 2, 2: 0 }, budget: { project_id: 7, daily_budget_usd: 10 },
      now: new Date("2026-09-20T12:00:00Z"),
    });
    assert.equal(snap.timestamp, "2026-09-20T12:00:00.000Z");
    assert.equal(snap.projectId, 7);
    assert.equal(snap.projectName, "collision-iq.ai");
    assert.equal(snap.dailyBudgetUsd, 10);
    assert.deepEqual(snap.totals, {
      sent: 150, replies: 8, autoReplies: 3, replyRate: 5.33, hotLeads: 4, spend: 10, costPerLead: 2.5, costPerReply: 1.25,
    });
    assert.deepEqual(snap.today, { sent: 20, replies: 1, autoReplies: 0, replyRate: 5, hotLeads: 1, spend: 1.25 });
    assert.equal(snap.campaigns, 3);
    assert.equal(snap.campaignDetails[0].name, "Body shops");
    assert.equal(snap.campaignDetails[0].status, "sending");
    assert.equal(snap.campaignDetails[0].needReply, 2);
    assert.equal(snap.campaignDetails[1].statusReason, "budget_pause");
    const fleet = snap.campaignDetails[2];
    assert.equal(fleet.name, "Fleet");
    assert.equal(fleet.status, "discovery");
    assert.equal(fleet.sent, 0);
    assert.equal(fleet.needReply, null);
    assert.equal(snap.needReplyTotal, 2);
  });

  await test("buildSnapshot tolerates missing analytics and budget", () => {
    const snap = PerformanceMonitor.buildSnapshot({ project: { id: 7, domain: "x", daily_budget_usd: null }, allTime: null, today: null, budget: { error: "boom" } });
    assert.equal(snap.totals.replyRate, 0);
    assert.equal(snap.totals.costPerLead, 0);
    assert.equal(snap.dailyBudgetUsd, null);
    assert.equal(snap.campaigns, 0);
  });

  await test("formatSummary renders lifetime, since-first-snapshot delta, today and campaign rows", () => {
    const mk = (day, sent, replies, hot, spend) =>
      PerformanceMonitor.buildSnapshot({
        project: PROJECT,
        allTime: { ...ALL, total_emails_sent: sent, total_replies: replies, total_hot_leads: hot, total_spend_usd: spend },
        today: TODAY, campaigns: CAMPAIGNS, needReply: { 1: 2, 2: 0 }, budget: { daily_budget_usd: 10 },
        now: new Date(`2026-09-${day}T09:00:00Z`),
      });
    assert.match(PerformanceMonitor.formatSummary([]), /No performance log found/);
    const out = PerformanceMonitor.formatSummary([mk("20", 100, 4, 2, 6), mk("21", 200, 9, 4, 12), mk("21", 250, 12, 6, 15)]);
    assert.match(out, /Snapshots: 3 \(2 distinct days\)/);
    assert.match(out, /Project daily budget: \$10\.00\/day/);
    assert.match(out, /Emails sent: 250 \| Replies: 12/);
    assert.match(out, /Emails sent: \+150 \| Replies: \+8 \(5\.33%\) \| Hot leads: \+4/);
    assert.match(out, /Spend: \+\$9\.00 \| Cost\/lead: \$2\.25/);
    assert.match(out, /Today .*\n  Emails sent: 20 \| Replies: 1/);
    assert.match(out, /Awaiting a human reply: 2/);
    assert.match(out, /MSOs \[paused: budget_pause\]/);
    assert.match(out, /Fleet \[discovery\]/);
  });

  await test("readLog parses JSONL and ignores blank lines", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "explee-")), "log.jsonl");
    fs.writeFileSync(file, '{"a":1}\n\n{"a":2}\n');
    assert.deepEqual(PerformanceMonitor.readLog(file), [{ a: 1 }, { a: 2 }]);
    assert.deepEqual(PerformanceMonitor.readLog(path.join(path.dirname(file), "missing")), []);
  });

  await test("captureSnapshot calls the right routes and appends to the log", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "explee-"));
    process.env.EXPLEE_LOG_FILE = path.join(dir, "log.jsonl");
    delete require.cache[require.resolve("./explee-daily-monitor.cjs")];
    const Monitor = require("./explee-daily-monitor.cjs");

    const { api, calls } = recordingApi((req) => {
      const u = new URL(req.url);
      if (u.pathname.endsWith("/autogtm/projects")) return { projects: [PROJECT], total: 1 };
      if (u.pathname.endsWith("/projects/7/analytics")) return u.searchParams.get("period") === "today" ? TODAY : ALL;
      if (u.pathname.endsWith("/autogtm/campaigns")) return { campaigns: CAMPAIGNS, total: 3 };
      if (u.pathname.endsWith("/projects/7/budget")) return { project_id: 7, daily_budget_usd: 10 };
      if (u.pathname.endsWith("/campaigns/3/inbox")) return { status: 500, body: { detail: "boom" } };
      if (u.pathname.endsWith("/inbox")) return { contacts: [], total: 2, has_more: true, next_offset: 1 };
      return { status: 404, body: { detail: "Not Found" } };
    });

    const snap = await new Monitor(api).captureSnapshot("7");
    assert.equal(snap.totals.sent, 150);
    assert.equal(snap.campaignDetails[0].needReply, 2);
    assert.equal(snap.campaignDetails[2].needReply, null, "inbox error is tolerated");
    assert.equal(snap.needReplyTotal, 4);
    assert.equal(Monitor.readLog().length, 1);
    const paths = calls.map((c) => new URL(c.url).pathname + new URL(c.url).search);
    assert.ok(paths.includes("/public/api/v1/autogtm/projects/7/analytics?period=all"));
    assert.ok(paths.includes("/public/api/v1/autogtm/projects/7/analytics?period=today"));
    assert.ok(paths.includes("/public/api/v1/autogtm/campaigns?project_id=7"));
    assert.ok(paths.includes("/public/api/v1/autogtm/campaigns/1/inbox?tab=need_reply&limit=1"));

    await assert.rejects(() => new Monitor(api).captureSnapshot("99"), /Project 99 not found/);
    delete process.env.EXPLEE_LOG_FILE;
  });

  console.log(`\nexplee tests: ${passed} passed`);
})().catch((err) => {
  console.error("\n[FAILED]", err);
  process.exit(1);
});
