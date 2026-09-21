# NHTSA safety recalls in "My Vehicle"

Two free, keyless NHTSA endpoints back the recall feature:

1. **vPIC** (`vpic.nhtsa.dot.gov`) decodes a VIN into make / model / model year.
2. **Recalls API** (`api.nhtsa.gov/recalls/recallsByVehicle`) returns campaigns
   for a make / model / model year.

The recalls endpoint does **not** take a VIN, so every hit is a
"may apply to vehicles like yours" match, never a VIN-exact confirmation.
`RECALL_MATCH_DISCLAIMER` (`src/lib/nhtsa/types.ts`) carries that caveat on
every surface (panel, email) and points owners at NHTSA's VIN checker.

## Pieces

| Path | Role |
| --- | --- |
| `src/lib/nhtsa/client.ts` | fetch with timeout + backoff (429/5xx) |
| `src/lib/nhtsa/vinDecode.ts` | vPIC decode; distinct from the offline `decodeVinVehicleIdentity`, which has no model |
| `src/app/api/vehicle/decode-vin/route.ts` | `POST { vin }` → decoded fields for the My Vehicle form; persists nothing |
| `src/lib/nhtsa/recalls.ts` | recalls-by-vehicle lookup |
| `src/lib/nhtsa/vehicleRecalls.ts` | identity resolution (cached decode → vPIC → typed profile), snapshot, seen-campaign diffing, grouping, alert copy |
| `src/app/api/vehicle/recalls/route.ts` | `POST` on-demand check for the signed-in user's stored vehicle |
| `src/app/api/cron/check-recalls/route.ts` | weekly sweep; `CRON_SECRET` bearer or Platform Admin |
| `vercel.json` | schedules the sweep Monday 13:00 UTC |
| `src/lib/nhtsa/chatRecallLookup.ts` | chat: recall-question detection, vehicle selection, live lookup, evidence block for the model |

## Storage

No migration. The snapshot (`recalls`) and the `seenRecallCampaignNumbers`
list live inside the existing vehicle-profile JSON row in `UploadedAttachment`
(`src/lib/userVehicleStore.ts`). `PUT /api/vehicle` whitelists client fields,
so neither can be written by a client; only the two routes above set them.

## Behaviour

- **VIN decoder in the form.** A well-formed 17-character VIN typed or
  pasted into My Vehicle is decoded by NHTSA vPIC (debounced, once per
  distinct VIN) and the year, make and model fill in automatically; the
  decode outranks what was typed. A VIN that is missing or cannot be decoded
  leaves manual entry as the fallback, with the reason shown under the field.
  A VIN loaded from the saved profile is not re-decoded over saved values.
- Saving a new or changed VIN / year / make / model in the panel triggers an
  immediate check; "Re-check recalls" re-runs it. Campaigns returned are
  marked seen because the owner saw them in the panel.
- The weekly sweep groups stored vehicles by year/make/model (one NHTSA call
  per configuration, 250 ms apart), decodes a VIN at most once (the identity
  is cached on the snapshot), refreshes every snapshot, and emails owners via
  Resend only for campaigns not yet seen. Without `RESEND_API_KEY` the sweep
  still updates the in-app snapshot and reports `emailsSent: 0`.
- Open campaigns feed the My Vehicle nav dot through the existing
  `markVehicleMaintenanceIfChanged` fingerprint (`recall:<campaign>` keys).
- **Chat** (`/api/chat`): a recall question (e.g. "Check for recall: <VIN>",
  "any open recalls on my car?") triggers a live lookup before the model's
  first pass. Vehicle precedence: VIN in the message → vehicle resolved from
  the case/attachments → the signed-in user's saved My Vehicle. The result is
  appended to the system instructions as an evidence block that forbids
  answering from memory, requires campaign numbers, and carries the
  year/make/model caveat; the same block reaches the research-mode
  refinement pass. When the vehicle checked is the saved one, the snapshot
  and seen list are persisted so the weekly sweep does not re-alert. With no
  identifiable vehicle the model is told to ask for a VIN rather than guess.

## Local check

```bash
# as a signed-in user (or Platform Admin in dev), after saving a vehicle:
curl -X POST http://localhost:3000/api/vehicle/recalls -b "<session cookies>"
# the sweep:
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/check-recalls
```

Tests: `npx vitest run vehicleRecalls.test`.
