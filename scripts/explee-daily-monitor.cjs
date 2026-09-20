#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Explee Daily Performance Monitor
 * Captures one snapshot per run of an AutoGTM project: lifetime and today's
 * totals, the per-campaign breakdown, budget, and how many replies are
 * waiting for a human. Run daily for the Friday assessment.
 *
 * Usage:
 *   node scripts/explee-daily-monitor.cjs <project-id>   # capture a snapshot
 *   node scripts/explee-daily-monitor.cjs summary        # print aggregated data
 *
 * Writes: scripts/explee-performance-log.jsonl (one JSON line per run).
 * Override the log location with EXPLEE_LOG_FILE.
 */

const fs = require('fs');
const path = require('path');
const ExpleeAPI = require('./explee-api.cjs');

const LOG_FILE = process.env.EXPLEE_LOG_FILE || path.join(__dirname, 'explee-performance-log.jsonl');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v) => Math.round(num(v) * 100) / 100;
const pct = (part, whole) => (whole > 0 ? round2((part / whole) * 100) : 0);
const money = (v) => `$${round2(v).toFixed(2)}`;

class PerformanceMonitor {
  constructor(api) {
    this.api = api || new ExpleeAPI();
  }

  async captureSnapshot(projectId) {
    console.log(`\n📊 Capturing snapshot for project ${projectId}...`);

    const project = await this.api.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found for this API key (run list-projects)`);
    console.log(`Project: ${project.domain} (id ${project.id})`);

    const [allTime, today, campaignList, budget] = await Promise.all([
      this.api.getProjectAnalytics(project.id, 'all'),
      this.api.getProjectAnalytics(project.id, 'today'),
      this.api.listCampaigns(project.id),
      this.api.getProjectBudget(project.id).catch((err) => ({ error: err.message })),
    ]);

    const campaigns = (campaignList && campaignList.campaigns) || [];
    console.log(`Found ${campaigns.length} campaigns`);

    // Replies waiting for a human, per campaign (inbox "need_reply" tab).
    const needReply = {};
    for (const c of campaigns) {
      try {
        const inbox = await this.api.getInbox(c.id, { tab: 'need_reply', limit: 1 });
        needReply[c.id] = num(inbox && inbox.total);
      } catch (err) {
        console.warn(`  ✗ inbox for ${c.name || c.id}: ${err.message}`);
        needReply[c.id] = null;
      }
    }

    const snapshot = PerformanceMonitor.buildSnapshot({ project, allTime, today, campaigns, needReply, budget });

    for (const c of snapshot.campaignDetails) {
      console.log(`  ✓ ${c.name} [${c.status}]: ${c.sent} sent, ${c.replies} replies, ${c.hotLeads} hot, ${money(c.spend)}`);
    }
    console.log(`Hot leads: ${snapshot.totals.hotLeads} | Spend: ${money(snapshot.totals.spend)} | Awaiting reply: ${snapshot.needReplyTotal}`);

    fs.appendFileSync(LOG_FILE, JSON.stringify(snapshot) + '\n');
    console.log(`\n✅ Snapshot logged to ${LOG_FILE}`);
    return snapshot;
  }

  /** Pure: normalises the API responses into one snapshot record. */
  static buildSnapshot({ project, allTime, today, campaigns = [], needReply = {}, budget, now }) {
    const totalsOf = (a) => ({
      sent: num(a && a.total_emails_sent),
      replies: num(a && a.total_replies),
      autoReplies: num(a && a.total_auto_replies),
      replyRate: a && a.overall_reply_rate_pct !== undefined
        ? round2(a.overall_reply_rate_pct)
        : pct(num(a && a.total_replies), num(a && a.total_emails_sent)),
      hotLeads: num(a && a.total_hot_leads),
      spend: round2(a && a.total_spend_usd),
    });

    const totals = totalsOf(allTime);
    totals.costPerLead = totals.hotLeads > 0 ? round2(totals.spend / totals.hotLeads) : 0;
    totals.costPerReply = totals.replies > 0 ? round2(totals.spend / totals.replies) : 0;

    const byId = new Map(campaigns.map((c) => [c.id, c]));
    const rows = (allTime && allTime.campaigns) || [];
    const campaignDetails = rows.map((r) => {
      const c = byId.get(r.campaign_id) || {};
      return {
        id: r.campaign_id,
        name: r.name || c.name || String(r.campaign_id),
        status: r.status || c.status || 'unknown',
        statusReason: r.status_reason || null,
        sent: num(r.emails_sent),
        replies: num(r.total_replies),
        replyRate: round2(r.reply_rate_pct),
        hotLeads: num(r.hot_leads),
        spend: round2(r.spend_usd),
        costPerLead: round2(r.cost_per_lead_usd),
        dailyBudgetUsd: r.daily_budget_usd !== undefined ? round2(r.daily_budget_usd) : num(c.daily_limit_usd),
        leadsPoolUsed: num(r.leads_pool_used),
        leadsPoolTotal: num(r.leads_pool_total),
        coldLost: num(r.cold_lost),
        needReply: needReply[r.campaign_id] === undefined ? null : needReply[r.campaign_id],
      };
    });
    // Campaigns the analytics rollup did not report (e.g. still in discovery).
    for (const c of campaigns) {
      if (!rows.some((r) => r.campaign_id === c.id)) {
        campaignDetails.push({
          id: c.id,
          name: c.name || String(c.id),
          status: c.status || 'unknown',
          statusReason: null,
          sent: 0, replies: 0, replyRate: 0, hotLeads: 0, spend: 0, costPerLead: 0,
          dailyBudgetUsd: num(c.daily_limit_usd),
          leadsPoolUsed: 0, leadsPoolTotal: 0, coldLost: 0,
          needReply: needReply[c.id] === undefined ? null : needReply[c.id],
        });
      }
    }

    const needReplyTotal = campaignDetails.reduce((acc, c) => acc + num(c.needReply), 0);

    return {
      timestamp: (now || new Date()).toISOString(),
      projectId: project.id,
      projectName: project.domain,
      dailyBudgetUsd:
        budget && budget.daily_budget_usd !== undefined && budget.daily_budget_usd !== null
          ? num(budget.daily_budget_usd)
          : project.daily_budget_usd === undefined ? null : project.daily_budget_usd,
      campaigns: campaignDetails.length,
      totals,
      today: totalsOf(today),
      campaignDetails,
      needReplyTotal,
    };
  }

  static readLog(file = LOG_FILE) {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }

  /** Pure: renders the summary for a list of snapshots (oldest first). */
  static formatSummary(entries) {
    if (entries.length === 0) return 'No performance log found. Run monitor first.';

    const latest = entries[entries.length - 1];
    const oldest = entries[0];
    const days = new Set(entries.map((e) => String(e.timestamp).slice(0, 10))).size;
    const t = latest.totals;
    const o = oldest.totals;
    const delta = {
      sent: t.sent - o.sent,
      replies: t.replies - o.replies,
      hotLeads: t.hotLeads - o.hotLeads,
      spend: round2(t.spend - o.spend),
    };
    delta.replyRate = pct(delta.replies, delta.sent);
    delta.costPerLead = delta.hotLeads > 0 ? round2(delta.spend / delta.hotLeads) : 0;

    const rows = (latest.campaignDetails || []).map(
      (c) =>
        `  • ${c.name} [${c.status}${c.statusReason ? `: ${c.statusReason}` : ''}]\n` +
        `    sent ${c.sent} | replies ${c.replies} (${c.replyRate}%) | hot ${c.hotLeads} | spend ${money(c.spend)}` +
        ` | CPL ${money(c.costPerLead)} | budget ${money(c.dailyBudgetUsd)}/day` +
        ` | pool ${c.leadsPoolUsed}/${c.leadsPoolTotal}` +
        (c.needReply === null ? '' : ` | awaiting reply ${c.needReply}`)
    );

    const budget = latest.dailyBudgetUsd === null || latest.dailyBudgetUsd === undefined ? 'not set' : `${money(latest.dailyBudgetUsd)}/day`;

    return `
📈 Explee Performance Summary — ${latest.projectName} (project ${latest.projectId})
==================================================
Period: ${oldest.timestamp} → ${latest.timestamp}
Snapshots: ${entries.length} (${days} distinct day${days === 1 ? '' : 's'})
Project daily budget: ${budget}

Lifetime (latest snapshot)
  Emails sent: ${t.sent} | Replies: ${t.replies} (${t.replyRate}%) | Auto-replies: ${t.autoReplies}
  Hot leads: ${t.hotLeads} | Spend: ${money(t.spend)} | Cost/lead: ${money(t.costPerLead)} | Cost/reply: ${money(t.costPerReply)}

Since first snapshot (${String(oldest.timestamp).slice(0, 10)})
  Emails sent: +${delta.sent} | Replies: +${delta.replies} (${delta.replyRate}%) | Hot leads: +${delta.hotLeads}
  Spend: +${money(delta.spend)} | Cost/lead: ${money(delta.costPerLead)}

Today (as of latest snapshot)
  Emails sent: ${latest.today.sent} | Replies: ${latest.today.replies} | Hot leads: ${latest.today.hotLeads} | Spend: ${money(latest.today.spend)}

Awaiting a human reply: ${latest.needReplyTotal}

Campaign Breakdown (lifetime)
${rows.join('\n')}
`;
  }

  static summary() {
    console.log(PerformanceMonitor.formatSummary(PerformanceMonitor.readLog()));
  }
}

async function main() {
  const arg = process.argv[2];

  if (!arg || arg === 'help' || arg === '--help') {
    console.log('Usage: node scripts/explee-daily-monitor.cjs <project-id> | summary');
    console.log('  <project-id>  capture a snapshot and append it to the log (ids: node scripts/explee-api.cjs list-projects)');
    console.log('  summary       show aggregated data from the log');
    process.exit(arg ? 0 : 1);
  }

  if (arg === 'summary') {
    PerformanceMonitor.summary();
    return;
  }

  try {
    const snapshot = await new PerformanceMonitor().captureSnapshot(arg);
    console.log('\n' + JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = PerformanceMonitor;
