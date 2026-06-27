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

## 1A. Report Intelligence Retrieval Lanes (env → feature → symptom)

The chat + Citation Density reports are correct in code but several lanes are **gated on
environment keys**. If a key is absent the feature degrades gracefully (honest "not configured" /
keyword-only), it does not crash. Verify each lane below, then confirm via
`GET /api/admin/integrations-health` (see `services.authorityRetrieval`, `services.googleDrive`,
and `inventory[].envPresent`).

| Lane / feature | Required env | Optional env | Symptom when missing |
| --- | --- | --- | --- |
| **LLM (chat, analysis, all reports)** | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL_PRIMARY` (default `claude-opus-4-8`), `ANTHROPIC_BASE_URL` | Chat/analysis/report generation fails. |
| **Embeddings / Drive semantic search** | `VOYAGE_API_KEY` | `VOYAGE_EMBED_MODEL` (default `voyage-3-large`) | Drive search falls back to **keyword-only** (`[drive] query embedding unavailable…`). `authorityRetrieval.vectorSearchAvailable=false`. |
| **Internet authority (OEM Citation Density) + market comps + deep research** | `SERPER_API_KEY` *(or `GOOGLE_SERPER_API_KEY`)* | — | OEM findings stay **AUTHORITY TRACE INCOMPLETE**; market preview `provider_not_configured`. A 4xx now logs the Serper body (`[web-retrieval] Serper query failed`, market-preview `failureReason`) → check key/credits. |
| **Internal OEM authority (Google Drive DMS)** | `GOOGLE_DRIVE_ENABLED=true`, `GOOGLE_SHARED_DRIVE_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` *(or `GOOGLE_SA_JSON`)*, `GOOGLE_IMPERSONATION_USER` *(or `GOOGLE_IMPERSONATE_SUBJECT`)*, `GOOGLE_OEM_PROCEDURES_FOLDER_ID`, `GOOGLE_OEM_POSITION_STATEMENTS_FOLDER_ID` | `GOOGLE_PA_LAW_FOLDER_ID`, `GOOGLE_PA_INSURANCE_POLICIES_FOLDER_ID` | Drive search "disabled or not configured"; OEM falls back to the internet lane only. **Also requires `VOYAGE_API_KEY` + `document_chunks` re-ingested with the current Voyage model** (legacy OpenAI-dim vectors auto-fall back to keyword). |
| **Estimate embedded links (Egnyte, own DMS)** | `EGNYTE_BASE_URL`, `EGNYTE_API_TOKEN` | `EGNYTE_CLIENT_ID`, `EGNYTE_CLIENT_SECRET` (OAuth) | `*.egnyte.com` estimate links are recognized as fetchable but report "Egnyte repository link recognized, but the Egnyte integration is not configured." Vendor sites (e.g. `teslaunch.net`) correctly stay unsupported. |

Expected report behavior once configured (verified this cycle):
- **Delta Citation Density** annotates the **higher-cost** estimate and highlights what the
  lower-cost estimate is missing/reduced (pair-agnostic; mostly shop-vs-insurance).
- **OEM Citation Density** annotates the **higher/final** estimate and enhances each line with
  OEM / jurisdictional / policy / internet authority; unverified internet hits are labeled
  **ONLINE FALLBACK**, never VERIFIED OEM.

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
