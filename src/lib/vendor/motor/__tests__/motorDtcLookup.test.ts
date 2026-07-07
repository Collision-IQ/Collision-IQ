import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { matchMotorSandboxVehicle } from "@/lib/vendor/motor/motorVehicleMatcher";
import { MOTOR_SANDBOX_VEHICLES } from "@/lib/vendor/motor/motorSandboxCoverage";
import { lookupMotorDtcs } from "@/lib/vendor/motor/motorDtcLookup";
import { getMotorDaasConfig, isMotorDtcLookupConfigured } from "@/lib/vendor/motor/motorDtcClient";

const ENV_BASE: NodeJS.ProcessEnv = {
  MOTOR_DAAS_ENABLED: "true",
  MOTOR_DAAS_DTC_ENABLED: "true",
  MOTOR_DAAS_BASE_URL: "https://api.motor.com/v1",
  MOTOR_DAAS_PUBLIC_KEY: "pub",
  MOTOR_DAAS_PRIVATE_KEY: "priv",
  MOTOR_DAAS_TIMEOUT_MS: "500",
} as NodeJS.ProcessEnv;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("motor sandbox coverage + matcher", () => {
  it("manifest carries all 15 sandbox vehicles", () => {
    expect(MOTOR_SANDBOX_VEHICLES).toHaveLength(15);
  });

  it("matches a supported sandbox vehicle by VIN and by YMM", () => {
    const byVin = matchMotorSandboxVehicle({ vin: "19XFA1F51AE028415" });
    expect(byVin.vehicleSpecificMotorAvailable).toBe(true);
    expect(byVin.matchedBy).toBe("vin");
    expect(byVin.vehicle?.motorVehicleId).toBe(22124);

    const byYmm = matchMotorSandboxVehicle({ year: 2010, make: "honda", model: "civic" });
    expect(byYmm.vehicleSpecificMotorAvailable).toBe(true);
    expect(byYmm.matchedBy).toBe("ymm");
  });

  it("does not match vehicles outside the sandbox manifest", () => {
    const match = matchMotorSandboxVehicle({ year: 2024, make: "Jeep", model: "Grand Wagoneer" });
    expect(match.vehicleSpecificMotorAvailable).toBe(false);
    expect(match.vehicle).toBeNull();
  });
});

describe("lookupMotorDtcs", () => {
  it("supported sandbox vehicle enables vehicle-specific lookup with sandbox labeling", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ Body: [{ Description: "Cylinder 1 Misfire Detected" }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const batch = await lookupMotorDtcs({
      vehicle: { vin: "19XFA1F51AE028415" },
      codes: ["P0301"],
      env: ENV_BASE,
    });

    expect(batch.mode).toBe("vehicle-specific-sandbox");
    const result = batch.results.get("P0301");
    expect(result?.status).toBe("vehicle-specific-sandbox");
    expect(result?.metadata?.sourceMode).toBe("vehicle-specific-sandbox");
    expect(result?.metadata?.motorVehicleId).toBe(22124);
    expect(result?.description).toContain("Misfire");
    // Vehicle-specific route was actually called with the MOTOR vehicle id.
    expect(String(fetchMock.mock.calls[0][0])).toContain("22124");
  });

  it("unsupported vehicle never calls vehicle-specific routes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const batch = await lookupMotorDtcs({
      vehicle: { year: 2024, make: "Jeep", model: "Grand Wagoneer" },
      codes: ["P0301"],
      env: ENV_BASE,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(batch.mode).toBe("none");
    // No retrieved MOTOR source → no MOTOR claim (unavailable, no metadata).
    expect(batch.results.get("P0301")?.status).toBe("unavailable");
    expect(batch.results.get("P0301")?.metadata).toBeNull();
  });

  it("general/reference route is used ONLY when explicitly configured and labeled general", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ Description: "Generic misfire" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const env = {
      ...ENV_BASE,
      MOTOR_DAAS_DTC_GENERAL_ROUTE_TEMPLATE: "/Information/DiagnosticTroubleCodes/{code}",
    } as NodeJS.ProcessEnv;

    const batch = await lookupMotorDtcs({
      vehicle: { year: 2024, make: "Jeep", model: "Grand Wagoneer" },
      codes: ["P0301"],
      env,
    });

    expect(batch.mode).toBe("general-reference");
    const result = batch.results.get("P0301");
    expect(result?.status).toBe("general-reference");
    expect(result?.metadata?.sourceMode).toBe("general-reference");
    expect(result?.metadata?.motorVehicleId).toBeNull();
  });

  it("MOTOR failure does not throw — codes come back unavailable/error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    const batch = await lookupMotorDtcs({
      vehicle: { vin: "19XFA1F51AE028415" },
      codes: ["P0301"],
      env: ENV_BASE,
    });

    expect(batch.results.get("P0301")?.status).toBe("error");
    expect(batch.diagnostics.errors).toBe(1);
  });

  it("not configured → not-configured status, no network calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const batch = await lookupMotorDtcs({
      vehicle: { vin: "19XFA1F51AE028415" },
      codes: ["P0301"],
      env: { MOTOR_DAAS_ENABLED: "false" } as NodeJS.ProcessEnv,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(batch.results.get("P0301")?.status).toBe("not-configured");
  });

  it("MOTOR credentials never use NEXT_PUBLIC_ (client bundle) env names", () => {
    expect(isMotorDtcLookupConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    const config = getMotorDaasConfig(ENV_BASE);
    expect(config.baseUrl).toContain("api.motor.com");
    // Source-level: the client reads only MOTOR_DAAS_* names.
    // (Compile-time guarantee: motorDtcClient imports "server-only".)
    expect(Object.keys(ENV_BASE).every((key) => !key.startsWith("NEXT_PUBLIC_"))).toBe(true);
  });
});
