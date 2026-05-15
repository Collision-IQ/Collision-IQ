---
name: export-voice-detemplating
description: Use this when formal estimate-review exports, rebuttal emails, or PDF/report builders feel repetitive, cookie-cutter, verdict-first, or too templated. Do not use for retrieval, route handlers, or chat-only tone changes.
---

# Export Voice De-Templating

## Purpose
Make formal outputs feel more evidence-led, open-minded, file-specific, and trustworthy to shops, carriers, and owners.

## Files to inspect first
- buildExportModel.ts
- rebuttalEmailPdfBuilder.ts
- exportPdf.ts only if wording is clearly being injected there

## Rules
- Preserve the underlying conclusion if the file still supports it.
- Do not make outputs default pro-shop or pro-carrier.
- Do not touch retrieval, route handlers, or legal disclaimer plumbing.
- Keep exports professional and clean.
- No profanity.
- No jokes in formal exports.
- Avoid repetitive phrasing across estimate reviews.
- Do not always lead with a verdict.
- Prefer evidence-led prose:
  - what the file documents clearly
  - what remains open or under-supported
  - where one side is stronger, only if the file supports that
- Avoid overusing these formulas:
  - "reads as materially more complete"
  - "the clearest remaining issues are"
  - "the strongest concerns are"
  - "current material does not clearly document"
- Vary sentence openings and paragraph structure without randomizing.
- Keep behavior deterministic and testable.

## Preferred workflow
1. Inspect current export phrasing before changing code.
2. Find the smallest render-layer patch point.
3. Adjust wording generators, not core repair logic.
4. Preserve export model shape.
5. Summarize what changed and any remaining repetition risk.

## Success criteria
- Formal outputs feel less canned.
- Different estimate reviews do not all sound the same.
- Exports remain professional, editable, and trustworthy.
- Core conclusions remain OEM/safety-grounded.