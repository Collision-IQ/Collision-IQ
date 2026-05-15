import {
  mergeVehicleIdentity,
  normalizeVehicleIdentity,
} from "../vehicleContext";

export type VehicleSessionContext = {
  vehicleMake?: string | null;
  system?: string | null;
  component?: string | null;
  procedure?: string | null;
} | null | undefined;

export function resolveComparisonVehicleIdentity(
  sessionVehicle: ReturnType<typeof normalizeVehicleIdentity> | null | undefined,
  shopVehicle: ReturnType<typeof normalizeVehicleIdentity> | null | undefined,
  insurerVehicle: ReturnType<typeof normalizeVehicleIdentity> | null | undefined,
  analysisVehicle: ReturnType<typeof normalizeVehicleIdentity> | null | undefined
) {
  // Compare-mode should only add evidence, never erase stronger vehicle identity already recovered.
  return mergeVehicleIdentity(sessionVehicle, shopVehicle, insurerVehicle, analysisVehicle);
}

export function buildActiveContext(
  sessionContext: VehicleSessionContext,
  inferredVehicle: ReturnType<typeof normalizeVehicleIdentity> | undefined
) {
  if (!sessionContext && !inferredVehicle) {
    return null;
  }

  const now = new Date().toISOString();
  const normalizedVehicle = normalizeVehicleIdentity(inferredVehicle);
  const hasRepairContext = Boolean(
    sessionContext?.system || sessionContext?.component || sessionContext?.procedure
  );
  const hasVehicleContext = Boolean(
    normalizedVehicle?.vin ||
      normalizedVehicle?.year ||
      normalizedVehicle?.make ||
      normalizedVehicle?.model ||
      sessionContext?.vehicleMake
  );

  if (!hasVehicleContext && !hasRepairContext) {
    return null;
  }

  const vehicleSource: "explicit" | "inferred" | "none" =
    normalizedVehicle?.source && normalizedVehicle.source !== "unknown"
      ? "explicit"
      : sessionContext?.vehicleMake
        ? "inferred"
        : "none";
  const repairSource: "explicit" | "inferred" | "none" = hasRepairContext ? "inferred" : "none";

  return {
    vehicle: {
      year: normalizedVehicle?.year ?? null,
      make: normalizedVehicle?.make ?? sessionContext?.vehicleMake ?? null,
      model: normalizedVehicle?.model ?? null,
      vin: normalizedVehicle?.vin ?? null,
      confidence: normalizedVehicle?.confidence ?? (sessionContext?.vehicleMake ? 0.6 : 0),
      source: vehicleSource,
      updatedAt: now,
    },
    repair: {
      system: sessionContext?.system ?? null,
      component: sessionContext?.component ?? null,
      procedure: sessionContext?.procedure ?? null,
      confidence: hasRepairContext ? 0.5 : 0,
      source: repairSource,
      updatedAt: now,
    },
  };
}
