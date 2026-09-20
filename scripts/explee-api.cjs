#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Explee Public API wrapper (AutoGTM campaigns, budgets, inbox, analytics).
 *
 * Routes follow the published spec at https://api.explee.com/public/api/openapi.json
 * (a copy lives in docs/explee/openapi.json). Base: /public/api/v1.
 *
 * Auth: reads EXPLEE_API_KEY from the environment (or from .env.local / .env
 * at the repo root). The key is never stored in this file.
 * Keys are issued at https://explee.com/app-auto-gtm/api-keys
 *
 * Usage:
 *   node scripts/explee-api.cjs list-projects
 *   node scripts/explee-api.cjs list-campaigns [project-id]
 *   node scripts/explee-api.cjs project-analytics <project-id> [today|7d|30d|all]
 *   node scripts/explee-api.cjs set-budget <project-id> <usd-per-day>
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DEFAULT_BASE_URL = 'https://api.explee.com/public/api/v1';
const PERIODS = ['today', '7d', '30d', 'all'];
const INBOX_TABS = ['need_reply', 'replied', 'sent'];

/**
 * Minimal .env loader (no dotenv dependency). Reads repo-root .env.local then
 * .env, never overriding a variable that is already set in the environment.
 */
function loadEnvFiles() {
  const root = path.join(__dirname, '..');
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function resolveApiKey() {
  if (!process.env.EXPLEE_API_KEY) loadEnvFiles();
  const key = (process.env.EXPLEE_API_KEY || '').trim();
  if (!key || key.endsWith('...')) {
    throw new Error(
      'EXPLEE_API_KEY is not set. Add the real key to .env.local (gitignored) or export it in your shell.'
    );
  }
  return key;
}

/** Default transport: Node https. Resolves { status, text }. */
function httpsTransport({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const requireId = (label, value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a positive integer (got "${value}")`);
  return n;
};

const requireUsd = (label, value, { min = 0, max = Infinity } = {}) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} must be a whole number of USD between ${min} and ${max} (got "${value}")`);
  }
  return n;
};

const requirePeriod = (period) => {
  if (period === undefined) return 'all';
  if (!PERIODS.includes(period)) throw new Error(`period must be one of ${PERIODS.join(', ')} (got "${period}")`);
  return period;
};

class ExpleeAPI {
  /**
   * @param {object} [opts]
   * @param {string} [opts.apiKey]      defaults to EXPLEE_API_KEY
   * @param {string} [opts.baseUrl]     defaults to EXPLEE_BASE_URL or the public v1 base
   * @param {Function} [opts.transport] ({method,url,headers,body}) => {status,text}; tests inject one
   */
  constructor(opts = {}) {
    const o = typeof opts === 'string' ? { apiKey: opts } : opts;
    this.apiKey = o.apiKey || resolveApiKey();
    this.baseUrl = (o.baseUrl || process.env.EXPLEE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.transport = o.transport || httpsTransport;
  }

  async request(method, apiPath, { body = null, query = null } = {}) {
    const url = new URL(`${this.baseUrl}${apiPath}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    const headers = { 'X-API-Key': this.apiKey, Accept: 'application/json' };
    const payload = body === null ? null : JSON.stringify(body);
    if (payload !== null) headers['Content-Type'] = 'application/json';

    const { status, text } = await this.transport({ method, url: url.toString(), headers, body: payload });

    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (status >= 400) {
      const detail = parsed && parsed.detail ? JSON.stringify(parsed.detail) : text.slice(0, 500);
      throw new Error(`API Error ${status} on ${method} ${url.pathname}: ${detail}`);
    }
    if (text && parsed === null) throw new Error(`Parse error: non-JSON response from ${method} ${url.pathname}`);
    return parsed;
  }

  // ---- Projects --------------------------------------------------------
  /** { projects: [{ id, domain, daily_budget_usd }], total } */
  async listProjects() {
    return this.request('GET', '/autogtm/projects');
  }

  /** No single-project route exists; resolve from the list. Returns null when absent. */
  async getProject(projectId) {
    const id = requireId('project id', projectId);
    const { projects = [] } = (await this.listProjects()) || {};
    return projects.find((p) => p.id === id) || null;
  }

  /** { project_id, period, total_emails_sent, total_replies, ..., campaigns: [...] } */
  async getProjectAnalytics(projectId, period) {
    return this.request('GET', `/autogtm/projects/${requireId('project id', projectId)}/analytics`, {
      query: { period: requirePeriod(period) },
    });
  }

  async getProjectBudget(projectId) {
    return this.request('GET', `/autogtm/projects/${requireId('project id', projectId)}/budget`);
  }

  /** Whole-project daily budget in USD. 0 pauses all sending. */
  async setProjectBudget(projectId, dailyBudgetUsd) {
    return this.request('PATCH', `/autogtm/projects/${requireId('project id', projectId)}/budget`, {
      body: { daily_budget_usd: requireUsd('daily budget', dailyBudgetUsd) },
    });
  }

  async getAutopilot(projectId) {
    return this.request('GET', `/autogtm/projects/${requireId('project id', projectId)}/autopilot`);
  }

  /** settings: { autopilot_enabled?, auto_reply_enabled?, auto_reply_delay_minutes?, reply_cc_emails? } */
  async setAutopilot(projectId, settings) {
    if (!settings || Object.keys(settings).length === 0) throw new Error('setAutopilot needs at least one setting');
    return this.request('PATCH', `/autogtm/projects/${requireId('project id', projectId)}/autopilot`, {
      body: settings,
    });
  }

  // ---- Campaigns -------------------------------------------------------
  /** { campaigns: [{ id, project_id, name, target_url, daily_limit_usd, status }], total } */
  async listCampaigns(projectId) {
    return this.request('GET', '/autogtm/campaigns', {
      query: { project_id: projectId === undefined ? undefined : requireId('project id', projectId) },
    });
  }

  async getCampaign(campaignId) {
    return this.request('GET', `/autogtm/campaigns/${requireId('campaign id', campaignId)}`);
  }

  async updateCampaign(campaignId, patch) {
    return this.request('PATCH', `/autogtm/campaigns/${requireId('campaign id', campaignId)}`, { body: patch });
  }

  async getCampaignAnalytics(campaignId, period) {
    return this.request('GET', `/autogtm/campaigns/${requireId('campaign id', campaignId)}/analytics`, {
      query: { period: requirePeriod(period) },
    });
  }

  async startCampaign(campaignId) {
    return this.request('POST', `/autogtm/campaigns/${requireId('campaign id', campaignId)}/start`);
  }

  async stopCampaign(campaignId) {
    return this.request('POST', `/autogtm/campaigns/${requireId('campaign id', campaignId)}/stop`);
  }

  /** One campaign's daily budget, 1–300 USD. Returns 409 while Autopilot is on. */
  async setCampaignBudget(campaignId, dailyLimitUsd) {
    return this.request('PATCH', `/autogtm/campaigns/${requireId('campaign id', campaignId)}/budget`, {
      body: { daily_limit_usd: requireUsd('campaign daily budget', dailyLimitUsd, { min: 1, max: 300 }) },
    });
  }

  // ---- Inbox & leads ---------------------------------------------------
  /** tab: need_reply | replied | sent | undefined (all). { contacts, total, has_more, next_offset } */
  async getInbox(campaignId, { tab, limit, offset } = {}) {
    if (tab !== undefined && !INBOX_TABS.includes(tab)) {
      throw new Error(`inbox tab must be one of ${INBOX_TABS.join(', ')} (got "${tab}")`);
    }
    return this.request('GET', `/autogtm/campaigns/${requireId('campaign id', campaignId)}/inbox`, {
      query: { tab, limit, offset },
    });
  }

  async getConversation(campaignId, personId) {
    if (!personId) throw new Error('person id required');
    return this.request(
      'GET',
      `/autogtm/campaigns/${requireId('campaign id', campaignId)}/inbox/${encodeURIComponent(personId)}`
    );
  }

  async replyToLead(campaignId, personId, bodyText) {
    if (!personId) throw new Error('person id required');
    if (!bodyText || !String(bodyText).trim()) throw new Error('reply text required');
    return this.request(
      'POST',
      `/autogtm/campaigns/${requireId('campaign id', campaignId)}/inbox/${encodeURIComponent(personId)}/reply`,
      { body: { body_text: String(bodyText) } }
    );
  }

  async getLeadNote(campaignId, personId) {
    if (!personId) throw new Error('person id required');
    return this.request(
      'GET',
      `/autogtm/campaigns/${requireId('campaign id', campaignId)}/inbox/${encodeURIComponent(personId)}/note`
    );
  }

  async setLeadNote(campaignId, personId, note) {
    if (!personId) throw new Error('person id required');
    return this.request(
      'POST',
      `/autogtm/campaigns/${requireId('campaign id', campaignId)}/inbox/${encodeURIComponent(personId)}/note`,
      { body: { note: note === undefined ? null : note } }
    );
  }

  /** Org-wide unless campaignId is given. { leads, total, has_more, next_offset } */
  async getHotLeads({ campaignId, since, limit, offset } = {}) {
    return this.request('GET', '/autogtm/hot-leads', {
      query: {
        campaign_id: campaignId === undefined ? undefined : requireId('campaign id', campaignId),
        since,
        limit,
        offset,
      },
    });
  }

  // ---- Account ---------------------------------------------------------
  /** { remain } */
  async getBalance() {
    return this.request('GET', '/billing/balance');
  }
}

const USAGE = `
Explee API CLI (AutoGTM)

Projects
  list-projects                                  Projects with id, domain, daily budget
  project-analytics <project-id> [period]        Totals + per-campaign rows (period: today|7d|30d|all)
  get-budget <project-id>
  set-budget <project-id> <usd-per-day>          0 pauses all sending
  get-autopilot <project-id>
  set-autopilot <project-id> on|off              Turn the autopilot agent on/off

Campaigns
  list-campaigns [project-id]
  get-campaign <campaign-id>                     Full definition (targeting, briefs, schedule)
  get-analytics <campaign-id> [period]
  start-campaign <campaign-id>
  stop-campaign <campaign-id>
  set-campaign-budget <campaign-id> <usd>        1–300; only while autopilot is off

Inbox & leads
  get-inbox <campaign-id> [need_reply|replied|sent]
  get-thread <campaign-id> <person-id>
  reply <campaign-id> <person-id> <text...>
  get-hot-leads [campaign-id]

Account
  balance

Auth: set EXPLEE_API_KEY in .env.local or your shell.
`;

const print = (v) => console.log(JSON.stringify(v, null, 2));

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return;
  }

  try {
    const api = new ExpleeAPI();
    const need = (n, msg) => {
      if (args.length < n) throw new Error(msg);
    };

    switch (command) {
      case 'list-projects':
        print(await api.listProjects());
        break;
      case 'project-analytics':
        need(1, 'Project ID required');
        print(await api.getProjectAnalytics(args[0], args[1]));
        break;
      case 'get-budget':
        need(1, 'Project ID required');
        print(await api.getProjectBudget(args[0]));
        break;
      case 'set-budget':
        need(2, 'Project ID and daily budget (whole USD) required');
        print(await api.setProjectBudget(args[0], args[1]));
        break;
      case 'get-autopilot':
        need(1, 'Project ID required');
        print(await api.getAutopilot(args[0]));
        break;
      case 'set-autopilot': {
        need(2, 'Project ID and on|off required');
        if (!['on', 'off'].includes(args[1])) throw new Error('set-autopilot expects on or off');
        print(await api.setAutopilot(args[0], { autopilot_enabled: args[1] === 'on' }));
        break;
      }

      case 'list-campaigns':
        print(await api.listCampaigns(args[0]));
        break;
      case 'get-campaign':
        need(1, 'Campaign ID required');
        print(await api.getCampaign(args[0]));
        break;
      case 'get-analytics':
        need(1, 'Campaign ID required');
        print(await api.getCampaignAnalytics(args[0], args[1]));
        break;
      case 'start-campaign':
        need(1, 'Campaign ID required');
        print(await api.startCampaign(args[0]));
        break;
      case 'stop-campaign':
        need(1, 'Campaign ID required');
        print(await api.stopCampaign(args[0]));
        break;
      case 'set-campaign-budget':
        need(2, 'Campaign ID and daily budget (whole USD, 1–300) required');
        print(await api.setCampaignBudget(args[0], args[1]));
        break;

      case 'get-inbox':
        need(1, 'Campaign ID required');
        print(await api.getInbox(args[0], { tab: args[1] }));
        break;
      case 'get-thread':
        need(2, 'Campaign ID and person ID required');
        print(await api.getConversation(args[0], args[1]));
        break;
      case 'reply':
        need(3, 'Campaign ID, person ID and reply text required');
        print(await api.replyToLead(args[0], args[1], args.slice(2).join(' ')));
        break;
      case 'get-hot-leads':
        print(await api.getHotLeads({ campaignId: args[0] }));
        break;

      case 'balance':
        print(await api.getBalance());
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.log(USAGE);
        process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = ExpleeAPI;
module.exports.PERIODS = PERIODS;
module.exports.INBOX_TABS = INBOX_TABS;
