---
name: neutral-estimate-review
description: Use this when estimate reviews, comparison reports, rebuttal drafts, or export summaries start sounding one-sided, verdict-first, repetitive, or too eager to say the shop is stronger. Keep the review evidence-led, open-minded, and trustworthy to all sides.
---

# Neutral Estimate Review

## Purpose
Keep estimate-review outputs fair, open-minded, and file-specific so shops, carriers, and owners can all trust the read.

## Use this for
- buildExportModel.ts
- rebuttalEmailPdfBuilder.ts
- comparison/summary builders
- report phrasing that feels too one-sided or repetitive

## Do not use this for
- retrieval orchestration
- route handlers
- database/schema work
- chat-only humor/tone changes
- legal disclaimer plumbing

## Core rules
- Start with what the file documents, not with a verdict.
- Do not default to "shop stronger" or "carrier weaker."
- Let the file stay mixed when support is mixed.
- A stronger-position statement is allowed only when the documentation clearly supports it.
- Keep outputs trustworthy to all sides.
- Preserve OEM, procedure, safety, and evidence discipline.
- No profanity.
- No jokes in formal exports.
- Professional, neutral, editable wording only.

## Preferred review order
1. What is clearly documented in the estimate(s), photos, procedures, and support.
2. What appears supportable but still needs documentation or verification.
3. What is still open, mixed, or unclear.
4. Which position reads stronger, only if the file clearly supports that conclusion.

## Linked-document review
- Scan uploaded estimate text for linked support documents.
- When estimate links are present, review relevant linked documents before finalizing the estimate review.
- Relevant linked documents include OEM procedures, OEM position statements, ADAS reports, paint/refinish documents, and insurer-support documents tied to the estimate.
- If the link is an Egnyte link, use the existing local Egnyte integration and environment configuration already present in the repo.
- Do not expose credentials, tokens, or raw secret values.
- Treat linked documents as supporting evidence, not automatic scope expansion.
- If linked support changes the conclusion, say what changed and why.
- If linked support is unavailable, continue with the estimate and file evidence already in hand.

## Writing rules
- Prefer evidence-led phrasing over verdict-led phrasing.
- Avoid always using the same opening sentence.
- Avoid repeating these formulas unless the file truly calls for them:
  - "reads as materially more complete"
  - "the clearest remaining issues are"
  - "the strongest concerns are"
  - "the current material does not clearly document"
- Vary sentence shape and paragraph structure without randomization.
- Keep the result deterministic and testable.
- When appropriate, use language like:
  - "The current file documents..."
  - "The estimate clearly carries..."
  - "Support appears mixed on..."
  - "This item may be supportable, but the current documentation is thin."
  - "At this stage, the stronger support sits with..."
  - "The current record does not yet justify a stronger conclusion either way."

## What to preserve
- Existing export model shape
- Existing safety/OEM-grounded conclusions
- Existing disclaimers
- Existing rebuttal/PDF professionalism

## Success criteria
- Outputs feel less canned and less one-sided.
- Different estimate reviews do not all sound the same.
- The system can still conclude one side is stronger when the file truly supports it.
- Formal outputs remain clean, neutral, and credible.
