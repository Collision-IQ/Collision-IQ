import { describe, expect, it, vi } from "vitest";
import {
  buildGteResearchStatusFindings,
  buildGteSerperQuery,
  describeGteSourceForCustomer,
  GTE_SITE_FILTER,
  isGteUrl,
  labelGteWebResult,
  needsGteEstimatingGuideSupport,
} from "@/lib/ai/gteResearch";

// exportResearch imports prisma at module top; keep the unit tests DB-free.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { __exportResearchTestHooks } from "@/lib/ai/exportResearch";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";

const REPORT = {
  vehicle: { year: 2024, make: "Jeep", model: "Grand Wagoneer" },
  missingProcedures: ["Refinish overlap deduction on adjacent panels"],
  supplementOpportunities: ["Blend within panel not included"],
  findingReasoning: [{ issue: "Headnote-included operations billed separately" }],
  recommendedActions: [],
} as unknown as RepairIntelligenceReport;

const JURISDICTION = { state: "PA", confidence: "high" } as never;

function buildQueries() {
  return __exportResearchTestHooks.buildResearchQueries("repair_intelligence", REPORT, JURISDICTION);
}

const GTE_URL = "https://help.cccis.com/webhelp/motor/gte/refinish_overlap.htm";

describe("CCC/MOTOR GTE targeted Serper research", () => {
  it("includes a site:-restricted GTE query when estimating-guide research is required", () => {
    const queries = buildQueries();
    const gteQueries = queries.filter((query) => query.query.includes(GTE_SITE_FILTER));
    expect(gteQueries).toHaveLength(1);
    expect(gteQueries[0].sourceTarget).toBe("internet");
    expect(gteQueries[0].agent).toBe("Estimate Scrubber Agent");
    // Targeted query only — restricted to the allowed GTE WebHelp target.
    expect(gteQueries[0].query).toContain("site:help.cccis.com/webhelp/motor/gte");
  });

  it("ranks the GTE query ahead of the DEG/SCRS estimating-support query", () => {
    const queries = buildQueries().map((query) => query.query);
    const gteIndex = queries.findIndex((query) => query.includes(GTE_SITE_FILTER));
    const scrsIndex = queries.findIndex((query) => /SCRS DEG/i.test(query));
    expect(gteIndex).toBeGreaterThanOrEqual(0);
    expect(scrsIndex).toBeGreaterThan(gteIndex);
  });

  it("buildGteSerperQuery always applies the site filter", () => {
    expect(buildGteSerperQuery("refinish overlap")).toBe(
      "site:help.cccis.com/webhelp/motor/gte refinish overlap"
    );
  });

  it("recognizes only the allowed GTE target as a GTE URL", () => {
    expect(isGteUrl(GTE_URL)).toBe(true);
    expect(isGteUrl("http://help.cccis.com/webhelp/motor/gte/overlap")).toBe(true);
    expect(isGteUrl("https://help.cccis.com/webhelp/other/page")).toBe(false);
    expect(isGteUrl("https://www.cccis.com/products")).toBe(false);
    expect(isGteUrl(undefined)).toBe(false);
  });

  it("detects estimating-guide topics that call for GTE support", () => {
    expect(needsGteEstimatingGuideSupport("included vs not-included refinish operations")).toBe(true);
    expect(needsGteEstimatingGuideSupport("overlap deduction headnote")).toBe(true);
    expect(needsGteEstimatingGuideSupport("airbag control module replacement")).toBe(false);
  });
});

describe("CCC/MOTOR GTE result labeling", () => {
  const source = __exportResearchTestHooks.buildGteWebSource(
    { title: "Refinish – Overlap", link: GTE_URL, snippet: "Overlap considerations for adjacent panels." },
    "Estimate Scrubber Agent"
  );

  it("labels GTE results as general estimating-guide evidence", () => {
    expect(source.sourceTitle).toContain("CCC/MOTOR Guide to Estimating (GTE)");
    expect(source.sourceTitle).toContain("general estimating guidance");
    expect(source.sourceType).toBe("industry");
    expect(source.supportCategory).toBe("Internet-Sourced Industry Support");
  });

  it("never labels GTE web results as vehicle-specific or sandbox evidence", () => {
    expect(source.sourceType).not.toBe("oem");
    expect(source.supportCategory).not.toBe("Verified OEM / Position Statement Support");
    expect(`${source.sourceTitle} ${source.locator}`).not.toMatch(/sandbox|daas|vehicle-specific/i);
    // Even a procedure-worded GTE title stays industry (the URL, not the title, decides).
    const procedureTitled = __exportResearchTestHooks.buildGteWebSource(
      { title: "Labor repair procedure explanations", link: GTE_URL },
      "Estimate Scrubber Agent"
    );
    expect(procedureTitled.sourceType).toBe("industry");
    expect(labelGteWebResult("Repair procedure premise").sourceType).toBe("industry");
  });

  it("stores metadata only: URL, title, retrievedAt, short snippet", () => {
    expect(source.url).toBe(GTE_URL);
    expect(source.sourceTitle.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(source.retrievalTimestamp))).toBe(false);
    expect(source.snippet).toBe("Overlap considerations for adjacent panels.");
    const longSnippet = "x".repeat(1000);
    const clipped = __exportResearchTestHooks.buildGteWebSource(
      { title: "Headnotes", link: GTE_URL, snippet: longSnippet },
      "Estimate Scrubber Agent"
    );
    expect((clipped.snippet ?? "").length).toBeLessThanOrEqual(400);
  });
});

describe("CCC/MOTOR GTE claims discipline", () => {
  it("reports 'not confirmed' when the GTE query ran but nothing was retrieved", () => {
    const findings = buildGteResearchStatusFindings(
      [{ query: `${GTE_SITE_FILTER} refinish overlap` }],
      []
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("Not confirmed by CCC/MOTOR GTE web research");
  });

  it("stays silent when a GTE source was retrieved or no GTE query ran", () => {
    expect(
      buildGteResearchStatusFindings([{ query: `${GTE_SITE_FILTER} overlap` }], [{ url: GTE_URL }])
    ).toHaveLength(0);
    expect(buildGteResearchStatusFindings([{ query: "SCRS DEG overlap" }], [])).toHaveLength(0);
  });

  it("customer-facing summary is plain English first (no URLs or search jargon)", () => {
    const summary = describeGteSourceForCustomer("Refinish – Overlap");
    expect(summary.startsWith("The industry estimating guide")).toBe(true);
    expect(summary).toContain("not specific to your vehicle");
    expect(summary).not.toMatch(/https?:\/\/|site:/i);
  });
});
