---
name: estimate-linked-docs
description: Use this when uploaded estimates contain document links, especially Egnyte links, that may point to OEM procedures, position statements, ADAS reports, paint/refinish documents, or other repair-support materials relevant to the review.
---

# Estimate Linked Documents

## Purpose
Review linked support documents referenced inside uploaded estimates when those documents are relevant to the repair review.

## Rules
- Scan estimate text for links before finalizing the review.
- Use relevant linked documents as supporting evidence.
- Egnyte links should be accessed through the existing repo integration and local environment configuration.
- Never expose secrets or private tokens.
- Do not force linked-document review when no relevant links are present.
- Do not treat linked materials as permission to invent unsupported scope.
- If a linked document is unavailable, note that briefly and continue with the available evidence.

## Priority
1. Estimate facts
2. Linked OEM / position statement / ADAS / paint documents
3. Other supporting documents

## Success criteria
- Linked support documents are reviewed when present and relevant.
- Conclusions stay grounded in the estimate and evidence.
- Sensitive credentials remain protected.