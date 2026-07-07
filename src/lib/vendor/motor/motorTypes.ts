// MOTOR DaaS types. IMPORTANT: the current MOTOR arrangement is a LIMITED
// SANDBOX (15 vehicles). Vehicle-specific results are sandbox evidence only —
// never presented as full MOTOR coverage. General reference results are never
// blended into vehicle-specific repair instructions.

export type MotorSandboxVehicle = {
  motorVehicleId: number;
  vcdbBaseVehicleId: number;
  year: number;
  make: string;
  model: string;
  vin: string;
};

export type MotorVehicleMatch = {
  vehicleSpecificMotorAvailable: boolean;
  matchedBy: "vin" | "ymm" | null;
  vehicle: MotorSandboxVehicle | null;
};

export type MotorDtcLookupResult = {
  code: string;
  status:
    | "vehicle-specific-sandbox"
    | "general-reference"
    | "unavailable"
    | "not-configured"
    | "error";
  description: string | null;
  metadata: import("@/lib/scans/scanTypes").MotorSourceMetadata | null;
};

export type MotorDtcLookupBatch = {
  attempted: boolean;
  mode: "vehicle-specific-sandbox" | "general-reference" | "none";
  results: Map<string, MotorDtcLookupResult>;
  /** Metadata-only diagnostics (never payloads/credentials). */
  diagnostics: {
    configured: boolean;
    vehicleSpecificAvailable: boolean;
    codesRequested: number;
    codesResolved: number;
    errors: number;
  };
};
