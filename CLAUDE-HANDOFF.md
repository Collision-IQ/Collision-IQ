# Claude Code hand-off — RO21888 report fixes + chat input feature

Context: reviewed the latest test output for **Shop Final 21888.pdf** vs **SOR-3
21888.pdf** (delta + OEM citation-density reports, customer report, repair-
intelligence report). Below are the confirmed defects with file/line, root cause,
and the exact fix, then one new feature. Fix top-to-bottom, run the noted tests,
then commit + deploy (main auto-deploys to Vercel).

Repo: `collision-iq`. Reproduce by regenerating the RO21888 reports after each fix.

---

## 1. [HIGH] Part numbers scrubbed as phone numbers (`[REDACTED_PHONE]`)

**Symptom:** 23 findings show `[REDACTED_PHONE]` where an OEM part number belongs,
e.g. `LT Lower cntrl arm GLE350, [REDACTED_PHONE]`, `Lower panel [REDACTED_PHONE]`,
`Harness surround view [REDACTED_PHONE]`. Destroys the strongest matching/supplement
evidence.

**File:** `src/lib/reports/annotatedCitationDensityEstimate.ts` — `redactAnnotationText()`, line ~6771.

**Root cause:** the phone regex has **optional** separators, so a bare 10-digit
part number (`1678850708`) matches `\d{3}\d{3}\d{4}`:
```js
.replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[REDACTED_PHONE]")
```

**Fix:** require phone formatting (parens or real separators). Bare digit runs
(part numbers) then won't match; real phones in these docs always have separators:
```js
.replace(/\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)\s?\d{3}[-.\s]?\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4})\b/g, "[REDACTED_PHONE]")
```
Also check `redactDownloadContent` and any other files with the same regex
(`grep -rn "REDACTED_PHONE" src`) — apply the same separator-required pattern so
part numbers survive everywhere (findings report + annotations + chat export).

**Verify:** regenerate RO21888 findings; confirm 0 `[REDACTED_PHONE]` on part-number
rows and that real phones (e.g. `(215) 866-8390`) are still redacted. Add a unit
test with inputs `"Lower panel 1678850708"` (must NOT redact) and
`"(215) 866-8390"` / `"215-866-8390"` (must redact).

---

## 2. [HIGH] Paint Labor rate delta missing from ESTIMATE TOTALS

**Symptom:** annotated report page 7 highlights Body Labor (①) and Paint Supplies
(②) but NOT Paint Labor — yet Paint Labor differs just as much: shop 15.3 hrs @ $75
vs SOR 11.8 hrs @ $60 = **$439.50** category gap (+$15/hr, +3.5 hr). Only 2 RATE
DELTA findings exist; Paint Labor is absent from anchored AND unanchored lists.

**Where it is NOT:** `compareEstimateTotals()` in
`src/lib/reports/estimateDeltaMatcher.ts` (~line 1553) is correct — it loops every
higher category and emits `rate_difference` for each that differs, so it produces
Body Labor, Paint Labor, AND Paint Supplies deltas. Confirm with a direct unit
call.

**Root cause (downstream anchor drop) — check these two spots:**
1. `src/lib/reports/annotatedCitationDensityEstimate.ts` ~line 2401:
   ```js
   claimAnchor((text) => text.includes(categoryNeedle));
   ...
   if (!anchor) continue; // never emit an unanchored finding
   usedAnchorIds.add(anchor.anchorId);
   ```
   If the Paint Labor totals row has no eligible anchor (or its anchor was already
   claimed/deduped), the finding is silently dropped.
2. `src/lib/reports/citationDensityRowAnchors.ts` ~line 630:
   ```js
   const seen = new Set<string>();
   if (seen.has(anchorId)) continue; seen.add(anchorId);
   ```
   Most likely culprit: **Body Labor and Paint Labor share the same $75.00 rate**,
   so their totals-row `anchorId` collides and Paint Labor's anchor is dropped as a
   duplicate. Make the totals-row anchorId include the category name / row index so
   Body Labor and Paint Labor produce distinct anchors.

**Fix:** ensure each ESTIMATE TOTALS category row gets a unique anchorId (include
`category` or the row's page-line index in the anchorId), so all differing labor
categories anchor and emit. Confirm Mechanical Labor (only on lower) still behaves.

**Verify:** regenerate RO21888; expect **3** RATE DELTA findings (Body Labor, Paint
Labor, Paint Supplies), each highlighted on the totals page. Extend
`src/lib/reports/ro21888Regression.test.cjs` to assert all three.

---

## 3. [HIGH] Repair-intelligence "Research Leads" pull irrelevant law + wrong-make OEM

**Symptom (repair-intelligence-report.pdf):**
- Law leads: `Class Deviation RFO-: FAR` (federal procurement reg) and
  `Lead and Copper Rule | Department of Environmental` (EPA drinking-water rule) —
  both irrelevant to collision repair.
- OEM leads: `Nissan/INFINITI Position Statements` and `GM Parts` position
  statements — the vehicle is a **Mercedes-Benz GLE**. Wrong make.

**Files:** `src/lib/ai/exportResearch.ts`, `src/lib/ai/vehicleApplicability.ts`,
tests `src/lib/ai/exportResearchOemFiltering.test.cjs`,
`src/lib/ai/builders/exportResearchSections.ts`.

**Root cause:** the report already flags these "NOT JURISDICTION VERIFIED" and
"NOT MAKE-SPECIFIC" — so the app knows they're weak but still surfaces them.

**Fix (pick per product intent):**
- Law leads: domain-filter out non-automotive/non-insurance sources. Drop titles
  matching `/\b(FAR|federal acquisition|lead and copper|drinking water|EPA|procurement|class deviation)\b/i`
  and only keep DOI / state-insurance / OEM-repair-procedure / collision sources.
- OEM leads: gate on `vehicleApplicability` — suppress position statements whose
  make != the vehicle make (Mercedes-Benz here), or at least never rank wrong-make
  leads above make-specific ones. If no make-specific lead is found, show a
  "no verified make-specific statement found" line rather than GM/Nissan.
- Simplest safe option: **do not render** "NOT JURISDICTION VERIFIED" / "NOT
  MAKE-SPECIFIC" sections in the customer-facing/adjuster-facing PDF; keep them
  internal only.

**Verify:** regenerate RO21888 repair-intelligence; law section shows only
relevant/insurance/OEM-procedure sources; OEM section shows Mercedes-Benz (or an
honest "none found"), never GM/Nissan.

---

## 4. [MED] Customer report INSURER shows "AAA" (misidentified carrier)

**Symptom (customer-report.pdf):** `INSURER: AAA`. The carrier is Foremost /
Economy Preferred (per the estimates); "AAA" bleeds in from the tire vendor
`AAA Car Care Center`. Also inconsistent with repair-intelligence, which shows
`[REDACTED_INSURER]`.

**Fix:** find the insurer/carrier extraction (grep `insurer|carrier|insurance company`
in `src/lib/reports` and the analysis route). Pull the carrier only from the estimate
header "Insurance Company" / SOR carrier block; explicitly exclude vendor strings
(`/car care|tire|AAA Car Care|discount|goodyear|mavis/i`). Make the insurer label
consistent across all three report types (customer, repair-intelligence, snapshot).

**Verify:** customer report shows the real carrier (or a single consistent
redaction), never a tire vendor.

---

## 5. [MED] OEM finding anchored to abbreviation legend (0/100 false positive)

**Symptom (delta-citation-density-findings.pdf, Finding 47):** `NEEDS OEM`, score
`0/100`, anchor `...:p9:192:supplier_row`, row text `OEM) parts are OEM parts that
may be pro…` — that's the estimate's **abbreviation legend**, not a real non-OEM
line.

**Fix:** in the finding filter, drop findings whose anchor is a
`supplier_row`/legend/boilerplate row, or whose score is 0. Legend text is
detectable (contains `OEM) parts are OEM parts`, `A/M=Aftermarket`, `LKQ=Like Kind`,
`the following is a list of abbreviations`). See
`src/lib/reports/citationDensityRowAnchors.ts` `isAnchorEligible` (~line 716) —
exclude legend rows there too.

**Verify:** the genuine A/M items (A/M fender liner deducted −$165, A/M rivet) are
what get OEM-flagged; the 0/100 legend finding is gone.

---

## 6. [MED] Duplicate tire finding

**Symptom:** Cooper 255/50R19 produces two findings — `reduced_labor` (p4/l75) and
`expanded_scope` (p10/l75) — for the same tire.

**Fix:** dedupe findings by normalized (part number OR description + line) before
emit, keeping the higher-scored one. If the tire legitimately appears on two pages,
collapse to a single finding referencing both.

**Verify:** one tire finding for RO21888.

---

## 7. [LOW] Malformed PDF name tokens (100+ render warnings)

**Symptom:** `pdftoppm` prints 100+ `name token is longer than what the
specification says it can be`. The full anchor IDs (e.g.
`required-detector-delta-expanded-scope-coop-255-50r19-...-p10-75-estimate`) are
embedded as PDF name objects, exceeding the 127-byte PDF name limit. Renders in
most viewers but can break strict ones.

**Fix:** when using an anchorId as a PDF name / named destination / link target,
hash or truncate it (e.g. first 40 chars + short hash) instead of the raw string.
Search the PDF builder in `annotatedCitationDensityEstimate.ts` for where anchorId
is passed to a name/dest/annotation ref.

**Verify:** `pdftoppm` renders RO21888 reports with no name-token warnings.

---

## 8. [FEATURE] Chat input: enable spell check + text prediction (mobile + desktop)

**Symptom:** the chat composer has spell check disabled.

**File:** `src/components/ChatWidget.tsx` ~line 4723 textarea:
```jsx
spellCheck={false}
autoCorrect="on"
autoCapitalize="sentences"
```

**Fix:** enable native spell check + predictive text on every chat message input.
On the composer textarea(s) in `ChatWidget.tsx` (~4723) and `ChatbotPage.tsx`
(textareas ~4681, ~4910), set:
```jsx
spellCheck={true}
autoCorrect="on"
autoCapitalize="sentences"
autoComplete="on"
// (do NOT set inputMode="none"; leave default so mobile predictive keyboards show)
```
- `spellCheck` gives desktop red-underline misspelling detection + right-click
  suggestions.
- `autoCorrect` + `autoCapitalize` + default keyboard give iOS/Android predictive
  text and autocorrect.
Apply to the main message composer(s) only — not to numeric/code inputs. Verify on
desktop (misspell "recieve" → underlined) and mobile (predictive bar appears above
keyboard).

Note: true *inline* desktop text-prediction (ghost-text autocomplete) is not native
— if that's wanted, it needs a small suggestion component; the above delivers native
spell check + mobile prediction, which is the standard interpretation.

---

## Verify & deploy

1. Run the report unit tests after fixes:
   ```bash
   node src/lib/reports/ro21888Regression.test.cjs
   node src/lib/reports/annotatedCitationDensityEstimate.test.cjs
   node src/lib/ai/exportResearchOemFiltering.test.cjs
   ```
2. Regenerate the RO21888 report suite and eyeball: 3 rate deltas, no
   `[REDACTED_PHONE]` on parts, relevant leads only, correct insurer, no legend
   finding, one tire finding, no PDF name warnings, chat spell check on.
3. `npm run build` (catch type errors) then:
   ```bash
   git add -A
   git commit -m "Fix RO21888 report defects (redaction, paint-labor delta, research leads, insurer, dedup, pdf names) + chat spellcheck"
   git push origin main   # triggers Vercel prod deploy
   ```
