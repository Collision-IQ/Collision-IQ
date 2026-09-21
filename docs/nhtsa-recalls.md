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
| `src/lib/nhtsa/recalls.ts` | recalls-by-vehicle lookup |
| `src/lib/nhtsa/vehicleRecalls.ts` | identity resolution (cached decode → vPIC → typed profile), snapshot, seen-campaign diffing, grouping, alert copy |
| `src/app/api/vehicle/recalls/route.ts` | `POST` on-demand check for the signed-in user's stored vehicle |
| `src/app/api/cron/check-recalls/route.ts` | weekly sweep; `CRON_SECRET` bearer or Platform Admin |
| `vercel.json` | schedules the sweep Monday 13:00 UTC |

## Storage

No migration. The snapshot (`recalls`) and the `seenRecallCampaignNumbers`
list live inside the existing vehicle-profile JSON row in `UploadedAttachment`
(`src/lib/userVehicleStore.ts`). `PUT /api/vehicle` whitelists client fields,
so neither can be written by a client; only the two routes above set them.

## Behaviour

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

## Local check

```bash
# as a signed-in user (or Platform Admin in dev), after saving a vehicle:
curl -X POST http://localhost:3000/api/vehicle/recalls -b "<session cookies>"
# the sweep:
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/check-recalls
```

Tests: `npx vitest run vehicleRecalls.test`.
