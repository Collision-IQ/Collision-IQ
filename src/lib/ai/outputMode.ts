export type OutputMode =
  | "DOCUMENT_REVIEW"
  | "NEGOTIATION_SUPPORT"
  | "UMPIRING"
  | "DOI_PREP"
  | "CUSTOMER_SUMMARY";

export type EvidenceStateLabel =
  | "NOT_PRESENT"
  | "NOT_YET_LOCATED"
  | "REFERENCED_BUT_NOT_COMPLETED"
  | "SUPPORT_PRESENT_PROOF_INCOMPLETE";

export function classifyOutputMode(text: string | null | undefined): OutputMode {
  const value = text ?? "";

  if (/\b(doi|department of insurance|insurance department|regulator|complaint|bad faith|unfair claim|unfair claims|claim practice|insurance commissioner)\b/i.test(value)) {
    return "DOI_PREP";
  }

  if (/\b(customer report|customer-facing|plain english|plain language|layman|owner explanation|explain to (?:the )?(?:customer|owner))\b/i.test(value)) {
    return "CUSTOMER_SUMMARY";
  }

  if (/\b(umpire|appraisal|appraiser|award|amount of loss|amount-of-loss|which amount|decide between estimates|which estimate|what amount should be awarded)\b/i.test(value)) {
    return "UMPIRING";
  }

  if (/\b(rebuttal|negotiation|negotiate|carrier response|insurer response|pushback|revision request|supplement request|ask for revision)\b/i.test(value)) {
    return "NEGOTIATION_SUPPORT";
  }

  return "DOCUMENT_REVIEW";
}

export function buildOutputModeInstruction(mode: OutputMode): string {
  const shared = `
Evidence-state labels:
- NOT_PRESENT: use only when reviewed files affirmatively show the item is absent or contradicted.
- NOT_YET_LOCATED: use when the item may exist in uploaded, indexed, or vision-processed files but was not located in the reviewed determination set.
- REFERENCED_BUT_NOT_COMPLETED: use when the file references the item, procedure, invoice, scan, calibration, alignment, or verification, but the completion artifact is not fully isolated.
- SUPPORT_PRESENT_PROOF_INCOMPLETE: use when the operation appears supportable, but the ideal final artifact is incomplete.
- Do not convert weak proof into absence. In appraisal-facing contexts, prefer "not yet located in reviewed files", "referenced but completion record not fully isolated", "support present; final proof incomplete", or "not documented to final-award confidence".`;

  switch (mode) {
    case "UMPIRING":
      return `
OUTPUT MODE: UMPIRING
Use decisive amount-of-loss framing. Do not drift into DOI/legal complaint framing.
Include these sections when responding to an appraisal, umpire, award, amount-of-loss, or which-amount request:
1. Appraisal Recommendation
2. Award Posture
3. Why the selected posture is better supported
4. What remains not final-award confidence
5. Specific line/item vulnerabilities
6. Whether final award is ready or deferred
Allowed recommendation outcomes:
- Award shop estimate
- Award carrier estimate
- Award reconciled supported amount
- Defer final award because full-file review is incomplete
- Defer final award because amount-of-loss maturity is incomplete
Do not default to no decision when the reviewed file supports a directional answer.
Do not present a partial award as the normal answer. Use "reconciled supported amount" or "line-adjusted award recommendation" instead.
If final award is deferred, name the exact blocker: full-file review incomplete, final supplement not mature, disputed final invoice not reviewed, verified completion records not isolated, or policy/appraisal timing issue prevents finality.
${shared}`.trim();
    case "DOI_PREP":
      return `
OUTPUT MODE: DOI_PREP
Use strict jurisdiction, legal, and documented-conduct caution. A repair issue is not a legal violation by itself.
Keep "not documented" language when legal, policy, regulatory, written-denial, delay-log, or claim-conduct evidence is actually absent from reviewed files.
Do not make repair-scope disagreement sound like proven bad faith or an unfair claim practice.
${shared}`.trim();
    case "CUSTOMER_SUMMARY":
      return `
OUTPUT MODE: CUSTOMER_SUMMARY
Use plain English. Avoid technical overstatement, legal conclusions, and appraisal jargon unless the user needs it explained.
Explain practical next steps and separate known facts from what still needs review.
${shared}`.trim();
    case "NEGOTIATION_SUPPORT":
      return `
OUTPUT MODE: NEGOTIATION_SUPPORT
Use assertive repair-position support, identify leverage and vulnerabilities, and avoid legal conclusions.
Frame open items as support requests or revision asks rather than final legal findings.
${shared}`.trim();
    case "DOCUMENT_REVIEW":
    default:
      return `
OUTPUT MODE: DOCUMENT_REVIEW
Use conservative document inventory and repair-file analysis. You may say "not yet located" for incomplete review states, but do not take a final award posture.
${shared}`.trim();
  }
}

export function buildModeContext(text: string | null | undefined) {
  const mode = classifyOutputMode(text);
  return {
    mode,
    instruction: buildOutputModeInstruction(mode),
  };
}
