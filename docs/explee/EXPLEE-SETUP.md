# Explee API Setup & Daily Monitoring

Scripts: `scripts/explee-api.cjs` (API wrapper + CLI) and
`scripts/explee-daily-monitor.cjs` (daily snapshot + summary).
Assessment template: `docs/explee/EXPLEE-ASSESSMENT-FRAMEWORK.md`.

## Quick Start

### 1. Put the API key in `.env.local` (never in source)
```bash
# .env.local is gitignored
echo 'EXPLEE_API_KEY=sk_explee_...' >> .env.local
```
The scripts read `EXPLEE_API_KEY` from your shell first, then from `.env.local`
and `.env` at the repo root. They refuse to run without it.

### 2. Find Your Project ID
```bash
node scripts/explee-api.cjs list-projects
```

### 3. Set Daily Budget (optional)
```bash
node scripts/explee-api.cjs set-budget <project-id> 10
```
Sets a $10 daily budget for the entire project.

### 4. Capture First Snapshot
```bash
node scripts/explee-daily-monitor.cjs <project-id>
```
Appends one snapshot to `scripts/explee-performance-log.jsonl` (gitignored;
set `EXPLEE_LOG_FILE` to write elsewhere).

### 5. View Performance Summary
```bash
node scripts/explee-daily-monitor.cjs summary
```

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

### Manual Campaign Control
```bash
node scripts/explee-api.cjs list-campaigns <project-id>
node scripts/explee-api.cjs get-analytics <project-id> <campaign-id>
node scripts/explee-api.cjs start-campaign <project-id> <campaign-id>
node scripts/explee-api.cjs stop-campaign <project-id> <campaign-id>
node scripts/explee-api.cjs get-hot-leads <project-id>
node scripts/explee-api.cjs get-inbox <project-id>
```

## Common Scenarios

**"One campaign is spending too fast"**
```bash
node scripts/explee-api.cjs set-budget <project-id> 5   # reduce to $5/day
node scripts/explee-daily-monitor.cjs summary
```

**"I want to pause one segment"**
```bash
node scripts/explee-api.cjs get-campaign <project-id> <campaign-id>   # note the status
node scripts/explee-api.cjs stop-campaign <project-id> <campaign-id>
node scripts/explee-api.cjs start-campaign <project-id> <campaign-id> # resume later
```

**"What's in my inbox?"**
```bash
node scripts/explee-api.cjs get-inbox <project-id> | jq '.[] | {sender, subject, message}'
```

**"Generate Friday Report"**
1. `node scripts/explee-daily-monitor.cjs summary > friday-report-data.txt`
2. Open `docs/explee/EXPLEE-ASSESSMENT-FRAMEWORK.md`
3. Fill in metrics from the snapshots and `friday-report-data.txt`
4. Add analysis and recommendation

## Error Handling

**"EXPLEE_API_KEY is not set"** — add the key to `.env.local` (step 1) or
`export EXPLEE_API_KEY=...` in the shell.

**"API Error 403: Forbidden"** — a network proxy or firewall is blocking
`api.explee.com` (cloud sandboxes typically do). Run from a local machine.

**"API Error 401"** — the key is wrong or revoked; regenerate it in Explee.

**"Empty response" / "API Error 404"** — the project ID does not exist; check
`list-projects`.

**"Connection timeout"** — retry in a moment, or check the Explee status page.

## Tests
```bash
npm run test:explee
```
Offline: covers snapshot math, summary rendering, log parsing, and the
missing-key guard.

## Next Steps

1. **Today (9/20)**: run first snapshot
2. **Daily (9/21–9/24)**: morning snapshot + casual monitoring
3. **Friday (9/25) morning**: final snapshot, summary, fill in the assessment
   framework, share the report with rationale for the next phase
