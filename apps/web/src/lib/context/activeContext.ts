export type VehicleContext = {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  vin?: string | null;
  confidence: number;
  source: "explicit" | "inferred" | "none";
  updatedAt: string;
};

export type RepairContext = {
  system?: string | null;
  component?: string | null;
  procedure?: string | null;
  confidence: number;
  source: "explicit" | "inferred" | "none";
  updatedAt: string;
};

export type ActiveContext = {
  vehicle: VehicleContext;
  repair: RepairContext;
};

const MAKES = [
  "Tesla",
  "BMW",
  "Honda",
  "Toyota",
  "Ford",
  "GM",
  "Chevrolet",
  "Nissan",
  "Hyundai",
  "Kia",
  "Subaru",
  "Mazda",
  "Mercedes",
  "Audi",
  "Volkswagen",
  "Lexus",
  "Jeep",
  "Dodge",
  "Ram",
  "GMC",
  "Cadillac",
  "Acura",
  "Infiniti",
  "Lincoln",
  "Volvo",
  "Porsche",
  "Jaguar",
  "Land Rover",
  "Mini",
];

const SYSTEM_KEYWORDS = [
  "ADAS",
  "SRS",
  "airbag",
  "radar",
  "camera",
  "blind spot",
  "lane keep",
  "parking sensor",
  "brake",
  "steering",
];

const COMPONENT_KEYWORDS = [
  "bumper",
  "grille",
  "radar",
  "camera",
  "windshield",
  "sensor",
  "module",
  "seat",
  "battery",
  "mirror",
];

const PROCEDURE_KEYWORDS = [
  "calibration",
  "diagnostic scan",
  "pre-scan",
  "post-scan",
  "verification",
  "initialization",
  "programming",
  "reset",
  "inspection",
  "replacement",
  "installation",
  "removal",
];

function matchKeyword(text: string, values: string[]): string | null {
  const lower = text.toLowerCase();
  return values.find((v) => lower.includes(v.toLowerCase())) ?? null;
}

export function extractContextFromText(text: string): Partial<ActiveContext> {
  const now = new Date().toISOString();
  const lower = text.toLowerCase();

  const make = MAKES.find((m) => lower.includes(m.toLowerCase())) ?? null;
  const yearMatch = text.match(/\b(19[8-9]\d|20[0-3]\d)\b/);
  const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);

  const year = yearMatch ? Number(yearMatch[1]) : null;
  const vin = vinMatch ? vinMatch[1].toUpperCase() : null;

  let vehicleConfidence = 0;
  let vehicleSource: VehicleContext["source"] = "none";

  if (vin || (make && year)) {
    vehicleConfidence = 0.9;
    vehicleSource = "explicit";
  } else if (make) {
    vehicleConfidence = 0.6;
    vehicleSource = "inferred";
  }

  const system = matchKeyword(text, SYSTEM_KEYWORDS);
  const component = matchKeyword(text, COMPONENT_KEYWORDS);
  const procedure = matchKeyword(text, PROCEDURE_KEYWORDS);

  let repairConfidence = 0;
  let repairSource: RepairContext["source"] = "none";

  if (system || component || procedure) {
    repairConfidence = 0.55;
    repairSource = "inferred";
  }

  return {
    vehicle: {
      year,
      make,
      model: null,
      vin,
      confidence: vehicleConfidence,
      source: vehicleSource,
      updatedAt: now,
    },
    repair: {
      system,
      component,
      procedure,
      confidence: repairConfidence,
      source: repairSource,
      updatedAt: now,
    },
  };
}

export function mergeActiveContext(
  prev: ActiveContext | null,
  next: Partial<ActiveContext>
): ActiveContext {
  const now = new Date().toISOString();

  const base: ActiveContext =
    prev ?? {
      vehicle: {
        year: null,
        make: null,
        model: null,
        vin: null,
        confidence: 0,
        source: "none",
        updatedAt: now,
      },
      repair: {
        system: null,
        component: null,
        procedure: null,
        confidence: 0,
        source: "none",
        updatedAt: now,
      },
    };

  const vehicle =
    next.vehicle &&
    (next.vehicle.source === "explicit" ||
      (next.vehicle.confidence ?? 0) >= base.vehicle.confidence)
      ? { ...base.vehicle, ...next.vehicle }
      : base.vehicle;

  const repair =
    next.repair &&
    ((next.repair.confidence ?? 0) > 0 || next.repair.source === "explicit")
      ? { ...base.repair, ...next.repair }
      : base.repair;

  return { vehicle, repair };
}