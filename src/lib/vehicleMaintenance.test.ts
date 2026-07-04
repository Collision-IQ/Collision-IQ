import { describe, expect, it } from "vitest";
import { computeVehicleMaintenance, averageMilesPerDay } from "@/lib/vehicleMaintenance";

const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const dateOnly = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);

function item(profile: Parameters<typeof computeVehicleMaintenance>[0], key: string) {
  return computeVehicleMaintenance(profile).items.find((i) => i.key === key)!;
}

describe("computeVehicleMaintenance", () => {
  it("returns unknown items when nothing is entered", () => {
    const summary = computeVehicleMaintenance({});
    expect(summary.averageMilesPerDay).toBeNull();
    expect(summary.items.every((i) => i.status === "unknown")).toBe(true);
  });

  it("projects oil change by mileage interval (5,000 mi)", () => {
    // Oil done at 40k, now at 42k, updated today → 3k remaining → ok.
    const ok = item({ mileage: 42000, mileageUpdatedAt: iso(0), oilChange: { mileage: 40000, date: null } }, "oil");
    expect(ok.status).toBe("ok");
    expect(ok.milesRemaining).toBe(3000);

    // Oil done at 38k, now at 42k → due at 43k → 1k remaining → due-soon.
    const soon = item({ mileage: 42000, mileageUpdatedAt: iso(0), oilChange: { mileage: 38000, date: null } }, "oil");
    expect(soon.status).toBe("due-soon");

    // Oil done at 36k, now at 42k → due at 41k → overdue.
    const overdue = item({ mileage: 42000, mileageUpdatedAt: iso(0), oilChange: { mileage: 36000, date: null } }, "oil");
    expect(overdue.status).toBe("overdue");
  });

  it("falls back to a time countdown when mileage is unavailable", () => {
    // No mileage; oil changed 8 months ago → past the 6-month interval → overdue.
    const overdue = item({ oilChange: { date: dateOnly(240 * DAY), mileage: null } }, "oil");
    expect(overdue.basis).toBe("time");
    expect(overdue.status).toBe("overdue");

    // Oil changed 1 month ago → plenty of time left → ok.
    const ok = item({ oilChange: { date: dateOnly(30 * DAY), mileage: null } }, "oil");
    expect(ok.status).toBe("ok");
  });

  it("derives average daily mileage from the mileage log", () => {
    const profile = {
      mileage: 43000,
      mileageUpdatedAt: iso(0),
      mileageLog: [
        { mileage: 40000, at: iso(100 * DAY) },
        { mileage: 43000, at: iso(0) },
      ],
    };
    const avg = averageMilesPerDay(profile);
    expect(avg).not.toBeNull();
    expect(Math.round(avg!)).toBe(30); // 3000 mi / 100 days
    expect(computeVehicleMaintenance(profile).averageMilesPerYear).toBe(Math.round(30 * 365));
  });
});
