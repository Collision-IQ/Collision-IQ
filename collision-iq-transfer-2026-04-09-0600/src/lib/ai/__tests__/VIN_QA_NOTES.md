# VIN QA Notes

- Runtime VIN decode authority stays `NHTSA vPIC`. Local decode hints in `vehicleContext.ts` are only for candidate ranking and display backfill when external decode data is not present.
- External consumer decoders such as KBB are QA-only spot-checks. Do not call, scrape, or depend on KBB in app code.
- Manual spot check flow:
  1. Resolve VIN and vehicle identity in-app from the same fixture or document set.
  2. Compare the resolved VIN against the labeled document VIN.
  3. Compare the resolved year/make/model against NHTSA vPIC first.
  4. Optionally compare the same VIN in KBB as a secondary consumer benchmark to catch display mismatches.
  5. If vPIC and the app disagree, treat vPIC as canonical and fix the resolver or upstream mapping. If only KBB differs, treat that as a QA signal, not an implementation source.
