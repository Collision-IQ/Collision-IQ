// MOTOR DaaS DTC lookup for Scan IQ. Coverage rules:
// 1. Vehicle-specific routes run ONLY when the vehicle matches the 15-vehicle
//    sandbox manifest — results are labeled "MOTOR Vehicle-Specific Sandbox
//    Evidence", never full-coverage claims.
// 2. The general/reference route runs ONLY when its route template env is set
//    (i.e. verified to work without a vehicle id) — results are labeled
//    "MOTOR General Reference Evidence" and never blended into
//    vehicle-specific repair instructions.
// 3. No retrieved source → no MOTOR claim (status unavailable/error).
// 4. Any MOTOR failure is non-fatal — the scan report proceeds without it.

import "server-only";
import {
  getMotorDaasConfig,
  isMotorDtcLookupConfigured,
  motorDaasGet,
} from "@/lib/vendor/motor/motorDtcClient";
import { matchMotorSandboxVehicle } from "@/lib/vendor/motor/motorVehicleMatcher";
import type { MotorDtcLookupBatch, MotorDtcLookupResult } from "@/lib/vendor/motor/motorTypes";
import type { MotorSourceMetadata } from "@/lib/scans/scanTypes";

function extractDescription(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  // DaaS responses commonly nest under Body/Result arrays; probe pragmatically.
  for (const key of ["Description", "description", "Name", "name", "Title", "title"]) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  const nested = record.Body ?? record.body ?? record.Result ?? record.result ?? record.Data ?? record.data;
  if (Array.isArray(nested) && nested.length > 0) return extractDescription(nested[0]);
  if (nested && typeof nested === "object") return extractDescription(nested);
  return null;
}

export async function lookupMotorDtcs(params: {
  vehicle: { vin?: string | null; year?: number | null; make?: string | null; model?: string | null };
  codes: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<MotorDtcLookupBatch> {
  const env = params.env ?? process.env;
  const config = getMotorDaasConfig(env);
  const configured = isMotorDtcLookupConfigured(env);
  const match = matchMotorSandboxVehicle(params.vehicle);
  const codes = [...new Set(params.codes.map((code) => code.toUpperCase()))].slice(0, 25);

  const results = new Map<string, MotorDtcLookupResult>();
  const batch: MotorDtcLookupBatch = {
    attempted: false,
    mode: "none",
    results,
    diagnostics: {
      configured,
      vehicleSpecificAvailable: match.vehicleSpecificMotorAvailable,
      codesRequested: codes.length,
      codesResolved: 0,
      errors: 0,
    },
  };

  if (!configured || codes.length === 0) {
    for (const code of codes) {
      results.set(code, { code, status: "not-configured", description: null, metadata: null });
    }
    return batch;
  }

  const useVehicleSpecific = match.vehicleSpecificMotorAvailable && match.vehicle;
  const useGeneral = !useVehicleSpecific && Boolean(config.dtcGeneralRouteTemplate);

  if (!useVehicleSpecific && !useGeneral) {
    // Unsupported vehicle and no verified general route: never call
    // vehicle-specific MOTOR routes for out-of-sandbox vehicles.
    for (const code of codes) {
      results.set(code, { code, status: "unavailable", description: null, metadata: null });
    }
    return batch;
  }

  batch.attempted = true;
  batch.mode = useVehicleSpecific ? "vehicle-specific-sandbox" : "general-reference";

  for (const code of codes) {
    const route = useVehicleSpecific
      ? config.dtcVehicleRouteTemplate
          .replace("{motorVehicleId}", String(match.vehicle!.motorVehicleId))
          .replace("{vcdbBaseVehicleId}", String(match.vehicle!.vcdbBaseVehicleId))
          .replace("{code}", encodeURIComponent(code))
      : config.dtcGeneralRouteTemplate!.replace("{code}", encodeURIComponent(code));

    const response = await motorDaasGet(route, env);
    if (!response.ok || response.body === null) {
      batch.diagnostics.errors += 1;
      results.set(code, {
        code,
        status: response.status === null ? "error" : "unavailable",
        description: null,
        metadata: null,
      });
      continue;
    }

    const metadata: MotorSourceMetadata = {
      sourceVendor: "MOTOR",
      sourceSystem: "DaaS Sandbox",
      sourceMode: useVehicleSpecific ? "vehicle-specific-sandbox" : "general-reference",
      apiVersion: "v1",
      databaseVersion: null,
      motorVehicleId: useVehicleSpecific ? match.vehicle!.motorVehicleId : null,
      vcdbBaseVehicleId: useVehicleSpecific ? match.vehicle!.vcdbBaseVehicleId : null,
      route,
      retrievedAt: new Date().toISOString(),
      sourceReferenceId: null,
      confidence: useVehicleSpecific ? "medium" : "low",
    };

    batch.diagnostics.codesResolved += 1;
    results.set(code, {
      code,
      status: useVehicleSpecific ? "vehicle-specific-sandbox" : "general-reference",
      description: extractDescription(response.body),
      metadata,
    });
  }

  return batch;
}
