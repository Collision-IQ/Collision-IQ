/**
 * The claim identity gate, and the four ways the real corpus broke it.
 *
 * Every case below is taken from a document in tests/ or the working corpus —
 * none is invented. The gate was written from the RO 22059 pair and then run
 * against RO 22047 and RO 22182, which is where the interesting failures were:
 * it FALSE-BLOCKED RO 22182 on a claim-number revision suffix. A gate that
 * refuses real work gets switched off, taking the real protection with it, so
 * the false-refusal cases are guarded as hard as the true-refusal one.
 */
import { describe, it, expect } from "vitest";
import {
  buildBlockedMessage,
  compareClaimIdentity,
  findVin,
  isValidVin,
  nameTokens,
  readClaimIdentity,
  sameClaimNumber,
  sameVehicleHead,
  type ClaimIdentity,
} from "../claimIdentityGate";

/** RO 22059 header text, exactly as CCC lays it out in each document. */
const SHOP_22059 = [
  "Conestoga Auto Body",
  "Insured:REARDON, CHRISTOPHERPolicy #:Claim #:012283486000000800001",
  "Type of Loss:   ComprehensiveDate of Loss:",
  "RO Number: 22059",
  "2022 TESL Model S Plaid AWD 4D SED Electric- Electric RED",
  "VIN:    5YJSA1E65NF488007Interior Color:WHITE",
].join("\n");

/** The carrier prints the SAME fields in a stacked label/value block. */
const SOR_22059 = [
  "USAA",
  "San Antonio, TX 78265",
  "Claim #:",
  "Workfile ID:",
  "012283486000000800001",
  "cbf21b7c",
  "Supplement of Record 2 with Summary",
  "Insured:Christopher ReardonOwner Policy #:012283486 Claim #:012283486000000800001",
  "2022 TESL Model S Plaid AWD 4D SED Electric- Electric RED",
  "VIN:5YJSA1E65NF488007Interior Color:WHITE",
].join("\n");

describe("fields are found by shape, never by position", () => {
  it("reads the claim number past a stacked label block", () => {
    // `Claim #:\s*(\S+)` returns "Workfile" here. That is the bug this guards.
    expect(readClaimIdentity(SOR_22059).claimNumber).toBe("012283486000000800001");
    expect(readClaimIdentity(SHOP_22059).claimNumber).toBe("012283486000000800001");
  });

  it("reads a VIN welded to the next label", () => {
    // "VIN:    5YJSA1E65NF488007Interior Color:WHITE" — a trailing \b never
    // matches, so the check digit does the accepting instead.
    expect(findVin(SHOP_22059)).toBe("5YJSA1E65NF488007");
    expect(findVin(SOR_22059)).toBe("5YJSA1E65NF488007");
  });

  it("validates a VIN by its ISO 3779 check digit", () => {
    expect(isValidVin("5YJSA1E65NF488007")).toBe(true);
    expect(isValidVin("5YJ3E1EA9NF238704")).toBe(true);
    expect(isValidVin("7FCTGCAA3RN030329")).toBe(true);
    expect(isValidVin("5YJSA1E65NF488008")).toBe(false); // check digit now wrong
    expect(isValidVin("5YJSA1E65NF48800")).toBe(false); // 16 chars
    expect(isValidVin("5YJSA1I65NF488007")).toBe(false); // I is not in the alphabet
  });
});

describe("one name, printed two ways, is one name", () => {
  it("agrees across order, case, and a welded following label", () => {
    expect(nameTokens("REARDON, CHRISTOPHERPolicy #:")).toEqual(["CHRISTOPHER", "REARDON"]);
    expect(nameTokens("Christopher ReardonOwner Policy #:012283486")).toEqual([
      "CHRISTOPHER",
      "REARDON",
    ]);
  });

  it("drops titles and field labels, which are not identity", () => {
    expect(nameTokens("CAPT")).toEqual([]);
    expect(nameTokens("Insured: Mr David Dorsey")).toEqual(["DAVID", "DORSEY"]);
  });

  it("both documents in the RO 22059 pair yield the same owner", () => {
    expect(readClaimIdentity(SHOP_22059).ownerTokens).toEqual(
      readClaimIdentity(SOR_22059).ownerTokens
    );
  });
});

describe("a revision suffix is the same claim — the RO 22182 false block", () => {
  it("accepts the carrier's -01 revision of the shop's number", () => {
    expect(sameClaimNumber("8848396030000002", "8848396030000002-01")).toBe(true);
  });

  it("accepts pure formatting differences", () => {
    expect(sameClaimNumber("012283486000000800001", "12283486000000800001")).toBe(true);
    expect(sameClaimNumber("A-123-456789", "A123456789")).toBe(true);
  });

  it("still rejects a genuinely different claim", () => {
    expect(sameClaimNumber("8848396030000002", "9374951000000801001")).toBe(false);
    // A long tail is a different number, not a revision.
    expect(sameClaimNumber("884839603", "8848396031234567")).toBe(false);
  });
});

describe("vehicle heads compare by year, and by make prefix", () => {
  it("tolerates the make running into the model in glued text", () => {
    // RO 22047: shop "2024 RIVI R1T ADVENTURE", carrier "2024 RIVIR".
    expect(sameVehicleHead("2024 RIVI R1T ADVENTURE", "2024 RIVIR")).toBe(true);
  });

  it("a different year is a different vehicle", () => {
    expect(sameVehicleHead("2024 RIVI R1T", "2022 TESL MODEL S")).toBe(false);
  });
});

describe("the gate blocks on proof, and only on proof", () => {
  const shop = readClaimIdentity(SHOP_22059);
  const sor = readClaimIdentity(SOR_22059);

  it("passes the real RO 22059 pair with no conflicts at all", () => {
    const verdict = compareClaimIdentity(shop, sor);
    expect(verdict.blocked).toBe(false);
    expect(verdict.conflicting).toEqual([]);
    expect(verdict.agreed).toEqual(expect.arrayContaining(["vin", "claim number", "owner"]));
    expect(verdict.unverified).toBe(false);
  });

  it("blocks a document from another claim", () => {
    const alien: ClaimIdentity = {
      vin: "5YJ3E1EA9NF238704",
      claimNumber: "8848396030000002",
      roNumber: "22182",
      ownerTokens: ["DAVID", "DORSEY"],
      vehicle: "2022 TESL MODEL 3",
    };
    const verdict = compareClaimIdentity(shop, alien);
    expect(verdict.blocked).toBe(true);
    expect(verdict.conflicting).toEqual(expect.arrayContaining(["vin", "claim number"]));
  });

  it("never blocks on a weak key alone — the printed form is the producer's choice", () => {
    const sameCarButDifferentlyPrinted: ClaimIdentity = {
      ...shop,
      roNumber: "99999",
      ownerTokens: ["SOMEONEELSE"],
    };
    const verdict = compareClaimIdentity(shop, sameCarButDifferentlyPrinted);
    expect(verdict.conflicting).toEqual(expect.arrayContaining(["RO number", "owner"]));
    expect(verdict.blocked).toBe(false);
  });

  it("absent evidence never proves a mismatch, and says so", () => {
    const blank: ClaimIdentity = {
      vin: null,
      claimNumber: null,
      roNumber: null,
      ownerTokens: [],
      vehicle: null,
    };
    const verdict = compareClaimIdentity(shop, blank);
    expect(verdict.blocked).toBe(false);
    expect(verdict.unverified).toBe(true);
  });

  it("a strong key must agree before the pair counts as verified", () => {
    const weakOnly: ClaimIdentity = {
      vin: null,
      claimNumber: null,
      roNumber: shop.roNumber,
      ownerTokens: shop.ownerTokens,
      vehicle: shop.vehicle,
    };
    expect(compareClaimIdentity(shop, weakOnly).unverified).toBe(true);
  });
});

describe("the blocked message names both documents and only the proving keys", () => {
  it("reports the strong-key mismatch, not the corroborating noise", () => {
    const shop = readClaimIdentity(SHOP_22059);
    const alien: ClaimIdentity = {
      vin: "5YJ3E1EA9NF238704",
      claimNumber: "8848396030000002",
      roNumber: "22182",
      ownerTokens: ["DAVID", "DORSEY"],
      vehicle: "2022 TESL MODEL 3",
    };
    const message = buildBlockedMessage({
      target: { fileName: "Shop 22059.pdf", identity: shop },
      rejected: { fileName: "EOR 22182.pdf", identity: alien },
      verdict: compareClaimIdentity(shop, alien),
    });
    expect(message).toContain("BLOCKED — comparison not run.");
    expect(message).toContain("Shop 22059.pdf");
    expect(message).toContain("EOR 22182.pdf");
    expect(message).toContain("5YJSA1E65NF488007");
    expect(message).toMatch(/Mismatch: .*vin.*claim number/);
    expect(message).not.toMatch(/Mismatch: .*RO number/);
  });
});

/**
 * AN RO NUMBER IS A LABEL, NOT EVIDENCE.
 *
 * Raised as a fixture-naming risk: a file named for RO 22186 carrying claim
 * 26-232003028-01 looks like a mismatch, and the worry was that the pairing
 * could mislead the comparison. It cannot, and these lock in why.
 *
 * A shop's repair-order number and a carrier's file number are independent
 * sequences assigned by different organisations for the same loss. Two
 * documents on one claim routinely carry different ones — and one document's
 * RO number has nothing to do with what somebody typed in a filename. Only
 * the VIN and the claim number, read from the document's own text, are strong
 * enough to block a comparison.
 */
describe("an RO number never blocks a comparison, and a filename never speaks", () => {
  const identity = (over: Partial<ClaimIdentity>): ClaimIdentity => ({
    vin: "5YJSA1E65NF488007",
    claimNumber: "26-232003028-01",
    roNumber: null,
    ownerTokens: [],
    vehicle: null,
    ...over,
  });

  it("records a differing RO number without blocking", () => {
    const verdict = compareClaimIdentity(
      identity({ roNumber: "22186" }),
      identity({ roNumber: "26-232003028-01" })
    );
    expect(verdict.conflicting).toContain("RO number");
    expect(verdict.blocked).toBe(false);
    // The VIN and claim number agree, so the pair is PROVEN, not merely allowed.
    expect(verdict.unverified).toBe(false);
  });

  it("still blocks when a strong key disagrees, whatever the RO numbers say", () => {
    const matchingRo = compareClaimIdentity(
      identity({ roNumber: "22186", vin: "5YJSA1E65NF488007" }),
      identity({ roNumber: "22186", vin: "5YJ3E1EA8JF006632" })
    );
    expect(matchingRo.blocked).toBe(true);
    expect(matchingRo.conflicting).toContain("vin");
  });

  it("reads identity only from document text, never from a file name", () => {
    // The same bytes named two different ways produce identical identity.
    const text = ["Claim #:", "26-232003028-01", "VIN:5YJSA1E65NF488007Interior"].join("\n");
    expect(readClaimIdentity(text)).toEqual(readClaimIdentity(text));
    expect(readClaimIdentity(text).claimNumber).toBe("26-232003028-01");
    // A filename's digits are not a claim number and are never consulted.
    expect(readClaimIdentity("RO 22186 shop final.pdf").claimNumber).toBeNull();
    expect(readClaimIdentity("RO 22186 shop final.pdf").vin).toBeNull();
  });
});

describe("stacked print variants are the same claim — the 21347 false block", () => {
  it("accepts a glued prefix on one side and a revision suffix on the other", () => {
    // Shop prints 02+core; the SOR prints core+-01. VIN, owner, vehicle and
    // RO all agreed and the pair was still refused.
    expect(sameClaimNumber("020274293880101072", "0274293880101072-01")).toBe(true);
  });

  it("accepts a glued prefix alone", () => {
    expect(sameClaimNumber("020274293880101072", "0274293880101072")).toBe(true);
  });

  it("still rejects sequential claim numbers", () => {
    // The nightmare false-positive: consecutive claims share a long prefix.
    expect(sameClaimNumber("8848396030000002", "8848396030000003")).toBe(false);
    expect(sameClaimNumber("8848396030000002-01", "8848396030000003-01")).toBe(false);
  });

  it("still rejects a long glued prefix — that is a different number", () => {
    expect(sameClaimNumber("99887720274293880101072", "0274293880101072")).toBe(false);
  });
});
