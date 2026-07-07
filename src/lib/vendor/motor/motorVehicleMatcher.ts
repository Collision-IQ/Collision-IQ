// Match a scanned/estimated vehicle against the limited MOTOR sandbox
// manifest. Only a match here permits vehicle-specific MOTOR routes.

import { MOTOR_SANDBOX_VEHICLES } from "@/lib/vendor/motor/motorSandboxCoverage";
import type { MotorVehicleMatch } from "@/lib/vendor/motor/motorTypes";

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, " ");
}

export function matchMotorSandboxVehicle(params: {
  vin?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
}): MotorVehicleMatch {
  const vin = (params.vin ?? "").trim().toUpperCase();
  if (vin) {
    const byVin = MOTOR_SANDBOX_VEHICLES.find((vehicle) => vehicle.vin === vin);
    if (byVin) {
      return { vehicleSpecificMotorAvailable: true, matchedBy: "vin", vehicle: byVin };
    }
  }

  const make = normalizeToken(params.make);
  const model = normalizeToken(params.model);
  if (params.year && make && model) {
    const byYmm = MOTOR_SANDBOX_VEHICLES.find(
      (vehicle) =>
        vehicle.year === params.year &&
        normalizeToken(vehicle.make) === make &&
        // Model matches when equal or one contains the other ("F-250" vs
        // "F-250 Super Duty"), so scan-report truncation still matches.
        (normalizeToken(vehicle.model) === model ||
          normalizeToken(vehicle.model).includes(model) ||
          model.includes(normalizeToken(vehicle.model)))
    );
    if (byYmm) {
      return { vehicleSpecificMotorAvailable: true, matchedBy: "ymm", vehicle: byYmm };
    }
  }

  return { vehicleSpecificMotorAvailable: false, matchedBy: null, vehicle: null };
}
