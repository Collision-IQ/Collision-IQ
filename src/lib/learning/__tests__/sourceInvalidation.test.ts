import { describe, expect, it } from "vitest";
import {
  classifySourceAuthority,
  computeSourceFingerprint,
  highestAuthorityTier,
  validateMotorSourceRef,
  validateSourceRefs,
  type LearningSourceRef,
} from "../sourceAuthority";
import { shouldInvalidate } from "../invalidationRules";

const oemRef: LearningSourceRef = {
  sourceType: "oem_procedure",
  title: "Quarter panel replacement",
  locator: "drive:abc123",
  version: "2026-03",
};

describe("source fingerprints", () => {
  it("is stable across ref ordering", () => {
    const other: LearningSourceRef = { sourceType: "icar", title: "Sectioning basics", locator: "icar:001" };
    expect(computeSourceFingerprint([oemRef, other])).toBe(computeSourceFingerprint([other, oemRef]));
  });

  it("changes when a source version changes", () => {
    const before = computeSourceFingerprint([oemRef]);
    const after = computeSourceFingerprint([{ ...oemRef, version: "2026-07" }]);
    expect(after).not.toBe(before);
  });

  it("invalidates only items linked to the changed fingerprint", () => {
    const fingerprint = computeSourceFingerprint([oemRef]);
    expect(shouldInvalidate({ sourceFingerprint: fingerprint }, fingerprint)).toBe(true);
    expect(shouldInvalidate({ sourceFingerprint: "different" }, fingerprint)).toBe(false);
  });
});

describe("source authority", () => {
  it("ranks OEM procedures above position statements above databases above web fallback", () => {
    expect(classifySourceAuthority("oem_procedure")).toBeLessThan(classifySourceAuthority("oem_position_statement"));
    expect(classifySourceAuthority("oem_position_statement")).toBeLessThan(classifySourceAuthority("motor"));
    expect(classifySourceAuthority("motor")).toBeLessThan(classifySourceAuthority("icar"));
    expect(classifySourceAuthority("icar")).toBeLessThan(classifySourceAuthority("web_fallback"));
    expect(classifySourceAuthority("unheard-of")).toBe(8);
  });

  it("selects the highest (lowest-number) tier from a ref set", () => {
    expect(
      highestAuthorityTier([
        { sourceType: "web_fallback", title: "blog", locator: "https://example.test" },
        oemRef,
      ])
    ).toBe(1);
  });
});

describe("MOTOR vehicle-scoped sandbox handling", () => {
  it("rejects MOTOR refs that do not record vehicleId/attributeStandard/version", () => {
    const bare: LearningSourceRef = { sourceType: "motor", title: "DTC data", locator: "motor:dtc" };
    expect(validateMotorSourceRef(bare).valid).toBe(false);
    expect(validateSourceRefs([bare]).valid).toBe(false);
  });

  it("accepts fully scoped MOTOR refs", () => {
    const scoped: LearningSourceRef = {
      sourceType: "motor",
      title: "DTC data",
      locator: "motor:dtc",
      motor: { vehicleId: "veh-15", attributeStandard: "VCdb-2026", databaseOrApiVersion: "daas-v2" },
    };
    expect(validateMotorSourceRef(scoped).valid).toBe(true);
    expect(validateSourceRefs([scoped]).valid).toBe(true);
  });

  it("does not apply MOTOR scope requirements to non-MOTOR refs", () => {
    expect(validateMotorSourceRef(oemRef).valid).toBe(true);
  });
});
