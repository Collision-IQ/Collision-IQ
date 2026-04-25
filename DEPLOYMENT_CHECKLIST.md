# Collision IQ Deployment Checklist

Use this before a production release.

## 1. Environment Variables

- Confirm required app secrets are present in the target environment.
- Confirm OpenAI/API provider keys are present and scoped correctly.
- Confirm database connection strings are present for the target deployment.
- Confirm auth provider variables are present.
- Confirm Stripe variables are present:
  - Checkout/session secret keys
  - Webhook secret
  - Price/product IDs
  - Customer portal configuration, if applicable
- Confirm Google Drive credentials and allowed scopes are present.
- Confirm Serper/search API key is present when web retrieval should run.
- Confirm internal API key variables are present, including `INTERNAL_AGENT_API_KEY`.
- Confirm Collision Snapshot email variables are present when in-app sending should work:
  - `RESEND_API_KEY`
  - `SNAPSHOT_FROM_EMAIL` or `RESEND_FROM_EMAIL`
- If Snapshot email variables are intentionally absent, confirm the send flow clearly tells the user to download the PDF and send manually.
- Confirm CRM sync is intentionally configured or disabled:
  - `HUBSPOT_PRIVATE_APP_TOKEN` is present only when HubSpot event forwarding should run.
  - Without the token, CRM hooks log safe skipped events and do not block user flow.
- Confirm voiceover is intentionally configured or disabled:
  - `NEXT_PUBLIC_COLLISION_IQ_ENABLE_SERVER_TTS=true` for launch-quality read-aloud.
  - Optional `NEXT_PUBLIC_COLLISION_IQ_TTS_VOICE` such as `nova`.
  - Browser/system TTS is disabled by default; enable only for fallback testing with `NEXT_PUBLIC_COLLISION_IQ_ENABLE_BROWSER_TTS=true`.

## 2. Static Checks

Run:

```bash
npx tsc --noEmit --pretty false
npx eslint .
npm run test:claim-specific-reports
```

## 3. Stripe Checkout / Portal

- Create a checkout session in test mode.
- Complete a test card payment.
- Confirm entitlement updates after webhook processing.
- Open the customer portal from an authenticated account.
- Confirm subscription state, cancellation/update flow, and return URL behavior.
- Confirm failed or incomplete payment states do not unlock paid features.

## 4. Drive + Serper Retrieval

- Run a claim with relevant Google Drive documents available.
- Confirm Drive retrieval contributes only when documents are applicable.
- Run a claim requiring web/OEM lookup.
- Confirm Serper success surfaces usable web/OEM retrieval only when sources influenced included findings.
- Simulate or verify Serper failure.
- Confirm the report shows `FAILED` without implying web/OEM support.

## 5. Report Reasoning QA

- Confirm every included finding shows:
  - Why it matters
  - What proves it
  - Next action
  - Evidence level
- Confirm unsupported/default findings are suppressed.
- Confirm no ADAS, structural, cooling, corrosion, test-fit, OEM-fit, or legal issue appears unless the claim fingerprint/evidence map supports it.
- Confirm `suppressedFindings` appears only in debug/internal response, not user-facing UI.

## 6. PDF Smoke Test

- Export Collision Repair Intelligence Report.
- Export Dispute Intelligence Report.
- Export Rebuttal Email.
- Confirm PDFs generate without font warnings.
- Confirm all PDF sections render without clipped text or missing bullets.
- Confirm rebuttal email uses numbered asks and avoids banned generic phrases.

## 7. Report UI / PDF Visual QA

- Review desktop and mobile report UI.
- Confirm Finding Reasoning, Retrieval Summary, and Dispute Strategy are concise and readable.
- Confirm source details appear only when they influenced included findings.
- Confirm debug internals are not shown to end users.
- Confirm PDF output matches the visible report logic.
- Confirm Collision Snapshot preview, copied summary, PDF, and send payload contain no raw VIN, claim number, owner name, phone, email, address, or debug data.
- Confirm Collision Snapshot manual mode appears when `RESEND_API_KEY` or sender env vars are missing.

## 8. Observability Log Check

- Trigger `/api/internal/agent-review`.
- Confirm a structured log event appears:
  - `[agent-review:report-observability]`
- Confirm it includes:
  - Claim fingerprint summary counts/flags
  - Retrieval counts
  - Serper status
  - Included findings count
  - Suppressed findings count
  - OEM evidence found
  - Dispute leverage score
  - Generic phrase suppression count

## 9. No PII / Raw Text Logging

- Inspect production/staging logs for the agent-review run.
- Confirm logs do not include:
  - Uploaded file text
  - Raw estimate text
  - Full retrieved documents
  - VINs
  - Customer names
  - Claim numbers
  - Document URLs
  - Full finding prose
- Confirm only safe structured counts, booleans, statuses, and category buckets are logged.

## 10. Final Release Gate

- Static checks pass.
- Stripe checkout and portal pass.
- Drive and Serper retrieval pass.
- PDFs pass smoke test.
- Report UI/PDF visual QA passes.
- Observability log appears and contains no PII/raw text.
- `npm run test:claim-specific-reports` passes.
