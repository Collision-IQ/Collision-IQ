import { describe, expect, it } from "vitest";
import type { StoredAnalysisReport } from "@/lib/analysisReportStore";
import { isSameVehicle, lastAnalyzedVehicleFromReport } from "@/lib/lastAnalyzedVehicle";

const stored = (vehicle: Record<string, unknown> | undefined): Pick<StoredAnalysisReport, "id" | "createdAt" | "report"> => ({
  id: "rep_1",
  createdAt: "2026-09-22T15:00:00.000Z",
  report: { vehicle } as unknown as StoredAnalysisReport["report"],
});

describe("lastAnalyzedVehicleFromReport", () => {
  it("lifts the analysed vehicle out of the latest report", () => {
    expect(
      lastAnalyzedVehicleFromReport(stored({ year: 2018, make: " Ford ", model: "F-150", trim: "XLT", vin: "1ftfw1rg4jfb99180" }))
    ).toEqual({
      reportId: "rep_1",
      analyzedAt: "2026-09-22T15:00:00.000Z",
      year: 2018,
      make: "Ford",
      model: "F-150",
      trim: "XLT",
      vin: "1FTFW1RG4JFB99180",
      label: "2018 Ford F-150 XLT",
    });
  });

  it("returns null when the report names no vehicle at all", () => {
    expect(lastAnalyzedVehicleFromReport(null)).toBeNull();
    expect(lastAnalyzedVehicleFromReport(stored(undefined))).toBeNull();
    expect(lastAnalyzedVehicleFromReport(stored({ make: "  ", vin: "SHORT" }))).toBeNull();
  });

  it("keeps a VIN-only vehicle and labels it by VIN, and drops a malformed year", () => {
    const vinOnly = lastAnalyzedVehicleFromReport(stored({ vin: "1FTFW1RG4JFB99180" }));
    expect(vinOnly?.label).toBe("VIN 1FTFW1RG4JFB99180");
    expect(vinOnly?.year).toBeNull();
    expect(lastAnalyzedVehicleFromReport(stored({ year: "20x", make: "Jeep", model: "Grand Wagoneer" }))?.label).toBe("Jeep Grand Wagoneer");
  });
});

describe("isSameVehicle", () => {
  const analyzed = { year: 2018, make: "Ford", model: "F-150", vin: "1FTFW1RG4JFB99180" };

  it("matches on VIN when both sides have one, whatever the typed fields say", () => {
    expect(isSameVehicle(analyzed, { vin: "1ftfw1rg4jfb99180", year: 2019, make: "Ford", model: "Ranger" })).toBe(true);
    expect(isSameVehicle(analyzed, { vin: "1FTFW1RG4JFB99181", year: 2018, make: "Ford", model: "F-150" })).toBe(false);
  });

  it("falls back to year, make and model when a VIN is missing on either side", () => {
    expect(isSameVehicle(analyzed, { year: 2018, make: "ford", model: "f-150" })).toBe(true);
    expect(isSameVehicle({ ...analyzed, vin: null }, { vin: "1FTFW1RG4JFB99180", year: 2018, make: "FORD", model: "F-150" })).toBe(true);
    expect(isSameVehicle(analyzed, { year: 2022, make: "Jeep", model: "Grand Wagoneer" })).toBe(false);
  });

  it("never treats two empty identities as the same vehicle", () => {
    expect(isSameVehicle({ year: null, make: null, model: null, vin: null }, {})).toBe(false);
    expect(isSameVehicle(null, { year: 2018 })).toBe(false);
  });
});
