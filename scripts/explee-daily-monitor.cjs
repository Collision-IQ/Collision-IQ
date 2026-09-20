#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Explee Daily Performance Monitor
 * Tracks campaigns, budgets, and lead volume — run daily for the Friday assessment.
 *
 * Usage:
 *   node scripts/explee-daily-monitor.cjs <project-id>   # capture a snapshot
 *   node scripts/explee-daily-monitor.cjs summary        # print aggregated data
 *
 * Creates: scripts/explee-performance-log.jsonl (appends one snapshot per run)
 * Override the log location with EXPLEE_LOG_FILE.
 */

const fs = require('fs');
const path = require('path');
const ExpleeAPI = require('./explee-api.cjs');

const LOG_FILE = process.env.EXPLEE_LOG_FILE || path.join(__dirname, 'explee-performance-log.jsonl');

const asArray = (value) => (Array.isArray(value) ? value : []);

class PerformanceMonitor {
  constructor(api) {
    this.api = api || new ExpleeAPI();
  }

  async captureSnapshot(projectId) {
    console.log(`\n📊 Capturing snapshot for project ${projectId}...`);

    // Get project details
    const project = await this.api.getProject(projectId);
    console.log(`Project: ${project && project.name}`);

    // Get all campaigns
    const campaignsList = asArray(await this.api.listCampaigns(projectId));
    console.log(`Found ${campaignsList.length} campaigns`);

    // Collect analytics for each campaign
    const campaigns = [];
    for (const campaign of campaignsList) {
      try {
        const analytics = await this.api.getCampaignAnalytics(projectId, campaign.id);
        campaigns.push({
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          ...analytics, // contains: sent, replies, reply_rate, spend, leads, etc.
        });
        console.log(`  ✓ ${campaign.name}: ${analytics.sent} sent, ${analytics.replies} replies`);
      } catch (err) {
        console.warn(`  ✗ Error getting analytics for ${campaign.name}:`, err.message);
        campaigns.push({
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          error: err.message,
        });
      }
    }

    // Get hot leads
    const hotLeads = asArray(await this.api.getHotLeads(projectId));
    console.log(`Hot leads: ${hotLeads.length}`);

    // Get inbox status
    const inbox = asArray(await this.api.getInbox(projectId));
    console.log(`Inbox conversations: ${inbox.length}`);

    const snapshot = PerformanceMonitor.buildSnapshot({
      projectId,
      projectName: project && project.name,
      campaigns,
      hotLeads: hotLeads.length,
      inboxConversations: inbox.length,
    });

    // Append to log
    fs.appendFileSync(LOG_FILE, JSON.stringify(snapshot) + '\n');
    console.log(`\n✅ Snapshot logged to ${LOG_FILE}`);

    return snapshot;
  }

  /** Pure: turns per-campaign analytics into a snapshot record. */
  static buildSnapshot({ projectId, projectName, campaigns, hotLeads, inboxConversations, now }) {
    const totals = campaigns.reduce(
      (acc, c) => ({
        sent: acc.sent + (Number(c.sent) || 0),
        replies: acc.replies + (Number(c.replies) || 0),
        spend: acc.spend + (Number(c.spend) || 0),
        leads: acc.leads + (Number(c.leads) || 0),
      }),
      { sent: 0, replies: 0, spend: 0, leads: 0 }
    );

    const replyRate = totals.sent > 0 ? Number(((totals.replies / totals.sent) * 100).toFixed(2)) : 0;
    const costPerLead = totals.leads > 0 ? Number((totals.spend / totals.leads).toFixed(2)) : 0;

    return {
      timestamp: (now || new Date()).toISOString(),
      projectId,
      projectName,
      campaigns: campaigns.length,
      totals: {
        sent: totals.sent,
        replies: totals.replies,
        replyRate,
        spend: totals.spend.toFixed(2),
        leads: totals.leads,
        costPerLead,
      },
      campaignDetails: campaigns,
      hotLeads,
      inboxConversations,
    };
  }

  // Parse the log file
  static readLog(file = LOG_FILE) {
    if (!fs.existsSync(file)) return [];

    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }

  /** Pure: renders the summary text for a list of snapshots (oldest first). */
  static formatSummary(entries) {
    if (entries.length === 0) return 'No performance log found. Run monitor first.';

    const latest = entries[entries.length - 1];
    const oldest = entries[0];
    const days = new Set(entries.map((e) => String(e.timestamp).slice(0, 10))).size;

    const breakdown = (latest.campaignDetails || [])
      .filter((c) => !c.error)
      .map(
        (c) => `  • ${c.name} (${c.status})
    - Sent: ${c.sent || 0} | Replies: ${c.replies || 0} | Spend: $${c.spend || 0}`
      )
      .join('\n');

    return `
📈 Explee Performance Summary
============================
Period: ${oldest.timestamp} to ${latest.timestamp}
Snapshots: ${entries.length} (${days} distinct day${days === 1 ? '' : 's'})

Campaigns: ${latest.campaigns}
Total Emails Sent: ${latest.totals.sent}
Total Replies: ${latest.totals.replies}
Reply Rate: ${latest.totals.replyRate}%
Total Spend: $${latest.totals.spend}
Total Leads: ${latest.totals.leads}
Cost per Lead: $${latest.totals.costPerLead}

Hot Leads: ${latest.hotLeads}
Inbox Conversations: ${latest.inboxConversations}

Campaign Breakdown:
${breakdown}
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
    console.log('  <project-id>  capture a snapshot and append it to the log');
    console.log('  summary       show aggregated data from the log');
    process.exit(arg ? 0 : 1);
  }

  if (arg === 'summary') {
    PerformanceMonitor.summary();
    return;
  }

  try {
    const monitor = new PerformanceMonitor();
    const snapshot = await monitor.captureSnapshot(arg);
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
