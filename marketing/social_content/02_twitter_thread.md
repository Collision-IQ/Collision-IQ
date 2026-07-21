# Twitter/X — Technical Breakdown Thread (6 tweets)
**Topic:** How computer vision turns damage photos into BMS/estimate lines
**Format:** 6-tweet thread. Each tweet under 280 chars. Tweet 1 is the hook — must work standalone.
**Suggested visuals:** Tweet 1: before/after (raw photo → annotated damage map). Tweet 3: bounding-box overlay screenshot. Tweet 5: generated estimate lines screenshot.

---

## Tweet 1 — Hook (under 125 chars)

30 minutes of manual CCC entry vs. 40 seconds of computer vision. Here's exactly how photos become estimate lines. 🧵

## Tweet 2 — Ingestion & normalization

Step 1: Photo intake.

The model doesn't just "look" at the photo. It normalizes angle, lighting, and distance, then identifies the vehicle — year, make, model, trim — so every downstream call maps to the *right* parts catalog. Garbage in, garbage out starts here.

## Tweet 3 — Damage detection

Step 2: Detection.

Vision models segment the vehicle into panels and components, then classify damage per zone: dent, crease, tear, misalignment, paint transfer. Each finding gets a location, a severity score, and a confidence score. Low confidence = flagged, not guessed.

## Tweet 4 — Repair logic

Step 3: Damage → operations.

This is the hard part. A 3" crease on an aluminum hood ≠ a 3" crease on a steel door. Rules + learned repair logic map each finding to repair/replace decisions, labor hours, refinish time, and the included/not-included operations manual entry always misses.

## Tweet 5 — BMS output

Step 4: Estimate lines.

Findings export as structured BMS data — real line items with part numbers, labor ops, and paint times that drop into your existing estimating platform. No rekeying. Your estimator reviews and adjusts; they don't transcribe.

## Tweet 6 — Human in the loop + CTA

Step 5: The estimator.

The AI writes the first draft. Your senior estimator makes the calls photos can't — hidden damage, calibrations, blend decisions.

Draft in seconds. Judgment where it counts.

See it on your own photos → [demo link]

## Hashtags (tweet 6 only)

#CollisionRepair #AutoBody #ComputerVision
