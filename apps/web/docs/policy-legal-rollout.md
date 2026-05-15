# Policy & Legal Intelligence Rollout

This feature adds policy-aware, citation-backed claim intelligence. It is not legal advice and must not assert regulatory support from placeholder records.

## Environment

`POLICY_LEGAL_INTELLIGENCE_ENABLED`

Expected values:
- `true`: enable Policy & Legal Intelligence review generation.
- `false`: skip Policy & Legal Intelligence review generation while preserving legacy analysis behavior.
- unset: enabled by default.

Default behavior:
- The feature is enabled unless `POLICY_LEGAL_INTELLIGENCE_ENABLED=false`.
- When disabled, analysis still runs and returns the legacy report shape without `policyLegalReview`.

Neon/Prisma migration note:
- The Regulation, policy/legal access log, and review snapshot tables are defined in Prisma and the `20260505120000_add_regulations` migration.
- For Neon/non-interactive environments, deploy migrations with the deployment workflow, for example `npx prisma migrate deploy`.
- Run `npx prisma generate` after schema changes so Prisma Client includes the policy/legal models.

Verified regulation seed command:

```bash
npx prisma db seed
```

For Neon staging, run the seed with `DATABASE_URL` pointed at `DIRECT_URL` when the pooled/runtime database URL cannot be used for direct seed access:

```bash
DATABASE_URL="$DIRECT_URL" npx prisma db seed
```

Verified records are read from `src/lib/policyLegal/verifiedRegulations.seed.json`. Each verified record must include source metadata and must not use a `TBD` citation. The seed also creates placeholder Regulation records with `TBD - requires official state source verification`; placeholders are safe context only and do not count as regulatory support.

## Release Checklist

- [ ] Migration deployed to Neon/Postgres.
- [ ] Prisma Client generated.
- [ ] Verified regulations seeded from `src/lib/policyLegal/verifiedRegulations.seed.json`.
- [ ] `GET /api/policy-legal/health` reports `enabled: true`, `regulation_table_reachable: true`, and `placeholder_dataset_available: true`.
- [ ] Admin/debug endpoints are protected:
  - [ ] `GET /api/policy-legal/regulations?state=FL` blocks unauthenticated access.
  - [ ] `GET /api/policy-legal/snapshots?caseId=...` blocks unauthenticated access.
- [ ] Placeholder records are not counted as regulatory support.
- [ ] Audit snapshots are enabled and new review runs create immutable `PolicyLegalReviewSnapshot` records.
- [ ] Smoke test passes with `npm run smoke:policy-legal`.
- [ ] `verified_regulation_count` is greater than `0` before production enablement.
- [ ] One authenticated staging claim analysis has been run end-to-end.
- [ ] Snapshot viewer confirms citations from that authenticated review.

## Production Go/No-Go

Current staging decision: **NO-GO for production**.

Observed staging status:

- [x] Staging flag enabled.
- [x] `npx prisma migrate deploy` passed.
- [x] `npx prisma generate` passed.
- [x] Seed required `DIRECT_URL` and passed.
- [x] Health endpoint green.
- [x] Admin endpoints protected.
- [x] Snapshots created.
- [x] Placeholder records not counted as regulatory support.
- [x] Verified regulation count is greater than `0`. Current observed value: `1`.
- [ ] Real authenticated staging claim analysis tested.
- [ ] Snapshot viewer confirms citations from a real authenticated review.

Production remains blocked until all of these gates pass:

- [ ] Add and validate at least one verified regulation seed in `src/lib/policyLegal/verifiedRegulations.seed.json`.
- [ ] Keep the staging seed path documented and rehearsed with `DATABASE_URL` set to `DIRECT_URL` when Neon requires direct database access.
- [ ] Run one authenticated staging claim analysis end-to-end.
- [ ] Confirm `GET /api/policy-legal/snapshots?caseId=...&claimId=...` shows citations from that real review.

## Authenticated Staging QA

Do not bypass Clerk authentication for this validation. `vercel curl` is acceptable for protected health and smoke checks, but it does not create an app-level Clerk session and cannot validate `POST /api/analysis`.

Use the current staging preview deployment:

```bash
https://collision-academy-q8p0nog4z-collision-academy.vercel.app
```

Pre-flight evidence:

- [ ] `GET /api/policy-legal/health` is green.
- [ ] `verified_regulation_count` is `1`.
- [ ] `regulation_table_reachable` is `true`.
- [ ] `npm run smoke:policy-legal` passes in Vercel curl mode.
- [ ] Staging Preview env has encrypted `DATABASE_URL` and `DIRECT_URL` for the staging branch, both pointed at the migrated/seeded Neon database.

Manual Clerk/browser validation:

- [ ] Open the staging URL in a browser.
- [ ] Complete Vercel Deployment Protection if prompted.
- [ ] Sign in through Clerk with an authorized staging QA/admin account.
- [ ] Confirm `/api/auth/status` reports `authenticated: true` in the same browser session.
- [ ] Upload a Florida estimate or test estimate document that includes:
  - [ ] Claim state `FL` or a Florida ZIP such as `33101`.
  - [ ] At least one non-OEM, aftermarket, A/M, used, recycled, or LKQ parts line so the `parts_usage` category is exercised.
- [ ] Run the normal claim analysis flow in the UI.
- [ ] Capture the returned `reportId`/case id from the UI response or network tab.
- [ ] Confirm the analysis response includes `report.policyLegalReview`.
- [ ] Confirm at least one line item has:
  - [ ] `source_type: "Regulation"`
  - [ ] `regulatory_support: "Yes"`
  - [ ] `citation: "Fla. Stat. 501.33 (2025)"`
- [ ] Confirm placeholder-backed items, if present, have:
  - [ ] `regulatory_support: "No"`
  - [ ] `citation: "No governing regulation found."`

Snapshot viewer validation:

- [ ] Open `GET /api/policy-legal/snapshots?caseId=<reportId>` in the same admin/internal authenticated browser session.
- [ ] Confirm the newest snapshot belongs to the real authenticated review.
- [ ] Confirm the snapshot contains:
  - [ ] `citations_used` includes `Fla. Stat. 501.33 (2025)`.
  - [ ] `regulation_ids_used` includes `fl-parts_usage-fs-501-33`.
  - [ ] `regulation_sources_used` includes `sourceName: "The Florida Senate"`.
  - [ ] `regulation_sources_used` includes `sourceUrl: "https://www.flsenate.gov/Laws/Statutes/2025/0501.33"`.
  - [ ] `placeholder_citations`, if present, are marked with `regulatory_support: "No"`.
- [ ] Confirm no `snapshot_creation_failure` or `policy_legal_snapshot_create_failed` event appears in staging logs for the review.

Required QA evidence before production:

- [ ] Human QA owner with staging Clerk access assigned.
- [ ] Staging URL and deployment id.
- [ ] Authenticated QA account identifier or masked email.
- [ ] Report/case id from the real analysis.
- [ ] Snapshot id from the real review.
- [ ] Screenshot or JSON excerpt showing the verified citation and source metadata.
- [ ] Screenshot or JSON excerpt showing placeholders remain unsupported.
- [ ] Confirmation that no Clerk/auth bypass was used.

Current assignment status:

- QA owner: Human QA user with staging Clerk access required.
- Production status: **NO-GO** until the full evidence checklist above is complete and reviewed.

## Smoke Testing

Local helper-mode smoke test:

```bash
npm run smoke:policy-legal
```

Live endpoint smoke test:

```bash
POLICY_LEGAL_SMOKE_BASE_URL=https://your-deployment.example npm run smoke:policy-legal
```

The live smoke checks that `/api/policy-legal/health` responds and that `/api/policy-legal/regulations?state=FL` blocks unauthenticated access.

For protected Vercel preview deployments, `vercel curl` can bypass Vercel Deployment Protection for smoke checks. It does not create a Clerk browser/session authentication context, so authenticated endpoints such as `POST /api/analysis` still require a real Clerk-authenticated browser session or equivalent test auth flow.
