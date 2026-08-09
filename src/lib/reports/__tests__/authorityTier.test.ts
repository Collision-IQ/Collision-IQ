/**
 * THE RO 22059 LEAK.
 *
 * That Repair Intelligence Report listed an Instagram post and a forum thread
 * under an OEM heading at 68% confidence, beside the genuine Tesla Model S
 * collision procedures — because the retrieval layer had stamped all of them
 * `sourceType: "oem"` and every consumer trusted the label.
 *
 * These tests use those real titles. The rule they pin is that tier comes from
 * the URL, never from the upstream label, and that an unplaceable source is
 * refused rather than admitted at the bottom of the ladder.
 */
import { describe, it, expect } from "vitest";
import { classifyAuthorities, classifyAuthority } from "../authorityTier";

describe("social and forum content is never citable authority", () => {
  it("rejects the Instagram post that was filed under OEM support", () => {
    const result = classifyAuthority({
      title: "OEM procedures aren't just about repair quality Instagram",
      url: "https://www.instagram.com/p/Cabc123/",
    });
    expect(result).toHaveProperty("rejected");
    if ("rejected" in result) {
      expect(result.rejected.reason).toMatch(/User-generated content \(instagram\.com\)/);
    }
  });

  it("rejects a discussion thread wherever it is hosted", () => {
    const result = classifyAuthority({
      title: "Help us make sense of this? Insurer beats collision repair shop with",
      url: "https://example-bodyshop-news.com/forums/thread/12345",
    });
    expect(result).toHaveProperty("rejected");
    if ("rejected" in result) {
      expect(result.rejected.reason).toMatch(/Discussion thread/);
    }
  });

  it("is not fooled by an authoritative-sounding title on a social host", () => {
    // The title is the part a summarizer can invent; the host is not.
    const result = classifyAuthority({
      title: "Tesla Official Collision Repair Position Statement",
      url: "https://www.reddit.com/r/autobody/comments/abc/",
    });
    expect(result).toHaveProperty("rejected");
  });

  it("is not fooled by a social host hidden on a subdomain", () => {
    const result = classifyAuthority({
      title: "OEM procedure discussion",
      url: "https://business.facebook.com/somepage",
    });
    expect(result).toHaveProperty("rejected");
  });
});

describe("the ladder places genuine sources by publisher, not by claimed type", () => {
  it("puts an OEM procedure page at tier 1", () => {
    const result = classifyAuthority({
      title: "Model S (2021+) Collision Repair Procedures",
      url: "https://service.tesla.com/docs/ModelS/CollisionRepair/index.html",
    });
    expect(result).toHaveProperty("tier");
    if ("tier" in result) {
      expect(result.tier.tier).toBe(1);
      expect(result.tier.tierBasis).toMatch(/OEM published source/);
    }
  });

  it("puts licensed estimating data at tier 2", () => {
    const result = classifyAuthority({ title: "P-page refinish guidelines", url: "https://www.motor.com/guide" });
    expect("tier" in result && result.tier.tier).toBe(2);
  });

  it("puts a regulator at tier 3 by TLD, without needing to be listed by name", () => {
    const result = classifyAuthority({
      title: "31 Pa. Code § 62.3 Applicable standards for appraisal",
      url: "https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/031/chapter62/s62.3.html",
    });
    expect("tier" in result && result.tier.tier).toBe(3);
  });

  it("accepts a statute cited by identifier alone, where a bare title would be refused", () => {
    const cited = classifyAuthority({ title: "31 Pa. Code § 62.3 Applicable standards for appraisal" });
    expect("tier" in cited && cited.tier.tier).toBe(3);

    const bare = classifyAuthority({ title: "Some general repair guidance" });
    expect(bare).toHaveProperty("rejected");
    if ("rejected" in bare) expect(bare.rejected.reason).toMatch(/No resolvable source location/);
  });

  it("puts I-CAR at tier 4 — real, but not the OEM itself", () => {
    const result = classifyAuthority({ title: "Tesla I-CAR", url: "https://rts.i-car.com/oem-information/tesla.html" });
    expect("tier" in result && result.tier.tier).toBe(4);
  });

  it("admits an unrecognised publisher at tier 5 with an explicit caveat", () => {
    const result = classifyAuthority({
      title: "Structural sectioning overview",
      url: "https://www.some-trade-journal.com/article/123",
    });
    expect("tier" in result && result.tier.tier).toBe(5);
    if ("tier" in result) expect(result.tier.tierBasis).toMatch(/confirm against a primary source/);
  });

  it("takes uploaded case evidence at tier 1 on provenance, with no host to check", () => {
    const result = classifyAuthority({ title: "Pre-repair scan report", uploadedEvidence: true });
    expect("tier" in result && result.tier.tier).toBe(1);
  });
});

describe("classifying the RO 22059 set as a whole", () => {
  const RO_22059_SOURCES = [
    { title: "Model S (2021+) Collision Repair Procedures (2021+) Tesla", url: "https://service.tesla.com/docs/ModelS/CollisionRepair/" },
    { title: "31 Pa. Code § 62.3 Applicable standards for appraisal", url: "https://www.pacodeandbulletin.gov/Display/pacode?file=62.3" },
    { title: "Tesla I-CAR", url: "https://rts.i-car.com/oem-information/tesla.html" },
    { title: "OEM procedures aren't just about repair quality Instagram", url: "https://www.instagram.com/p/Cabc123/" },
    { title: "Help us make sense of this? Insurer beats collision repair shop with", url: "https://news.example.com/forums/thread/9" },
    { title: "Position Statements | Oem1stop.com", url: "https://oem1stop.com/position-statements" },
  ];

  it("keeps the four real sources, refuses the two that are not, and orders by tier", () => {
    const { accepted, rejected } = classifyAuthorities(RO_22059_SOURCES);
    expect(accepted.map((item) => item.tier)).toEqual([1, 1, 3, 4]);
    expect(accepted.map((item) => item.title)).toEqual([
      "Model S (2021+) Collision Repair Procedures (2021+) Tesla",
      "Position Statements | Oem1stop.com",
      "31 Pa. Code § 62.3 Applicable standards for appraisal",
      "Tesla I-CAR",
    ]);
    expect(rejected).toHaveLength(2);
    // Refusals are recorded, so the report can say what it declined to cite
    // rather than quietly presenting a shorter evidence list.
    expect(rejected.map((item) => item.reason).join(" ")).toMatch(/instagram\.com/);
  });

  it("does not list the same procedure twice when two lanes both return it", () => {
    const { accepted } = classifyAuthorities([
      { title: "Model S Collision Repair Procedures", url: "https://service.tesla.com/docs/ModelS/" },
      { title: "Model S Collision Repair Procedures | Tesla", url: "https://service.tesla.com/docs/ModelS/" },
    ]);
    expect(accepted).toHaveLength(1);
  });
});
