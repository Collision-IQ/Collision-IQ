import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchJsonWithRetry } from "@/lib/nhtsa/client";
import { decodeVinViaVpic, decodedVinToProfileFields, formatVpicMake } from "@/lib/nhtsa/vinDecode";
import { getRecallsForVehicle } from "@/lib/nhtsa/recalls";
import { RECALL_MATCH_DISCLAIMER, type NhtsaRecall } from "@/lib/nhtsa/types";
import {
  buildRecallAlertText,
  checkVehicleRecalls,
  groupByIdentity,
  identityFromProfile,
  identityKey,
  mergeSeenCampaignNumbers,
  resolveRecallIdentity,
  selectNewCampaigns,
} from "@/lib/nhtsa/vehicleRecalls";

const noSleep = async () => {};
const VIN = "1C4SJVFP1RS133438";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  };
}

const vpicOk = {
  Results: [{ ErrorCode: "0", Make: "JEEP", Model: "Grand Wagoneer", ModelYear: "2024", Trim: "Series III", BodyClass: "SUV" }],
};

const recallRows = {
  Count: 1,
  results: [
    {
      Manufacturer: "FCA US, LLC",
      NHTSACampaignNumber: "24V123000",
      Component: "AIR BAGS",
      Summary: "Driver air bag inflator may rupture.",
      Consequence: "Metal fragments may injure occupants.",
      Remedy: "Dealers will replace the inflator free of charge.",
      ReportReceivedDate: "01/15/2024",
    },
  ],
};

function campaign(n: string): NhtsaRecall {
  return { campaignNumber: n, component: "C", summary: "S", consequence: "Q", remedy: "R", reportReceivedDate: "01/01/2024", manufacturer: "M" };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchJsonWithRetry", () => {
  it("retries a 5xx with backoff and returns the eventual JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn(noSleep);

    await expect(fetchJsonWithRetry<{ ok: number }>("https://x", { sleep })).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("gives up after the retry budget and surfaces the last error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 429)));
    await expect(fetchJsonWithRetry("https://x", { retries: 1, sleep: noSleep })).rejects.toThrow(/429/);
  });

  it("does not retry a 4xx that is not rate limiting", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 404));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJsonWithRetry("https://x", { sleep: noSleep })).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("decodeVinViaVpic", () => {
  it("rejects a malformed VIN without calling NHTSA", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await decodeVinViaVpic("1C4SJVFP1RS13343O"); // trailing O, 17 chars
    expect(result.isValid).toBe(false);
    expect(result.errorText).toMatch(/17 characters/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a clean vPIC decode to make/model/year", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(vpicOk));
    vi.stubGlobal("fetch", fetchMock);
    const result = await decodeVinViaVpic(` ${VIN.toLowerCase()} `, { sleep: noSleep });
    expect(result).toMatchObject({ vin: VIN, make: "JEEP", model: "Grand Wagoneer", modelYear: "2024", isValid: true, errorText: null });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`/decodevinvalues/${VIN}?format=json`);
  });

  it("flags a degraded decode (no Make) as invalid but keeps the error text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ Results: [{ ErrorCode: "1", ErrorText: "Check digit failed", Make: "" }] })));
    const result = await decodeVinViaVpic(VIN, { sleep: noSleep });
    expect(result.isValid).toBe(false);
    expect(result.errorText).toBe("Check digit failed");
  });
});

describe("getRecallsForVehicle", () => {
  it("queries by make/model/year and maps NHTSA's PascalCase fields", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(recallRows));
    vi.stubGlobal("fetch", fetchMock);
    const recalls = await getRecallsForVehicle({ make: "JEEP", model: "Grand Wagoneer", modelYear: "2024" }, { sleep: noSleep });
    expect(recalls).toEqual([
      {
        campaignNumber: "24V123000",
        component: "AIR BAGS",
        summary: "Driver air bag inflator may rupture.",
        consequence: "Metal fragments may injure occupants.",
        remedy: "Dealers will replace the inflator free of charge.",
        reportReceivedDate: "01/15/2024",
        manufacturer: "FCA US, LLC",
      },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/recalls/recallsByVehicle");
    expect(url.searchParams.get("make")).toBe("JEEP");
    expect(url.searchParams.get("model")).toBe("Grand Wagoneer");
    expect(url.searchParams.get("modelYear")).toBe("2024");
  });
});

describe("identity resolution", () => {
  it("uses the typed year/make/model only when all three are present", () => {
    expect(identityFromProfile({ year: 2022, make: "Jeep", model: "Grand Wagoneer" })).toEqual({ make: "Jeep", model: "Grand Wagoneer", modelYear: "2022" });
    expect(identityFromProfile({ year: 2022, make: "Jeep" })).toBeNull();
    expect(identityFromProfile({ make: "Jeep", model: "Grand Wagoneer" })).toBeNull();
  });

  it("prefers a vPIC decode of the VIN over what the user typed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(vpicOk)));
    const resolved = await resolveRecallIdentity({ vin: VIN, year: 2019, make: "Typo", model: "Wrong" }, { sleep: noSleep });
    expect(resolved).toEqual({ identity: { make: "JEEP", model: "Grand Wagoneer", modelYear: "2024" }, source: "vin_decoded", vin: VIN });
  });

  it("reuses a cached decode of the same VIN without calling vPIC again", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cached = {
      checkedAt: "2026-01-01T00:00:00.000Z",
      status: "ok" as const,
      identity: { make: "JEEP", model: "Grand Wagoneer", modelYear: "2024" },
      identitySource: "vin_decoded" as const,
      vin: VIN,
      campaigns: [],
      message: null,
      disclaimer: RECALL_MATCH_DISCLAIMER,
    };
    const resolved = await resolveRecallIdentity({ vin: VIN, recalls: cached });
    expect(resolved?.source).toBe("vin_decoded");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the typed identity when the VIN cannot be decoded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ Results: [{ ErrorCode: "5", ErrorText: "Unknown", Make: "" }] })));
    const resolved = await resolveRecallIdentity({ vin: VIN, year: 2024, make: "Jeep", model: "Grand Wagoneer" }, { sleep: noSleep });
    expect(resolved).toEqual({ identity: { make: "Jeep", model: "Grand Wagoneer", modelYear: "2024" }, source: "profile", vin: VIN });
  });

  it("groups vehicles by year/make/model case-insensitively", () => {
    const groups = groupByIdentity([
      { id: 1, identity: { make: "JEEP", model: "Grand Wagoneer", modelYear: "2024" } },
      { id: 2, identity: { make: "Jeep", model: "grand wagoneer", modelYear: "2024" } },
      { id: 3, identity: { make: "Jeep", model: "Grand Wagoneer", modelYear: "2023" } },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].vehicles.map((v) => v.id)).toEqual([1, 2]);
    expect(identityKey(groups[1].identity)).toBe("2023|JEEP|GRAND WAGONEER");
  });
});

describe("checkVehicleRecalls", () => {
  it("decodes, looks up, and returns an ok snapshot carrying the disclaimer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(vpicOk))
      .mockResolvedValueOnce(jsonResponse(recallRows));
    vi.stubGlobal("fetch", fetchMock);
    const now = () => new Date("2026-09-21T13:00:00.000Z");

    const snapshot = await checkVehicleRecalls({ vin: VIN }, { sleep: noSleep, now });
    expect(snapshot.status).toBe("ok");
    expect(snapshot.checkedAt).toBe("2026-09-21T13:00:00.000Z");
    expect(snapshot.identitySource).toBe("vin_decoded");
    expect(snapshot.campaigns.map((c) => c.campaignNumber)).toEqual(["24V123000"]);
    expect(snapshot.disclaimer).toBe(RECALL_MATCH_DISCLAIMER);
    expect(snapshot.disclaimer).toMatch(/not your exact VIN/);
  });

  it("is unavailable, and never calls NHTSA, when nothing identifies the vehicle", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = await checkVehicleRecalls({ mileage: 1000 } as never);
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.campaigns).toEqual([]);
    expect(snapshot.message).toMatch(/Enter a VIN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records an error snapshot instead of throwing or pretending there are no recalls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(vpicOk))
      .mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = await checkVehicleRecalls({ vin: VIN }, { sleep: noSleep, retries: 0 });
    expect(snapshot.status).toBe("error");
    expect(snapshot.identity).toEqual({ make: "JEEP", model: "Grand Wagoneer", modelYear: "2024" });
    expect(snapshot.message).toMatch(/recall lookup failed/);
  });
});

describe("seen-campaign bookkeeping", () => {
  it("selects only campaigns the owner has not been told about", () => {
    const fresh = selectNewCampaigns([campaign("24V123000"), campaign("25V000111")], ["24v123000"]);
    expect(fresh.map((c) => c.campaignNumber)).toEqual(["25V000111"]);
  });

  it("merges seen numbers without duplicates", () => {
    expect(mergeSeenCampaignNumbers(["24V123000"], [campaign("24V123000"), campaign("25V000111")])).toEqual(["24V123000", "25V000111"]);
    expect(mergeSeenCampaignNumbers(undefined, [])).toEqual([]);
  });

  it("writes an alert that leads with the answer and keeps the VIN caveat", () => {
    const text = buildRecallAlertText({
      identity: { make: "JEEP", model: "Grand Wagoneer", modelYear: "2024" },
      campaigns: [campaign("24V123000")],
    });
    expect(text.startsWith("NHTSA has a new recall campaign that may apply to your 2024 JEEP Grand Wagoneer.")).toBe(true);
    expect(text).toContain("Campaign 24V123000");
    expect(text).toContain(RECALL_MATCH_DISCLAIMER);
  });
});

describe("route governance", () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

  it("the weekly cron requires CRON_SECRET or Platform Admin and is scheduled in vercel.json", () => {
    const source = read("src/app/api/cron/check-recalls/route.ts");
    expect(source).toMatch(/CRON_SECRET/);
    expect(source).toMatch(/isPlatformAdmin/);
    expect(source).toMatch(/401/);
    const vercel = JSON.parse(read("vercel.json")) as { crons?: Array<{ path: string; schedule: string }> };
    expect(vercel.crons?.some((c) => c.path === "/api/cron/check-recalls")).toBe(true);
  });

  it("the on-demand route is scoped to the signed-in user", () => {
    const source = read("src/app/api/vehicle/recalls/route.ts");
    expect(source).toMatch(/requireCurrentUser/);
    expect(source).not.toMatch(/req(uest)?\.json\(/); // no client-supplied VIN — the stored profile is the source
  });

  it("clients cannot write the server-managed recall fields through PUT /api/vehicle", () => {
    const source = read("src/app/api/vehicle/route.ts");
    expect(source).not.toMatch(/recalls|seenRecallCampaignNumbers/);
  });
});

describe("VIN decode → profile fields", () => {
  it("presents vPIC's all-caps makes the way owners write them", () => {
    expect(formatVpicMake("FORD")).toBe("Ford");
    expect(formatVpicMake("MERCEDES-BENZ")).toBe("Mercedes-Benz");
    expect(formatVpicMake("LAND ROVER")).toBe("Land Rover");
    expect(formatVpicMake("BMW")).toBe("BMW");
    expect(formatVpicMake("GMC")).toBe("GMC");
    expect(formatVpicMake("  ")).toBeNull();
  });

  it("fills year/make/model/trim from a valid decode and nothing from an invalid one", () => {
    expect(
      decodedVinToProfileFields({ vin: VIN, make: "JEEP", model: "Grand Wagoneer", modelYear: "2024", trim: "Series III", bodyClass: "SUV", isValid: true, errorText: null })
    ).toEqual({ year: 2024, make: "Jeep", model: "Grand Wagoneer", trim: "Series III" });
    expect(
      decodedVinToProfileFields({ vin: VIN, make: "JEEP", model: null, modelYear: "2024", trim: null, bodyClass: null, isValid: false, errorText: "Check digit failed" })
    ).toEqual({ year: null, make: null, model: null, trim: null });
  });

  it("the decode route is authenticated, accepts only a VIN, and persists nothing", () => {
    const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
    const source = read("src/app/api/vehicle/decode-vin/route.ts");
    expect(source).toMatch(/requireCurrentUser/);
    expect(source).toMatch(/decodeVinViaVpic/);
    expect(source).not.toMatch(/saveVehicleProfile|saveVehicleRecallSnapshot|prisma/);
    // The panel decodes on VIN entry and fills the fields.
    const panel = read("src/components/workspace/MyVehiclePanel.tsx");
    expect(panel).toMatch(/\/api\/vehicle\/decode-vin/);
    expect(panel).toMatch(/lastDecodedVin/);
    // A saved VIN with fields missing decodes on load (filling gaps only), and
    // there is always a manual Decode VIN button as the explicit trigger.
    expect(panel).toMatch(/"fill-missing"/);
    expect(panel).toMatch(/Decode VIN/);
  });
});
