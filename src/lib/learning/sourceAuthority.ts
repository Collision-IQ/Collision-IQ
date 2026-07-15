import { createHash } from "node:crypto";

/**
 * Collision Learning Engine — source-authority hierarchy and fingerprints.
 *
 * Tier 1 is the highest authority. The learning engine stores REFERENCES to
 * sources (title, locator, version) — never proprietary source text.
 */

export type SourceAuthorityTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type LearningSourceRef = {
  /** e.g. "oem_procedure", "oem_position_statement", "motor", "ccc", "nhtsa", "statute", "doi", "policy", "icar", "scrs", "deg", "estimating_guide", "case_evidence", "web_fallback" */
  sourceType: string;
  title: string;
  /** Drive/Egnyte file id, URL, or citation locator. Never raw source text. */
  locator: string;
  version?: string;
  publicationDate?: string;
  /** MOTOR-scoped refs MUST carry these — see validateMotorSourceRef. */
  motor?: {
    vehicleId: string;
    attributeStandard: string;
    databaseOrApiVersion: string;
  };
};

const SOURCE_TYPE_TIERS: Record<string, SourceAuthorityTier> = {
  oem_procedure: 1,
  oem_position_statement: 2,
  motor: 3,
  ccc: 3,
  nhtsa: 4,
  government: 4,
  statute: 5,
  regulation: 5,
  doi: 5,
  policy: 5,
  icar: 6,
  scrs: 6,
  deg: 6,
  estimating_guide: 6,
  case_evidence: 7,
  web_fallback: 8,
};

export function classifySourceAuthority(sourceType: string): SourceAuthorityTier {
  return SOURCE_TYPE_TIERS[sourceType.trim().toLowerCase()] ?? 8;
}

/** Lower tier number wins. */
export function highestAuthorityTier(refs: LearningSourceRef[]): SourceAuthorityTier {
  if (refs.length === 0) return 8;
  return refs
    .map((ref) => classifySourceAuthority(ref.sourceType))
    .reduce((best, tier) => (tier < best ? tier : best), 8 as SourceAuthorityTier);
}

/**
 * Deterministic fingerprint over the sources' identity + version. When any
 * referenced source changes version/date, the fingerprint changes and linked
 * mastery must be invalidated (see sourceInvalidation).
 */
export function computeSourceFingerprint(refs: LearningSourceRef[]): string {
  const canonical = [...refs]
    .map((ref) => ({
      sourceType: ref.sourceType.trim().toLowerCase(),
      title: ref.title.trim(),
      locator: ref.locator.trim(),
      version: ref.version?.trim() ?? "",
      publicationDate: ref.publicationDate?.trim() ?? "",
      motor: ref.motor
        ? {
            vehicleId: ref.motor.vehicleId.trim(),
            attributeStandard: ref.motor.attributeStandard.trim(),
            databaseOrApiVersion: ref.motor.databaseOrApiVersion.trim(),
          }
        : null,
    }))
    .sort((a, b) => `${a.sourceType}:${a.locator}`.localeCompare(`${b.sourceType}:${b.locator}`));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export type MotorScopeValidation = { valid: boolean; reason?: string };

/**
 * MOTOR data is licensed for a fixed vehicle-scoped sandbox. Every MOTOR
 * source reference must record the Vehicle ID, AttributeStandard, and the
 * database/API version, and must never be represented as comprehensive MOTOR
 * coverage.
 */
export function validateMotorSourceRef(ref: LearningSourceRef): MotorScopeValidation {
  if (ref.sourceType.trim().toLowerCase() !== "motor") return { valid: true };
  if (!ref.motor) {
    return { valid: false, reason: "MOTOR source refs must record vehicleId, attributeStandard, and databaseOrApiVersion." };
  }
  const { vehicleId, attributeStandard, databaseOrApiVersion } = ref.motor;
  if (!vehicleId?.trim() || !attributeStandard?.trim() || !databaseOrApiVersion?.trim()) {
    return { valid: false, reason: "MOTOR source refs must record vehicleId, attributeStandard, and databaseOrApiVersion." };
  }
  return { valid: true };
}

export function validateSourceRefs(refs: LearningSourceRef[]): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const ref of refs) {
    if (!ref.title?.trim() || !ref.locator?.trim() || !ref.sourceType?.trim()) {
      reasons.push(`Source ref missing sourceType/title/locator: ${JSON.stringify(ref).slice(0, 120)}`);
      continue;
    }
    const motorCheck = validateMotorSourceRef(ref);
    if (!motorCheck.valid) reasons.push(motorCheck.reason ?? "Invalid MOTOR source ref.");
  }
  return { valid: reasons.length === 0, reasons };
}
