# Explee Assessment Framework — Due Friday 9/25

## Objective
Compare Explee's lead generation performance against HubSpot baseline, assess $10/day budget efficiency, and recommend scaling strategy.

## Test Parameters
- **Period**: Sept 20–25, 2026 (6 days)
- **Budget**: $10/day (actual vs. budgeted)
- **Campaigns**: 6 segments (body shops, MSOs, DRP teams, appraisers, fleet, training schools)
- **Baseline**: HubSpot cost per lead, reply rate, and lead quality

## Daily Snapshot Cadence
Run daily at consistent time (recommend morning):
```bash
node scripts/explee-daily-monitor.cjs <project-id>
```
This appends to `scripts/explee-performance-log.jsonl` (gitignored)

## Key Metrics to Track

### Cost Efficiency
- [ ] **Total spend** (vs. $60 budget limit)
- [ ] **Leads generated** (Explee "hot leads": replies classified as interested)
- [ ] **Cost per lead** (spend ÷ hot leads; `summary` prints it for the test period)
- [ ] **Cost per reply** (spend ÷ replies)
- [ ] **Reply rate** (replies ÷ sent)
- [ ] **HubSpot comparison**: Cost per lead in HubSpot for same segments

### Lead Quality
- [ ] **Segment quality**: Which segments respond best?
  - Body shops
  - MSOs
  - DRP teams
  - Independent appraisers
  - Fleet operators
  - Training schools
- [ ] **Conversion signals**: Booking link clicks, demo requests, followup engagement
- [ ] **Unsubscribe/spam rate**: Health indicator

### Operational
- [ ] **Auto-reply effectiveness**: Which reply facts drive responses?
- [ ] **Inbox velocity**: Time from inquiry to first response
- [ ] **Campaign uptime**: Any stops/starts needed?
- [ ] **Hot leads generated**: Quality indicators

## Friday Report Structure

### 1. Executive Summary (2–3 sentences)
- Overall performance vs. HubSpot
- Primary finding (best performer, biggest blocker, etc.)
- Scale recommendation (hold, increase, pivot)

### 2. Cost Efficiency Results
Table:
```
| Metric | Explee | HubSpot | Winner |
|--------|--------|---------|--------|
| Cost per Lead | $X.XX | $X.XX | |
| Total Leads | N | N | |
| Reply Rate | X% | X% | |
| Total Spend | $X.XX | $X.XX | |
```

### 3. Segment Performance Breakdown
```
Segment: [Name]
- Emails sent: N
- Replies: N
- Reply rate: X%
- Cost per lead: $X.XX
- Quality assessment: [Excellent/Good/Fair/Poor]
- Notes: [What's working/not working]
```

### 4. Lead Quality Assessment
- [ ] Lead profile quality (company size, fit, engagement)
- [ ] Auto-reply effectiveness
- [ ] Booking link click-through rate
- [ ] Booking link: [Insert URL and CTR if available]

### 5. Technical Observations
- [ ] API reliability: Any errors, timeouts, rate limits?
- [ ] Campaign management: Easy to start/stop/pause?
- [ ] Budget controls: Accurate spending tracking?
- [ ] Inbox responsiveness: Real-time or delayed?

### 6. Recommendation
- [ ] **Scale or Hold?** If scale, to what daily budget?
- [ ] **Best-performing segment**: Which should get priority?
- [ ] **Next steps**: What to test in week 2?
  - A/B different subject lines?
  - Adjust auto-reply copy?
  - Change targeting by geography?
  - Modify budget allocation between segments?

## Data Sources

### Explee Snapshots
```bash
# Review all captured snapshots
cat scripts/explee-performance-log.jsonl | jq '.'

# Get latest snapshot
tail -1 scripts/explee-performance-log.jsonl | jq '.'

# Generate summary
node scripts/explee-daily-monitor.cjs summary
```

### HubSpot Comparison
Check HubSpot dashboard for:
- Contacts created (same week, if available)
- Campaign reply rates
- Cost per contact
- Source attribution

Access: [HubSpot Dashboard Link]

## Format & Delivery
- Markdown or Google Doc
- Include snapshots/charts if data supports visual comparison
- Share in #explee or directly to Vinny
- Format: Hook (finding) → Data → Recommendation → Next steps

## Success Criteria
- ✅ Explee cost per lead < HubSpot cost per lead
- ✅ Reply rate ≥ 5% (industry benchmark ~3–4%)
- ✅ Budget tracking accuracy ±5%
- ✅ Clear segment winner identified
- ✅ Scalability recommendation defensible by data
