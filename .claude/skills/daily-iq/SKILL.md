---
name: daily-iq
description: File a week of The Daily iQ entries (the /daily-iq feed) from the Knowledge Base Daily drafts. Use when asked to update, backfill or publish The Daily iQ, port KB-Mon.md … KB-Sat.md into the app, or when a weekly routine fires to file the coming week's entries.
---

# The Daily iQ — weekly filing

The Daily iQ page (`/daily-iq`) renders `src/lib/knowledgeDaily/entries.ts`,
a hand-filed array: one numbered, dated, sourced entry per day plus a
1080x1350 card under `public/daily-iq/`. Nothing else feeds it. The weekly
Sunday Cowork batch drafts the entries as `KB-Mon.md … KB-Sat.md` in Google
Drive under `2-Collision IQ Ads › Posts › Week of YYYY-MM-DD`; this skill
ports that week into the code so the build carries it. Entries dated after
today are held back automatically and surface on their day (the page
revalidates hourly), so a whole week is filed at once.

## Procedure

1. **Find the drafts.** In Drive, open the folder `Week of <next Monday>`
   (or the week named in the request) and read `KB-Mon.md` … `KB-Sat.md`.
   Each carries the entry number, the posting day, the selected hook, the
   body, the source line and a "Figure trace". Entry numbers continue from
   the highest `entryNumber` already in `entries.ts`; if the drafts and the
   file disagree, the file wins and the drafts are renumbered.
2. **Verify every figure and find every source URL.** Search for the cited
   article and confirm the figures, dates and wording. Fix the draft where
   newer coverage supersedes it (a proposed rule adopted, a bill signed) and
   say so in the entry. Rules:
   - Every source is a public `https` article or document reached by a
     search result. Never link a licensed estimating guide host
     (`mymitchell.com`, `cccis.com`, `vercel.com`); cite coverage instead.
   - Never invent a figure, a date, a quote or a source. If a figure cannot
     be verified, leave it out of the entry and note it in the PR.
3. **Append the entries** to `ENTRIES` in `src/lib/knowledgeDaily/entries.ts`
   following the existing shape: `entryNumber`, `slug`, `date` (the posting
   day, ISO), `category` (one of `KnowledgeDailyCategory`), `headline` (the
   selected hook), `keyFigure` + `keyFigureLabel`, `summary` paragraphs in
   plain English, `whyItMatters`, `howCollisionIqUsesIt` (the archivist
   line, never a product pitch), `sources` with `kind`
   (`primary` for the document or dataset, `coverage` for reporting,
   `reference` for statutes and bills), `tags` (the draft's hashtags without
   `#`), `image` (`/daily-iq/kb-NNN-<slug-fragment>.png` and an alt that
   names the figure), and optionally `cardSource` for the card's source line.
4. **Render the cards** — `node scripts/daily-iq/render-cards.mjs` renders a
   card for every entry that lacks one (deterministic, no network).
5. **Prove it** — `npx vitest run knowledgeDaily.test` must pass (numbering,
   one entry per day, dates ascending, https sources, cards on disk,
   date gating), then `npx tsc --noEmit -p tsconfig.json`.
6. **Ship it** — commit entries, cards and nothing else on a branch named
   `daily-iq/week-of-YYYY-MM-DD`, push, and open a PR to `main` titled
   `Daily iQ: file entries #A–#B (week of YYYY-MM-DD)` whose body lists each
   entry's number, date, headline and source URL, and any figure that
   could not be verified. Production deploys on merge; each entry then
   appears on its own day.

## What not to do

- Do not backdate: an entry's `date` is its posting day from the draft.
- Do not skip a day silently; if a draft is missing, say which one.
- Do not edit published entries' facts without a note in the PR.
- Do not touch `KnowledgeDailyFeed.tsx` or the page for a routine filing.
