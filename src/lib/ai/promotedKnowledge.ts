import "server-only";
import { prisma } from "@/lib/prisma";
import {
  buildPromotedKnowledgeDirective,
  selectPromotedEntries,
  type PromotedKnowledgeContext,
  type PromotedKnowledgeEntry,
  type PromotedKnowledgeSource,
} from "./promotedKnowledgeDirective";

/**
 * Promoted collision knowledge — database application layer.
 *
 * Closes the read side of the Collision Learning Engine loop: knowledge that
 * cleared the promotion gates and a Platform Admin's approval becomes a system
 * directive on the live chat turn. The direction is one-way by design — chat
 * reads the learning tables, and no learning module ever writes a prompt.
 *
 * The gold answer's key points ARE the verified knowledge, so they are what
 * gets rendered. The item's `prompt` field is deliberately never selected: it
 * is a recall quiz question, not knowledge, and has no place in a user-facing
 * system prompt.
 */

/** Promotion is a human action, so the set changes rarely; cache per instance. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ROWS = 200;

type CacheEntry = { entries: PromotedKnowledgeEntry[]; expiresAt: number };
let cache: CacheEntry | null = null;

/** Test seam — clears the in-process cache. */
export function resetPromotedKnowledgeCache(): void {
  cache = null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readKeyPoints(goldAnswer: unknown): string[] {
  if (!goldAnswer || typeof goldAnswer !== "object") return [];
  const rawPoints = (goldAnswer as { keyPoints?: unknown }).keyPoints;
  if (!Array.isArray(rawPoints)) return [];

  const points = rawPoints.flatMap((point) => {
    if (!point || typeof point !== "object") return [];
    const text = (point as { text?: unknown }).text;
    if (typeof text !== "string" || !text.trim()) return [];
    const required = (point as { required?: unknown }).required === true;
    const safetyCritical = (point as { safetyCritical?: unknown }).safetyCritical === true;
    return [{ text: text.trim(), required, safetyCritical }];
  });

  // Required and safety-critical points survive truncation first.
  return points
    .sort((left, right) => {
      const leftRank = (left.safetyCritical ? 2 : 0) + (left.required ? 1 : 0);
      const rightRank = (right.safetyCritical ? 2 : 0) + (right.required ? 1 : 0);
      return rightRank - leftRank;
    })
    .map((point) => point.text);
}

function readSources(sourceRefs: unknown): PromotedKnowledgeSource[] {
  if (!Array.isArray(sourceRefs)) return [];
  return sourceRefs.flatMap((ref) => {
    if (!ref || typeof ref !== "object") return [];
    const sourceType = (ref as { sourceType?: unknown }).sourceType;
    const title = (ref as { title?: unknown }).title;
    if (typeof sourceType !== "string" || typeof title !== "string") return [];
    const version = (ref as { version?: unknown }).version;
    // `locator` is intentionally dropped: raw Drive ids and URLs must never
    // reach the model, which is told elsewhere not to surface document links.
    return [{ sourceType, title, version: typeof version === "string" ? version : undefined }];
  });
}

function readVehicleScopeLabel(vehicleScope: unknown): string | null {
  if (!vehicleScope) return null;
  if (typeof vehicleScope === "string") return vehicleScope.trim() || null;
  try {
    const rendered = JSON.stringify(vehicleScope);
    return rendered && rendered !== "{}" && rendered !== "[]" ? rendered.slice(0, 200) : null;
  } catch {
    return null;
  }
}

async function loadPromotedEntries(): Promise<PromotedKnowledgeEntry[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.entries;

  const rows = await prisma.collisionLearningItem.findMany({
    where: {
      // Only human-approved knowledge ships. VERIFIED is not enough.
      status: "PROMOTED",
      // Holdout items are benchmark-only; injecting them would teach to the test.
      holdout: false,
    },
    orderBy: [{ safetyCritical: "desc" }, { updatedAt: "desc" }],
    take: MAX_ROWS,
    select: {
      slug: true,
      domain: true,
      objective: true,
      goldAnswer: true,
      sourceRefs: true,
      oem: true,
      jurisdiction: true,
      vehicleScope: true,
      safetyCritical: true,
    },
  });

  const entries = rows.map((row) => ({
    slug: row.slug,
    domain: row.domain,
    objective: row.objective,
    keyPoints: readKeyPoints(row.goldAnswer),
    forbiddenAssertions: toStringArray(
      (row.goldAnswer as { forbiddenAssertions?: unknown } | null)?.forbiddenAssertions
    ),
    authorityMentions: toStringArray(
      (row.goldAnswer as { expectedAuthorityMentions?: unknown } | null)?.expectedAuthorityMentions
    ),
    sources: readSources(row.sourceRefs),
    oem: row.oem,
    jurisdiction: row.jurisdiction,
    vehicleScopeLabel: readVehicleScopeLabel(row.vehicleScope),
    safetyCritical: row.safetyCritical,
  }));

  cache = { entries, expiresAt: now + CACHE_TTL_MS };
  return entries;
}

/**
 * Returns the promoted-knowledge system directive for this turn, or "" when
 * nothing applies.
 *
 * Never throws: promoted knowledge is an enhancement, so a learning-table
 * outage degrades the answer rather than failing the chat turn.
 */
export async function buildPromotedKnowledgeSystemDirective(
  context: PromotedKnowledgeContext
): Promise<string> {
  try {
    const entries = await loadPromotedEntries();
    if (entries.length === 0) return "";

    const selection = selectPromotedEntries(entries, context);
    if (selection.selected.length === 0) return "";

    console.info("[promoted-knowledge] injected", {
      included: selection.selected.length,
      omittedForScope: selection.omittedForScope,
      omittedForBudget: selection.omittedForBudget,
    });

    return buildPromotedKnowledgeDirective(selection.selected);
  } catch (error) {
    console.error("[promoted-knowledge] load failed; continuing without it", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return "";
  }
}
