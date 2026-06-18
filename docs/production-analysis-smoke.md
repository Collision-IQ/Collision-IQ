# Production Analysis Smoke

Use this runbook for authenticated `/api/analysis` smoke tests against `https://www.collision-iq.ai`.

The smoke runner is local-only and requires an existing Clerk authenticated session/JWT. It does not create an unauthenticated bypass and it does not print token values.

## Route And Project

- Production UI route: `/`
- Production API route: `/api/analysis`
- Vercel project: `collision-iq-origin-main-test`
- Project id: `prj_0Tr5i29rXzcuqslnCtYTOUDotvyp`

## Inputs

Prepare uploaded attachment ids from a real signed-in test case. Include:

- at least one active carrier or shop estimate
- a large policy PDF when testing budget reductions
- a generated Collision-IQ report artifact when testing exclusion behavior
- optional support files such as CCC/MOTOR/P-page, OEM procedure, invoice, scan, or alignment evidence

Store credentials only in your local shell or a local ignored file.

```powershell
$env:ANALYSIS_SMOKE_BEARER_TOKEN = "<local Clerk session/JWT>"
$env:ANALYSIS_SMOKE_ARTIFACT_IDS = "att_1,att_2,att_3"
$env:ANALYSIS_SMOKE_USER_INTENT = "Production smoke: verify context budget, generated report exclusion, policy chunking, and provider diagnostics."
node scripts/smoke-production-analysis.cjs
```

Alternative payload file:

```powershell
$env:ANALYSIS_SMOKE_PAYLOAD_JSON = ".local-smoke/analysis-payload.json"
node scripts/smoke-production-analysis.cjs
```

The payload file should contain the same JSON the UI posts: `artifactIds`, optional `activeCaseId`, optional `userIntent`, and optional `reviewProgress`.

## Expected Assertions

The script fails if:

- auth is missing or rejected
- `/api/analysis` fails
- the response contains `context_length_exceeded`
- model diagnostics are missing or do not resolve to OpenAI `gpt-5.5`
- context-budget diagnostics are missing
- generated report artifacts are not marked excluded as primary evidence
- a large policy document is sent whole instead of reduced
- the response contains secret-like values

The script prints only aggregate diagnostics and safe booleans.
