/**
 * Collision Learning Engine — interleaving.
 *
 * The engine must not study one topic in isolation: due items are re-ordered
 * so consecutive items come from different domains wherever possible, and
 * interleaved cases combine several domains into one scenario prompt.
 */

export type InterleavableItem = {
  id: string;
  domain: string;
  safetyCritical: boolean;
  prompt: string;
  objective: string;
};

/**
 * Round-robin across domains (stable within each domain). Safety-critical
 * items keep overall priority by being first within their domain queue, which
 * preserves the caller's `safetyCritical desc, dueAt asc` ordering.
 */
export function interleaveLearningItems<T extends { id: string; domain: string }>(items: T[]): T[] {
  if (items.length <= 2) return [...items];

  const queues = new Map<string, T[]>();
  const domainOrder: string[] = [];
  for (const item of items) {
    if (!queues.has(item.domain)) {
      queues.set(item.domain, []);
      domainOrder.push(item.domain);
    }
    queues.get(item.domain)!.push(item);
  }

  const result: T[] = [];
  let previousDomain: string | null = null;
  while (result.length < items.length) {
    // Pick the next non-empty domain, preferring one different from the last.
    const candidates = domainOrder.filter((domain) => (queues.get(domain)?.length ?? 0) > 0);
    if (candidates.length === 0) break;
    const pick =
      candidates.find((domain) => domain !== previousDomain) ?? candidates[0];
    const item = queues.get(pick)!.shift()!;
    result.push(item);
    previousDomain = pick;
    // Rotate the domain order so all domains keep circulating.
    const index = domainOrder.indexOf(pick);
    domainOrder.push(...domainOrder.splice(index, 1));
  }
  return result;
}

/** True when no two consecutive items share a domain (unless unavoidable). */
export function isWellInterleaved(items: Array<{ domain: string }>): boolean {
  const domains = new Set(items.map((item) => item.domain));
  if (domains.size <= 1) return true;
  for (let index = 1; index < items.length; index += 1) {
    if (items[index].domain === items[index - 1].domain) {
      // Allowed only when a single domain dominates and no alternative existed;
      // detect the trivial violation: another domain still had items nearby.
      const rest = items.slice(index);
      if (new Set(rest.map((item) => item.domain)).size > 1) return false;
    }
  }
  return true;
}

/**
 * Compose one mixed-discipline case prompt from items spanning ≥3 domains.
 * The composed case carries NO gold answers — only the scenario and asks.
 */
export function composeInterleavedCasePrompt(items: InterleavableItem[]): string {
  const domains = [...new Set(items.map((item) => item.domain))];
  const asks = items.map((item, index) => `${index + 1}. ${item.prompt}`).join("\n");
  return [
    "You are analyzing a single mixed collision-repair case that spans multiple disciplines.",
    `Disciplines involved: ${domains.join(", ")}.`,
    "Answer each question for THIS case. Distinguish what the evidence supports from what still requires verification. Cite the class of authority you would rely on (OEM procedure, position statement, estimating database, jurisdictional source) without inventing citations.",
    "",
    asks,
  ].join("\n");
}
