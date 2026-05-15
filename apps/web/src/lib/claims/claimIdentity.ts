export function toStableClaimId(activeCaseId: string | null | undefined): string | null {
  const normalized = normalizeClaimId(activeCaseId);
  return normalized ? `claim_${normalized}` : null;
}

export function normalizeClaimId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("claim_") ? trimmed.slice("claim_".length) : trimmed;
}
