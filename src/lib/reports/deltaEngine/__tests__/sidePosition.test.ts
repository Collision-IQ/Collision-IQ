/**
 * U-1 (Work Order R3) — side/position normalization is a synonym-set enum,
 * never an LT/RT literal test. Pairing keys are side-insensitive and
 * position-preserving; presentation bases are insensitive to both.
 */
import { describe, it, expect } from "vitest";
import { canonKey, detectSide, detectPosition } from "../estimateNormalize";

describe("detectSide covers real-world side vocabulary", () => {
  const LEFT = [
    "LT Fender",
    "Lt. Quarter panel",
    "LH Door shell",
    "Left rocker molding",
    "(L) Mirror assy",
    "D/S Front door",
    "Driver side skirt",
    "L Fender liner",
  ];
  const RIGHT = [
    "RT Fender",
    "Rt. Quarter panel",
    "RH Door shell",
    "Right rocker molding",
    "(R) Mirror assy",
    "P/S Front door",
    "Passenger side skirt",
    "R Fender liner",
  ];
  for (const desc of LEFT) it(`left: ${desc}`, () => expect(detectSide(desc)).toBe("left"));
  for (const desc of RIGHT) it(`right: ${desc}`, () => expect(detectSide(desc)).toBe("right"));
  it("no side on unsided rows", () => {
    expect(detectSide("Back glass Rivian")).toBe("");
    expect(detectSide("Pre repair scan")).toBe("");
  });
  it("Driver-assistance vocabulary is NOT a side", () => {
    expect(detectSide("Calibrate Drivers Assistant camera(Driver assistance camera)")).toBe("");
    expect(detectSide("Set front camera to Service mode(Driver assistance camera)")).toBe("");
  });
});

describe("detectPosition covers the position axis with abbreviations", () => {
  it("front/FRT", () => {
    expect(detectPosition("LT Front door")).toBe("front");
    expect(detectPosition("LH FRT Door shell")).toBe("front");
  });
  it("rear/RR", () => {
    expect(detectPosition("RT Rear wheel")).toBe("rear");
    expect(detectPosition("RH RR Lamp assy")).toBe("rear");
  });
  it("upper/lower/inner/outer", () => {
    expect(detectPosition("RT Upper panel")).toBe("upper");
    expect(detectPosition("LWR molding LT")).toBe("lower");
    expect(detectPosition("LT Inner reinforcement")).toBe("inner");
    expect(detectPosition("OTR bracket RH")).toBe("outer");
  });
});

describe("pairing key is side-insensitive, position-preserving", () => {
  it("all side vocabularies of the same part share one key", () => {
    const keys = [
      "LT Fender liner",
      "RT Fender liner",
      "LH Fender liner",
      "RH Fender liner",
      "Left Fender liner",
      "Right Fender liner",
    ].map((desc) => canonKey(desc).key);
    expect(new Set(keys).size).toBe(1);
  });
  it("abbreviated and spelled positions share one key", () => {
    expect(canonKey("LH FRT Door shell").key).toBe(canonKey("Left Front Door shell").key);
    expect(canonKey("RH RR Lamp assy").key).toBe(canonKey("Right Rear Lamp assy").key);
  });
  it("front and rear stay DISTINCT pairing keys (never cross-pair)", () => {
    expect(canonKey("LT Front door").key).not.toBe(canonKey("LT Rear door").key);
  });
  it("four-way position group shares ONE base across all four members", () => {
    const bases = [
      "LT Front mud flap",
      "RT Front mud flap",
      "LT Rear mud flap",
      "RT Rear mud flap",
    ].map((desc) => canonKey(desc).base);
    expect(new Set(bases).size).toBe(1);
  });
  it("side and position enums survive into the CanonKey", () => {
    const ck = canonKey("RT Rear wheel");
    expect(ck.side).toBe("right");
    expect(ck.position).toBe("rear");
  });
  it("glued corrupted text still resolves side via squashed fallback", () => {
    expect(canonKey("RTBattery").side).toBe("right");
    expect(canonKey("LTBattery").key).toBe(canonKey("RTBattery").key);
  });
});
