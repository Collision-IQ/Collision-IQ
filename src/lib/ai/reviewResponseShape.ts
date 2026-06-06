export type ReviewResponseShape = "default" | "customer_repair_report" | "carrier_policy_dispute";

const DEFAULT_SHAPE_INSTRUCTION = `
Use this response structure:
Bottom line:
[1-2 sentence direct answer]

What the documents support:
- [up to 3 bullets]

What is not proven yet:
- [up to 3 bullets]

Best next step:
[one practical action]
`.trim();

const CUSTOMER_SHAPE_INSTRUCTION = `
Use this response structure:
- What we found
- What still needs to be verified
- Why it matters
- What you can ask for
- Bottom line
`.trim();

const CARRIER_SHAPE_INSTRUCTION = `
Use this response structure:
- Bottom line
- Documented
- Not located / not established
- Policy language needed
- Recommended carrier-facing ask
`.trim();

export function resolveReviewResponseShape(userMessage: string): ReviewResponseShape {
  const lower = userMessage.toLowerCase();

  const customerRepairSignal =
    /\b(customer[-\s]?facing|for (the )?customer|owner[-\s]?facing|plain language|customer repair report)\b/.test(
      lower
    );

  if (customerRepairSignal) {
    return "customer_repair_report";
  }

  const carrierPolicySignal =
    /\b(fet|policy dispute|carrier|insurer|claim denial|claim dispute|coverage|declaration page|endorsement|doi|department of insurance|formal rebuttal|rebuttal letter|appraisal demand|bad faith)\b/.test(
      lower
    );

  if (carrierPolicySignal) {
    return "carrier_policy_dispute";
  }

  return "default";
}

export function buildReviewResponseShapeInstruction(userMessage: string): string {
  const shape = resolveReviewResponseShape(userMessage);

  if (shape === "customer_repair_report") {
    return CUSTOMER_SHAPE_INSTRUCTION;
  }

  if (shape === "carrier_policy_dispute") {
    return CARRIER_SHAPE_INSTRUCTION;
  }

  return DEFAULT_SHAPE_INSTRUCTION;
}
