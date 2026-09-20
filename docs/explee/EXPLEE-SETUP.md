# Explee API Setup & Daily Monitoring

Scripts: `scripts/explee-api.cjs` (API wrapper + CLI) and
`scripts/explee-daily-monitor.cjs` (daily snapshot + summary).
Assessment template: `docs/explee/EXPLEE-ASSESSMENT-FRAMEWORK.md`.
API reference: `docs/explee/openapi.json` (copy of
`https://api.explee.com/public/api/openapi.json`; human view at
`https://api.explee.com/public/api/docs`). All routes live under
`/public/api/v1`; the AutoGTM ones under `/public/api/v1/autogtm`.

## How Explee's objects fit together

- A **project** is your company (identified by `domain`) and owns the total
  daily budget. Campaigns are listed and rolled up per project.
- A **campaign** is one segment (body shops, MSOs, …). Campaign ids are
  global, not nested under the project: inbox, analytics, start/stop and
  per-campaign budget all take just the campaign id.
- **Analytics** exist at both levels with a `period` of `today`, `7d`, `30d`
  or `all`. The project rollup already includes the per-campaign rows, so the
  monitor uses it instead of calling each campaign.
- A **hot lead** is a contact whose reply the classifier marked as interested.
  Explee's "cost per lead" is spend ÷ hot leads.
- The **inbox** is per campaign; the `need_reply` tab is what's waiting for a
  human.

## Quick Start

### 1. Put the API key in `.env.local` (never in source)
Create a key at `https://explee.com/app-auto-gtm/api-keys`, then:
```bash
# .env.local is gitignored. Type the real key; the scripts reject a placeholder.
echo 'EXPLEE_API_KEY=PASTE_KEY_HERE' >> .env.local
```
The scripts read `EXPLEE_API_KEY` from your shell first, then from `.env.local`
and `.env` at the repo root, and refuse to run without it.

### 2. Find your project and campaign ids
```bash
node scripts/explee-api.cjs list-projects
node scripts/explee-api.cjs list-campaigns <project-id>
```

### 3. Set the daily budget (optional)
```bash
node scripts/explee-api.cjs set-budget <project-id> 10   # whole USD per day; 0 pauses all sending
```
Explee spreads the project budget across its running campaigns.

### 4. Capture the first snapshot
```bash
node scripts/explee-daily-monitor.cjs <project-id>
```
Appends one line to `scripts/explee-performance-log.jsonl` (gitignored; set
`EXPLEE_LOG_FILE` to write elsewhere). Each snapshot holds lifetime and
today's totals, the per-campaign breakdown, the project budget, and the count
of replies awaiting a human.

### 5. View the summary
```bash
node scripts/explee-daily-monitor.cjs summary
```
Shows the latest lifetime numbers, the change since the first snapshot (the
test-period figures for the Friday report), today's numbers, and campaign rows.

## Daily Workflow (Sept 20–25)

Every morning:
```bash
node scripts/explee-daily-monitor.cjs <project-id>
```
Non-destructive: it only appends to the log file.

Anytime:
```bash
node scripts/explee-daily-monitor.cjs summary
```

### Manual campaign control
```bash
node scripts/explee-api.cjs project-analytics <project-id> [today|7d|30d|all]
node scripts/explee-api.cjs get-analytics <campaign-id> [period]
node scripts/explee-api.cjs get-campaign <campaign-id>          # targeting, briefs, schedule
node scripts/explee-api.cjs start-campaign <campaign-id>
node scripts/explee-api.cjs stop-campaign <campaign-id>
node scripts/explee-api.cjs set-campaign-budget <campaign-id> 5  # 1–300 USD; only while autopilot is off
node scripts/explee-api.cjs get-autopilot <project-id>
node scripts/explee-api.cjs set-autopilot <project-id> off
node scripts/explee-api.cjs get-hot-leads [campaign-id]
node scripts/explee-api.cjs get-inbox <campaign-id> [need_reply|replied|sent]
node scripts/explee-api.cjs get-thread <campaign-id> <person-id>
node scripts/explee-api.cjs reply <campaign-id> <person-id> Your reply text
node scripts/explee-api.cjs balance
```

## Common Scenarios

**"One campaign is spending too fast"**
```bash
node scripts/explee-api.cjs set-autopilot <project-id> off        # hand budgets back to you
node scripts/explee-api.cjs set-campaign-budget <campaign-id> 1
node scripts/explee-daily-monitor.cjs summary
```
Or lower the whole project: `set-budget <project-id> 5`.

**"I want to pause one segment"**
```bash
node scripts/explee-api.cjs stop-campaign <campaign-id>
node scripts/explee-api.cjs start-campaign <campaign-id>          # resume later
```

**"Who is waiting on me?"**
```bash
node scripts/explee-api.cjs get-inbox <campaign-id> need_reply | jq '.contacts[] | {person_id, name, email, latest_intent, latest_reply_at}'
node scripts/explee-api.cjs get-thread <campaign-id> <person-id>
```

**"Generate Friday Report"**
1. `node scripts/explee-daily-monitor.cjs summary > friday-report-data.txt`
2. Open `docs/explee/EXPLEE-ASSESSMENT-FRAMEWORK.md`
3. Fill in metrics from the summary ("Since first snapshot" is the test period)
4. Add analysis and recommendation

## Error Handling

**"EXPLEE_API_KEY is not set"** — add the real key to `.env.local` (step 1) or
`export EXPLEE_API_KEY=...` in the shell. A placeholder ending in `...` is
rejected on purpose.

**"API Error 404 … Not Found"** — the route does not exist. Compare against
`docs/explee/openapi.json`; the wrapper's routes are pinned to it by
`npm run test:explee`.

**"API Error 401 / 403"** — the key is wrong, revoked, or a proxy is blocking
`api.explee.com` (cloud sandboxes typically do). Run from a local machine.

**"API Error 409" on `set-campaign-budget`** — autopilot is on and manages
per-campaign budgets. Turn it off first (`set-autopilot <project-id> off`) or
set the project budget instead.

**"Project N not found"** — the id is not one of this key's projects; check
`list-projects`.

## Tests
```bash
npm run test:explee
```
Offline: every wrapper route is checked against `docs/explee/openapi.json`,
plus query/body field names, argument validation, error surfacing, snapshot
math, summary rendering, log parsing and the missing-key guard.

## Next Steps

1. **Today (9/20)**: run first snapshot
2. **Daily (9/21–9/24)**: morning snapshot + casual monitoring
3. **Friday (9/25) morning**: final snapshot, summary, fill in the assessment
   framework, share the report with rationale for the next phase
