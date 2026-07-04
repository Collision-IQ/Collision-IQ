// Deterministic vehicle-maintenance projections. Pure functions — no I/O — so
// they are easy to test and safe to run on the server or the client.
//
// The model tracks the user's average daily mileage from their mileage history
// and projects each maintenance item by BOTH a mileage interval and a time
// interval; whichever comes first is the binding constraint. When mileage is
// unavailable it falls back to a pure time countdown from the entered date.

export type ServiceRecord = {
  /** ISO date the service was last performed. */
  date?: string | null;
  /** Odometer reading at the last service, if known. */
  mileage?: number | null;
};

export type MileageReading = { mileage: number; at: string };

export type VehicleProfile = {
  vin?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  /** Most recent odometer reading. */
  mileage?: number | null;
  /** ISO timestamp the most recent mileage was recorded. */
  mileageUpdatedAt?: string | null;
  /** History of odometer readings used to derive average daily mileage. */
  mileageLog?: MileageReading[];
  oilChange?: ServiceRecord;
  tireRotation?: ServiceRecord;
  tireChange?: ServiceRecord;
  updatedAt?: string;
};

export type MaintenanceStatus = "overdue" | "due-soon" | "ok" | "unknown";

export type MaintenanceItem = {
  key: string;
  label: string;
  status: MaintenanceStatus;
  /** Human-readable summary, e.g. "Due in ~1,200 mi (~est. Aug 2026)". */
  detail: string;
  /** Whichever basis is binding for this projection. */
  basis: "mileage" | "time" | "none";
  intervalMiles: number;
  intervalMonths: number;
  milesRemaining?: number;
  daysRemaining?: number;
  /** True when we assumed the last service happened on-schedule (no baseline entered). */
  estimatedBaseline?: boolean;
};

type IntervalDef = {
  key: string;
  label: string;
  miles: number;
  months: number;
  /** Which entered service record (if any) provides the baseline. */
  service?: "oilChange" | "tireRotation" | "tireChange";
};

// Industry-typical intervals. Conservative, non-brand-specific defaults; the UI
// tells users to confirm against their owner's manual.
export const MAINTENANCE_INTERVALS: IntervalDef[] = [
  { key: "oil", label: "Oil & filter change", miles: 5000, months: 6, service: "oilChange" },
  { key: "rotation", label: "Tire rotation", miles: 6000, months: 6, service: "tireRotation" },
  { key: "tires", label: "Tire replacement", miles: 50000, months: 72, service: "tireChange" },
  { key: "brakeInspect", label: "Brake inspection", miles: 20000, months: 24 },
  { key: "engineAir", label: "Engine air filter", miles: 20000, months: 24 },
  { key: "cabinAir", label: "Cabin air filter", miles: 18000, months: 12 },
  { key: "brakeFluid", label: "Brake fluid flush", miles: 30000, months: 36 },
  { key: "coolant", label: "Engine coolant flush", miles: 60000, months: 60 },
  { key: "transmission", label: "Transmission fluid", miles: 60000, months: 60 },
  { key: "sparkPlugs", label: "Spark plugs", miles: 60000, months: 72 },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MILES_PER_DAY = 37; // ~13,500 mi/yr US average, used only for rough date estimates.

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthsToDays(months: number): number {
  return Math.round(months * 30.4375);
}

/** Average daily mileage derived from the earliest and latest readings in the log. */
export function averageMilesPerDay(profile: VehicleProfile): number | null {
  const log = (profile.mileageLog ?? [])
    .filter((r) => typeof r.mileage === "number" && Number.isFinite(r.mileage) && r.at)
    .map((r) => ({ mileage: r.mileage, at: parseDate(r.at) }))
    .filter((r): r is { mileage: number; at: Date } => r.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (log.length < 2) return null;
  const first = log[0];
  const last = log[log.length - 1];
  const days = (last.at.getTime() - first.at.getTime()) / DAY_MS;
  const miles = last.mileage - first.mileage;
  if (days < 1 || miles <= 0) return null;
  return miles / days;
}

/** Project the current odometer reading forward to now using average mileage. */
function projectedMileage(profile: VehicleProfile, avgPerDay: number | null): number | null {
  if (typeof profile.mileage !== "number" || !Number.isFinite(profile.mileage)) return null;
  const updated = parseDate(profile.mileageUpdatedAt);
  if (!updated || avgPerDay === null) return profile.mileage;
  const days = Math.max(0, (Date.now() - updated.getTime()) / DAY_MS);
  return Math.round(profile.mileage + avgPerDay * days);
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function statusFromRemaining(
  milesRemaining: number | undefined,
  daysRemaining: number | undefined,
  intervalMiles: number,
  intervalMonths: number
): MaintenanceStatus {
  const mileOverdue = milesRemaining !== undefined && milesRemaining <= 0;
  const timeOverdue = daysRemaining !== undefined && daysRemaining <= 0;
  if (mileOverdue || timeOverdue) return "overdue";
  // "Due soon" window: 20% of the interval, clamped so it scales across a short
  // 5k-mi oil change and a long 50k-mi tire interval.
  const mileThreshold = Math.min(Math.max(intervalMiles * 0.2, 500), 3000);
  const dayThreshold = Math.min(Math.max(monthsToDays(intervalMonths) * 0.2, 30), 90);
  const mileSoon = milesRemaining !== undefined && milesRemaining <= mileThreshold;
  const timeSoon = daysRemaining !== undefined && daysRemaining <= dayThreshold;
  if (mileSoon || timeSoon) return "due-soon";
  return "ok";
}

function computeItem(
  def: IntervalDef,
  profile: VehicleProfile,
  avgPerDay: number | null,
  projected: number | null
): MaintenanceItem {
  const record: ServiceRecord | undefined = def.service ? profile[def.service] : undefined;
  const baselineDate = parseDate(record?.date ?? null);

  // Mileage baseline: entered value, else assume on-schedule from current mileage.
  let baselineMileage: number | null = null;
  let estimatedBaseline = false;
  if (typeof record?.mileage === "number" && Number.isFinite(record.mileage)) {
    baselineMileage = record.mileage;
  } else if (projected !== null) {
    baselineMileage = Math.floor(projected / def.miles) * def.miles;
    estimatedBaseline = true;
  }

  // Mileage-based projection.
  let milesRemaining: number | undefined;
  let mileageDueDate: Date | null = null;
  if (projected !== null && baselineMileage !== null) {
    const dueMileage = baselineMileage + def.miles;
    milesRemaining = dueMileage - projected;
    const rate = avgPerDay ?? DEFAULT_MILES_PER_DAY;
    if (rate > 0) {
      mileageDueDate = new Date(Date.now() + (milesRemaining / rate) * DAY_MS);
    }
  }

  // Time-based projection (from an entered baseline date only).
  let daysRemaining: number | undefined;
  let timeDueDate: Date | null = null;
  if (baselineDate) {
    timeDueDate = new Date(baselineDate.getTime() + monthsToDays(def.months) * DAY_MS);
    daysRemaining = Math.round((timeDueDate.getTime() - Date.now()) / DAY_MS);
  }

  // Binding basis: whichever due date is sooner; fall back to whichever exists.
  let basis: MaintenanceItem["basis"] = "none";
  if (mileageDueDate && timeDueDate) {
    basis = mileageDueDate <= timeDueDate ? "mileage" : "time";
  } else if (milesRemaining !== undefined) {
    basis = "mileage";
  } else if (daysRemaining !== undefined) {
    basis = "time";
  }

  const status =
    basis === "none"
      ? "unknown"
      : statusFromRemaining(milesRemaining, daysRemaining, def.miles, def.months);

  const detail = buildDetail({
    status,
    basis,
    milesRemaining,
    daysRemaining,
    mileageDueDate,
    timeDueDate,
    estimatedBaseline,
    def,
  });

  return {
    key: def.key,
    label: def.label,
    status,
    detail,
    basis,
    intervalMiles: def.miles,
    intervalMonths: def.months,
    milesRemaining,
    daysRemaining,
    estimatedBaseline: estimatedBaseline || undefined,
  };
}

function buildDetail(args: {
  status: MaintenanceStatus;
  basis: MaintenanceItem["basis"];
  milesRemaining?: number;
  daysRemaining?: number;
  mileageDueDate: Date | null;
  timeDueDate: Date | null;
  estimatedBaseline: boolean;
  def: IntervalDef;
}): string {
  const { status, basis, milesRemaining, daysRemaining, mileageDueDate, timeDueDate, def } = args;
  if (status === "unknown") {
    return `Recommended every ${fmt(def.miles)} mi or ${def.months} months. Enter mileage or a last-service date to track it.`;
  }

  const dueDate = basis === "mileage" ? mileageDueDate : timeDueDate;
  const dateText = dueDate ? ` (~${fmtMonthYear(dueDate)})` : "";

  if (status === "overdue") {
    if (basis === "mileage" && milesRemaining !== undefined) {
      return `Overdue by ~${fmt(Math.abs(milesRemaining))} mi. Service as soon as possible.`;
    }
    if (basis === "time" && daysRemaining !== undefined) {
      return `Overdue by ~${Math.abs(daysRemaining)} days. Service as soon as possible.`;
    }
    return "Overdue. Service as soon as possible.";
  }

  if (basis === "mileage" && milesRemaining !== undefined) {
    return `Due in ~${fmt(milesRemaining)} mi${dateText}.`;
  }
  if (basis === "time" && daysRemaining !== undefined) {
    return `Due in ~${daysRemaining} days${dateText}.`;
  }
  return `Recommended every ${fmt(def.miles)} mi or ${def.months} months.`;
}

export type VehicleMaintenanceSummary = {
  averageMilesPerDay: number | null;
  averageMilesPerYear: number | null;
  projectedMileage: number | null;
  items: MaintenanceItem[];
};

/** Compute the full maintenance picture for a vehicle profile. */
export function computeVehicleMaintenance(profile: VehicleProfile): VehicleMaintenanceSummary {
  const avgPerDay = averageMilesPerDay(profile);
  const projected = projectedMileage(profile, avgPerDay);
  const items = MAINTENANCE_INTERVALS.map((def) => computeItem(def, profile, avgPerDay, projected));

  // Sort most-urgent first (overdue, due-soon, ok, unknown).
  const rank: Record<MaintenanceStatus, number> = { overdue: 0, "due-soon": 1, ok: 2, unknown: 3 };
  items.sort((a, b) => rank[a.status] - rank[b.status]);

  return {
    averageMilesPerDay: avgPerDay,
    averageMilesPerYear: avgPerDay !== null ? Math.round(avgPerDay * 365) : null,
    projectedMileage: projected,
    items,
  };
}
