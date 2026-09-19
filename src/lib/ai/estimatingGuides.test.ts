import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ESTIMATING_GUIDES,
  buildEstimatingGuideQuery,
  buildEstimatingGuideStatusFindings,
  buildEstimatingReferenceLibraryDirective,
  findEstimatingGuideForUrl,
  isEstimatingGuideUrl,
  labelEstimatingGuideResult,
  mentionsRecycledAssembly,
  selectEstimatingGuides,
  sniffEstimatingPlatform,
} from "@/lib/ai/estimatingGuides";
import { buildGteResearchStatusFindings, isGteUrl } from "@/lib/ai/gteResearch";
import { classifyAuthority } from "@/lib/reports/authorityTier";

// The four addresses the library was asked to memorize, verbatim.
const MITCHELL_PPAGES = "https://static.mymitchell.com/static/Webhelp/ppages/ceg/1033/Content/ceg020000.htm";
const CCC_GTE = "https://help.cccis.com/webhelp/motor/gte/guide.htm";
const CCC_RAGTE = "https://help.cccis.com/webhelp/motor/ragte/slguide.htm";
const MOTOR_EBOOK_ADMIN = "https://vercel.com/collision-academy-82dbb1d7/motor-ebook";

describe("the estimating reference library knows each guide by address", () => {
  it("records the three web guides with their entry pages and the e-book's admin location", () => {
    const byId = Object.fromEntries(ESTIMATING_GUIDES.map((guide) => [guide.id, guide]));
    expect(byId.mitchell_ceg_ppages.url).toBe(MITCHELL_PPAGES);
    expect(byId.ccc_gte.url).toBe(CCC_GTE);
    expect(byId.ccc_ragte.url).toBe(CCC_RAGTE);
    expect(byId.motor_ebook.adminUrl).toBe(MOTOR_EBOOK_ADMIN);
    expect(byId.motor_ebook.site).toBeNull();
  });

  it("recognises a page under each web guide and nothing else", () => {
    expect(findEstimatingGuideForUrl(MITCHELL_PPAGES)?.id).toBe("mitchell_ceg_ppages");
    expect(findEstimatingGuideForUrl("https://static.mymitchell.com/static/Webhelp/ppages/ceg/1033/Content/refinish.htm")?.id).toBe("mitchell_ceg_ppages");
    expect(findEstimatingGuideForUrl(CCC_GTE)?.id).toBe("ccc_gte");
    expect(findEstimatingGuideForUrl("http://help.cccis.com/webhelp/motor/gte/refinish_overlap.htm")?.id).toBe("ccc_gte");
    expect(findEstimatingGuideForUrl(CCC_RAGTE)?.id).toBe("ccc_ragte");
    expect(findEstimatingGuideForUrl("https://help.cccis.com/webhelp/other/page.htm")).toBeNull();
    expect(findEstimatingGuideForUrl("https://www.reddit.com/r/autobody/")).toBeNull();
    expect(isEstimatingGuideUrl(MOTOR_EBOOK_ADMIN)).toBe(false);
  });

  it("keeps the GTE-specific predicate GTE-only so existing labels do not drift", () => {
    expect(isGteUrl(CCC_GTE)).toBe(true);
    expect(isGteUrl(CCC_RAGTE)).toBe(false);
    expect(isGteUrl(MITCHELL_PPAGES)).toBe(false);
  });
});

describe("guide selection follows the estimate's platform", () => {
  it("sniffs the platform from the document's own markers", () => {
    expect(sniffEstimatingPlatform("Mitchell Cloud Estimating\nLine 4 Frt Bumper Cover")).toBe("mitchell");
    expect(sniffEstimatingPlatform("Workfile ID: cb677f34\nCCC ONE Estimating")).toBe("ccc");
    expect(sniffEstimatingPlatform("Estimate based on MOTOR CRASH ESTIMATING GUIDE")).toBe("ccc");
    expect(sniffEstimatingPlatform("just some prose")).toBeNull();
  });

  it("a Mitchell estimate is answered from the Mitchell P-Pages, never the CCC/MOTOR guide", () => {
    const guides = selectEstimatingGuides({ platform: "mitchell", text: "R&I fender liner included" });
    expect(guides.map((guide) => guide.id)).toEqual(["mitchell_ceg_ppages"]);
  });

  it("a CCC estimate is answered from the GTE, plus the RAGTE when it prices recycled assemblies", () => {
    expect(selectEstimatingGuides({ platform: "ccc", text: "Repl bumper cover" }).map((g) => g.id)).toEqual(["ccc_gte"]);
    expect(selectEstimatingGuides({ platform: "ccc", text: "Repl LKQ door assembly" }).map((g) => g.id)).toEqual(["ccc_gte", "ccc_ragte"]);
    expect(mentionsRecycledAssembly("Recycled assembly, used door shell")).toBe(true);
    expect(mentionsRecycledAssembly("Repl new fender")).toBe(false);
  });

  it("an unknown platform searches both books so a Mitchell line is not answered from the wrong one", () => {
    expect(selectEstimatingGuides({ text: "overlap deduction" }).map((g) => g.id)).toEqual(["ccc_gte", "mitchell_ceg_ppages"]);
  });

  it("never selects the e-book for a web search", () => {
    for (const platform of ["ccc", "mitchell", null] as const) {
      expect(selectEstimatingGuides({ platform, text: "recycled used lkq" }).some((g) => g.id === "motor_ebook")).toBe(false);
    }
  });

  it("builds a site-restricted query per guide", () => {
    const [gte] = selectEstimatingGuides({ platform: "ccc" });
    expect(buildEstimatingGuideQuery(gte, "refinish  overlap")).toBe("site:help.cccis.com/webhelp/motor/gte refinish overlap");
    const [mitchell] = selectEstimatingGuides({ platform: "mitchell" });
    expect(buildEstimatingGuideQuery(mitchell, "R&I liner")).toBe("site:static.mymitchell.com/static/webhelp/ppages/ceg R&I liner");
  });
});

describe("a guide hit is labeled as general estimating guidance and sits at tier 2", () => {
  it("labels by the guide that served the page", () => {
    const mitchell = findEstimatingGuideForUrl(MITCHELL_PPAGES)!;
    const label = labelEstimatingGuideResult(mitchell, "Refinish — Overlap");
    expect(label.sourceTitle).toBe("Mitchell Collision Estimating Guide P-Pages (CEG) (general estimating guidance): Refinish — Overlap");
    expect(label.sourceType).toBe("industry");
    expect(label.confidenceScore).toBe(0.75);
  });

  it("the authority ladder places every web guide at tier 2, licensed estimating data", () => {
    for (const url of [MITCHELL_PPAGES, CCC_GTE, CCC_RAGTE]) {
      const result = classifyAuthority({ title: "Refinish — Overlap", url });
      expect(result).toHaveProperty("tier");
      if ("tier" in result) {
        expect(result.tier.tier).toBe(2);
        expect(result.tier.tierBasis).toMatch(/Licensed estimating data/);
      }
    }
  });

  it("reports a searched guide that yielded nothing as not confirmed, per guide", () => {
    const queries = [
      { query: "site:help.cccis.com/webhelp/motor/gte overlap" },
      { query: "site:static.mymitchell.com/static/webhelp/ppages/ceg overlap" },
    ];
    const findings = buildEstimatingGuideStatusFindings(queries, [{ url: CCC_GTE }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/^Mitchell Collision Estimating Guide P-Pages \(CEG\): not confirmed/);
    // The GTE wrapper keeps its own wording and adds the other guides.
    const wrapped = buildGteResearchStatusFindings(queries, []);
    expect(wrapped[0]).toMatch(/^CCC\/MOTOR GTE: Not confirmed/);
    expect(wrapped[1]).toMatch(/^Mitchell Collision Estimating Guide P-Pages \(CEG\): not confirmed/);
  });
});

describe("the chat prompts carry the library", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists every web guide by address with its platform rule", () => {
    vi.stubEnv("MOTOR_EBOOK_URL", "");
    const directive = buildEstimatingReferenceLibraryDirective();
    expect(directive).toContain(MITCHELL_PPAGES);
    expect(directive).toContain(CCC_GTE);
    expect(directive).toContain(CCC_RAGTE);
    expect(directive).not.toContain("vercel.com");
    expect(directive).toMatch(/Never answer a Mitchell included\/not-included question from the CCC\/MOTOR guide/);
    expect(directive).toMatch(/never an OEM repair procedure/);
  });

  it("adds the e-book only when its serving address is configured", () => {
    vi.stubEnv("MOTOR_EBOOK_URL", "https://motor-ebook.example.test/");
    expect(buildEstimatingReferenceLibraryDirective()).toContain("https://motor-ebook.example.test/");
  });
});
