import type { PolicyLegalRegulationsDebugPayload } from "./debugPayload";
import { buildPolicyLegalRegulationsDebugPayload } from "./debugPayload";
import type { PrismaRegulationRecord } from "./regulations";
import {
  observePolicyLegalRegulationAccess,
  observePolicyLegalRegulationDbFallback,
} from "./observability";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

type AuthorizedUser = {
  isPlatformAdmin?: boolean;
  isInternalUser?: boolean;
} | null;

type CacheEntry = {
  expiresAt: number;
  payload: PolicyLegalRegulationsDebugPayload;
};

const cache = new Map<string, CacheEntry>();

export type PolicyLegalRegulationsEndpointResult = {
  status: number;
  body: PolicyLegalRegulationsDebugPayload | { error: string };
  cacheStatus?: "hit" | "miss" | "bypass";
};

export function validateRegulationStateParam(state: string | null | undefined) {
  const normalized = state?.trim().toUpperCase() || "";
  if (!/^[A-Z]{2}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

export function clearPolicyLegalRegulationsCacheForTests() {
  cache.clear();
}

export function corruptPolicyLegalRegulationsCacheForTests(
  state: string,
  entry: unknown
) {
  cache.set(state.trim().toUpperCase(), entry as CacheEntry);
}

export async function buildPolicyLegalRegulationsEndpointResult(params: {
  state: string | null | undefined;
  currentUser: AuthorizedUser;
  findRegulations: (state: string) => Promise<PrismaRegulationRecord[]>;
  logAccess?: (entry: {
    state: string | null;
    status: number;
    totalCount: number;
    verifiedCount: number;
    placeholderCount: number;
    cacheStatus: "hit" | "miss" | "bypass" | null;
  }) => Promise<void> | void;
  now?: number;
  cacheTtlMs?: number;
  bypassCache?: boolean;
}): Promise<PolicyLegalRegulationsEndpointResult> {
  if (!params.currentUser) {
    const accessEvent = {
      state: validateRegulationStateParam(params.state),
      status: 401,
      totalCount: 0,
      verifiedCount: 0,
      placeholderCount: 0,
      cacheStatus: null,
    };
    observePolicyLegalRegulationAccess(accessEvent);
    await params.logAccess?.(accessEvent);
    return {
      status: 401,
      body: { error: "Authentication is required." },
    };
  }

  if (!params.currentUser.isPlatformAdmin && !params.currentUser.isInternalUser) {
    const accessEvent = {
      state: validateRegulationStateParam(params.state),
      status: 403,
      totalCount: 0,
      verifiedCount: 0,
      placeholderCount: 0,
      cacheStatus: null,
    };
    observePolicyLegalRegulationAccess(accessEvent);
    await params.logAccess?.(accessEvent);
    return {
      status: 403,
      body: { error: "Admin or internal access is required." },
    };
  }

  const state = validateRegulationStateParam(params.state);
  if (!state) {
    const accessEvent = {
      state: null,
      status: 400,
      totalCount: 0,
      verifiedCount: 0,
      placeholderCount: 0,
      cacheStatus: null,
    };
    observePolicyLegalRegulationAccess(accessEvent);
    await params.logAccess?.(accessEvent);
    return {
      status: 400,
      body: { error: "state must be a 2-letter state abbreviation." },
    };
  }

  const now = params.now ?? Date.now();
  const ttl = params.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cached = cache.get(state);
  if (!params.bypassCache && cached && cached.expiresAt > now) {
    if (!isValidRegulationsPayload(cached.payload)) {
      cache.delete(state);
    } else {
    const accessEvent = {
      state,
      status: 200,
      totalCount: cached.payload.total,
      verifiedCount: cached.payload.counts.verified,
      placeholderCount: cached.payload.counts.placeholder,
      cacheStatus: "hit",
    } as const;
    observePolicyLegalRegulationAccess(accessEvent);
    await params.logAccess?.(accessEvent);
    return {
      status: 200,
      body: cached.payload,
      cacheStatus: "hit",
    };
    }
  }

  let dbRecords: PrismaRegulationRecord[] = [];
  try {
    dbRecords = await params.findRegulations(state);
  } catch (error) {
    observePolicyLegalRegulationDbFallback({
      state,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }

  const payload = buildPolicyLegalRegulationsDebugPayload({
    state,
    dbRecords,
  });

  if (!params.bypassCache) {
    cache.set(state, {
      expiresAt: now + ttl,
      payload,
    });
  }

  const cacheStatus = params.bypassCache ? "bypass" : "miss";
  const accessEvent = {
    state,
    status: 200,
    totalCount: payload.total,
    verifiedCount: payload.counts.verified,
    placeholderCount: payload.counts.placeholder,
    cacheStatus,
  } as const;
  observePolicyLegalRegulationAccess(accessEvent);
  await params.logAccess?.(accessEvent);

  return {
    status: 200,
    body: payload,
    cacheStatus,
  };
}

function isValidRegulationsPayload(
  payload: unknown
): payload is PolicyLegalRegulationsDebugPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const candidate = payload as Partial<PolicyLegalRegulationsDebugPayload>;
  return (
    typeof candidate.state === "string" &&
    typeof candidate.total === "number" &&
    Array.isArray(candidate.records) &&
    Boolean(candidate.counts) &&
    typeof candidate.counts?.verified === "number" &&
    typeof candidate.counts?.placeholder === "number"
  );
}
