import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RECALL_NO_VEHICLE_CONTEXT,
  buildRecallEvidenceContext,
  extractVinFromText,
  isRecallLookupRequest,
  runChatRecallLookup,
  selectRecallVehicle,
} from "@/lib/nhtsa/chatRecallLookup";
import { RECALL_MATCH_DISCLAIMER, type VehicleRecallSnapshot } from "@/lib/nhtsa/types";

const VIN = "1C4SJVFP1RS133438";
const noSleep = async () => {};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, statusText: "OK", json: async () => body };
}

const vpicOk = { Results: [{ ErrorCode: "0", Make: "JEEP", Model: "Grand Wagoneer", ModelYear: "2024" }] };
const oneRecall = {
  Count: 1,
  results: [{ Manufacturer: "FCA US, LLC", NHTSACampaignNumber: "24V123000", Component: "AIR BAGS", Summary: "Inflator may rupture.", Consequence: "Injury risk.", Remedy: "Replace inflator.", ReportReceivedDate: "01/15/2024" }],
};

function okSnapshot(overrides: Partial<VehicleRecallSnapshot> = {}): VehicleRecallSnapshot {
  return {
    checkedAt: "2026-09-21T13:00:00.000Z",
    status: "ok",
    identity: { make: "JEEP", model: "Grand Wagoneer", modelYear: "2024" },
    identitySource: "vin_decoded",
    vin: VIN,
    campaigns: [],
    message: null,
    disclaimer: RECALL_MATCH_DISCLAIMER,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("isRecallLookupRequest", () => {
  it("fires for recall questions with a lookup cue, a VIN, or the user's own vehicle", () => {
    for (const m of [
      `Check for recall: ${VIN}`,
      "Are there any open recalls on my car?",
      "does this vehicle have a recall",
      "NHTSA recall campaigns for a 2024 Jeep Grand Wagoneer?",
      "was the airbag recalled",
      `${VIN} recalls`,
    ]) {
      expect(isRecallLookupRequest(m), m).toBe(true);
    }
  });

  it("stays quiet for the verb sense and for unrelated messages", () => {
    for (const m of [
      "I don't recall what the adjuster said",
      "I recall the estimate was $4,200",
      "what's missing from this estimate?",
      "explain blend within panel",
    ]) {
      expect(isRecallLookupRequest(m), m).toBe(false);
    }
  });
});

describe("extractVinFromText", () => {
  it("finds a VIN in prose regardless of case and ignores 17-digit claim numbers", () => {
    expect(extractVinFromText(`check for recall: ${VIN.toLowerCase()} please`)).toBe(VIN);
    expect(extractVinFromText("claim 12345678901234567 opened")).toBeNull();
    expect(extractVinFromText("no vin here")).toBeNull();
  });
});

describe("selectRecallVehicle", () => {
  it("prefers the VIN in the message over the case and the stored vehicle", () => {
    const pick = selectRecallVehicle({
      userMessage: `recall check ${VIN}`,
      resolvedVehicle: { vin: "5YJYGDEE5NF000000", year: 2022, make: "Tesla", model: "Model Y" },
      storedProfile: { vin: "WBA3A5C51CF256987" },
    });
    expect(pick).toMatchObject({ vehicleSource: "message_vin", usedStoredVehicle: false, input: { vin: VIN } });
  });

  it("marks the lookup as the stored vehicle when the message VIN matches it, carrying the cached decode", () => {
    const stored = { vin: VIN, recalls: okSnapshot() };
    const pick = selectRecallVehicle({ userMessage: `any recalls on ${VIN}?`, storedProfile: stored });
    expect(pick?.usedStoredVehicle).toBe(true);
    expect(pick?.input.recalls).toBe(stored.recalls);
  });

  it("falls through case VIN → case year/make/model → stored profile → null", () => {
    expect(selectRecallVehicle({ userMessage: "recalls?", resolvedVehicle: { vin: VIN } })?.vehicleSource).toBe("case_vehicle");
    expect(
      selectRecallVehicle({ userMessage: "recalls?", resolvedVehicle: { year: 2024, make: "Jeep", model: "Grand Wagoneer" } })
    ).toMatchObject({ vehicleSource: "case_vehicle", input: { year: 2024, make: "Jeep", model: "Grand Wagoneer" } });
    expect(selectRecallVehicle({ userMessage: "any recalls on my car?", storedProfile: { year: 2021, make: "GMC", model: "Acadia" } })).toMatchObject({
      vehicleSource: "stored_vehicle",
      usedStoredVehicle: true,
    });
    expect(selectRecallVehicle({ userMessage: "any recalls on my car?", resolvedVehicle: { make: "Jeep" }, storedProfile: {} })).toBeNull();
  });
});

describe("buildRecallEvidenceContext", () => {
  it("lists campaigns by number with the year/make/model caveat and a no-memory rule", () => {
    const ctx = buildRecallEvidenceContext(
      okSnapshot({ campaigns: [{ campaignNumber: "24V123000", component: "AIR BAGS", summary: "S", consequence: "Q", remedy: "R", reportReceivedDate: "01/15/2024", manufacturer: "M" }] }),
      "message_vin"
    );
    expect(ctx).toContain("LIVE NHTSA RECALL LOOKUP");
    expect(ctx).toContain("Campaign 24V123000");
    expect(ctx).toContain("decoded from the VIN by NHTSA vPIC");
    expect(ctx).toMatch(/never add, remove, or embellish campaigns from memory/);
    expect(ctx).toMatch(/year\/make\/model, not the exact VIN/);
    expect(ctx).toContain("nhtsa.gov/recalls");
  });

  it("tells the model to report a failed lookup honestly instead of answering from memory", () => {
    const ctx = buildRecallEvidenceContext(okSnapshot({ status: "error", campaigns: [], message: "NHTSA recall lookup failed: 503" }), "stored_vehicle");
    expect(ctx).toContain("LOOKUP DID NOT COMPLETE");
    expect(ctx).toContain("503");
    expect(ctx).toMatch(/Do NOT list recalls from memory/);
  });

  it("has a no-vehicle block that forbids answering from memory", () => {
    expect(RECALL_NO_VEHICLE_CONTEXT).toMatch(/do NOT list recalls from memory/);
    expect(RECALL_NO_VEHICLE_CONTEXT).toMatch(/17-character VIN/);
  });
});

describe("runChatRecallLookup", () => {
  it("decodes the message VIN, queries NHTSA, and returns the evidence block", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(vpicOk)).mockResolvedValueOnce(jsonResponse(oneRecall)));
    const result = await runChatRecallLookup({ userMessage: `Check for recall: ${VIN}`, options: { sleep: noSleep } });
    expect(result?.vehicleSource).toBe("message_vin");
    expect(result?.snapshot.status).toBe("ok");
    expect(result?.snapshot.campaigns.map((c) => c.campaignNumber)).toEqual(["24V123000"]);
    expect(result?.context).toContain("Campaign 24V123000");
  });

  it("returns null, without calling NHTSA, when no vehicle is identifiable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await runChatRecallLookup({ userMessage: "any recalls I should know about?" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("chat route wiring", () => {
  it("the chat route runs the live lookup and feeds it to both model passes", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    expect(source).toMatch(/isRecallLookupRequest\(/);
    expect(source).toMatch(/runChatRecallLookup\(/);
    expect(source).toMatch(/RECALL_NO_VEHICLE_CONTEXT/);
    // The live evidence must reach the first pass (both the normal and the reduced
    // retry input) and the research-mode refinement pass, never only one of them.
    expect((source.match(/instructions: liveEvidenceInstructions/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/systemInstructions: liveEvidenceInstructions/);
  });
});
