import { sanitizeOutput } from "@/lib/ai/policy/sanitizeOutput";
import { assertCompliantOutput } from "@/lib/ai/policy/assertCompliantOutput";

export function finalizeExportPayload<T>(payload: T): T {
  const safe = sanitizeOutput(payload);
  assertCompliantOutput(safe);
  return safe;
}