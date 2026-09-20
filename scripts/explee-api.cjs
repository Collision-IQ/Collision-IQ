#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Explee API Wrapper
 * Manages AutoGTM campaigns, budgets, inbox, and analytics.
 *
 * Auth: reads EXPLEE_API_KEY from the environment (or from .env.local / .env
 * at the repo root). The key is never stored in this file.
 *
 * Usage:
 *   node scripts/explee-api.cjs list-projects
 *   node scripts/explee-api.cjs get-project <id>
 *   node scripts/explee-api.cjs list-campaigns <project-id>
 *   node scripts/explee-api.cjs get-inbox <project-id>
 *   node scripts/explee-api.cjs set-budget <project-id> <daily-amount>
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_URL = process.env.EXPLEE_BASE_URL || 'https://api.explee.com/public/api';

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
  if (!key) {
    throw new Error(
      'EXPLEE_API_KEY is not set. Add it to .env.local (gitignored) or export it in your shell.'
    );
  }
  return key;
}

class ExpleeAPI {
  constructor(apiKey) {
    this.apiKey = apiKey || resolveApiKey();
  }

  async request(method, apiPath, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${BASE_URL}${apiPath}`);
      const options = {
        method,
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
      };

      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : null;
            if (res.statusCode >= 400) {
              reject(new Error(`API Error ${res.statusCode}: ${data}`));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            if (res.statusCode >= 400) {
              reject(new Error(`API Error ${res.statusCode}: ${data.slice(0, 500)}`));
            } else {
              reject(new Error(`Parse error: ${e.message}`));
            }
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  // Projects & Campaigns
  async listProjects() {
    return this.request('GET', '/projects');
  }

  async getProject(projectId) {
    return this.request('GET', `/projects/${projectId}`);
  }

  async listCampaigns(projectId) {
    return this.request('GET', `/projects/${projectId}/campaigns`);
  }

  async getCampaign(projectId, campaignId) {
    return this.request('GET', `/projects/${projectId}/campaigns/${campaignId}`);
  }

  async getCampaignAnalytics(projectId, campaignId) {
    return this.request('GET', `/projects/${projectId}/campaigns/${campaignId}/analytics`);
  }

  // Campaign Control
  async startCampaign(projectId, campaignId) {
    return this.request('POST', `/projects/${projectId}/campaigns/${campaignId}/start`);
  }

  async stopCampaign(projectId, campaignId) {
    return this.request('POST', `/projects/${projectId}/campaigns/${campaignId}/stop`);
  }

  // Budget Management
  async setProjectBudget(projectId, dailyBudget) {
    return this.request('POST', `/projects/${projectId}/budget`, { daily_budget: dailyBudget });
  }

  async setCampaignBudget(projectId, campaignId, dailyBudget) {
    return this.request('POST', `/projects/${projectId}/campaigns/${campaignId}/budget`, {
      daily_budget: dailyBudget,
    });
  }

  // Inbox & Replies
  async getInbox(projectId) {
    return this.request('GET', `/projects/${projectId}/inbox`);
  }

  async getConversation(projectId, conversationId) {
    return this.request('GET', `/projects/${projectId}/conversations/${conversationId}`);
  }

  async replyToLead(projectId, conversationId, message) {
    return this.request('POST', `/projects/${projectId}/conversations/${conversationId}/reply`, {
      message,
    });
  }

  // Autopilot
  async setAutopilot(projectId, enabled) {
    return this.request('POST', `/projects/${projectId}/autopilot`, { enabled });
  }

  // Hot Leads
  async getHotLeads(projectId) {
    return this.request('GET', `/projects/${projectId}/hot-leads`);
  }
}

const USAGE = `
Explee API CLI

Usage:
  list-projects                          List all projects
  get-project <id>                       Get project details
  list-campaigns <project-id>            List campaigns
  get-campaign <project-id> <campaign-id>
  get-analytics <project-id> <campaign-id>
  get-inbox <project-id>
  start-campaign <project-id> <campaign-id>
  stop-campaign <project-id> <campaign-id>
  set-budget <project-id> <daily-amount>
  get-hot-leads <project-id>

Auth: set EXPLEE_API_KEY in .env.local or your shell.
`;

// CLI Interface
async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return;
  }

  try {
    const api = new ExpleeAPI();

    switch (command) {
      case 'list-projects':
        console.log(JSON.stringify(await api.listProjects(), null, 2));
        break;

      case 'get-project':
        if (!args[0]) throw new Error('Project ID required');
        console.log(JSON.stringify(await api.getProject(args[0]), null, 2));
        break;

      case 'list-campaigns': {
        const projectId = args[0];
        if (!projectId) throw new Error('Project ID required');
        const campaigns = await api.listCampaigns(projectId);
        console.log(JSON.stringify(campaigns, null, 2));
        break;
      }

      case 'get-campaign': {
        const [projectId, campaignId] = args;
        if (!projectId || !campaignId) throw new Error('Project ID and Campaign ID required');
        const campaign = await api.getCampaign(projectId, campaignId);
        console.log(JSON.stringify(campaign, null, 2));
        break;
      }

      case 'get-analytics': {
        const [projectId, campaignId] = args;
        if (!projectId || !campaignId) throw new Error('Project ID and Campaign ID required');
        const analytics = await api.getCampaignAnalytics(projectId, campaignId);
        console.log(JSON.stringify(analytics, null, 2));
        break;
      }

      case 'get-inbox': {
        const projectId = args[0];
        if (!projectId) throw new Error('Project ID required');
        const inbox = await api.getInbox(projectId);
        console.log(JSON.stringify(inbox, null, 2));
        break;
      }

      case 'start-campaign': {
        const [projectId, campaignId] = args;
        if (!projectId || !campaignId) throw new Error('Project ID and Campaign ID required');
        const result = await api.startCampaign(projectId, campaignId);
        console.log('Campaign started:', JSON.stringify(result, null, 2));
        break;
      }

      case 'stop-campaign': {
        const [projectId, campaignId] = args;
        if (!projectId || !campaignId) throw new Error('Project ID and Campaign ID required');
        const result = await api.stopCampaign(projectId, campaignId);
        console.log('Campaign stopped:', JSON.stringify(result, null, 2));
        break;
      }

      case 'set-budget': {
        const [projectId, amount] = args;
        if (!projectId || !amount) throw new Error('Project ID and budget amount required');
        const daily = parseFloat(amount);
        if (!Number.isFinite(daily) || daily < 0) throw new Error(`Invalid budget amount: ${amount}`);
        const result = await api.setProjectBudget(projectId, daily);
        console.log('Budget updated:', JSON.stringify(result, null, 2));
        break;
      }

      case 'get-hot-leads': {
        const projectId = args[0];
        if (!projectId) throw new Error('Project ID required');
        const leads = await api.getHotLeads(projectId);
        console.log(JSON.stringify(leads, null, 2));
        break;
      }

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
