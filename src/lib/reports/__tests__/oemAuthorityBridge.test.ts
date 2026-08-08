/**
 * THE ORPHANED-RETRIEVAL REGRESSION.
 *
 * Retrieval found the Tesla collision procedures, the Tesla scanning position
 * statement and 31 Pa. Code § 62.3 — and every one of them was reported in the
 * trace and then dropped, because the engine lived inside the OEM route and
 * nothing converted its `authoritySources` into the shape the finding-attach
 * pass consumes. These tests pin the conversion and the make gate that decides
 * what may attach, so the sources reach a finding or are refused for a stated
 * reason — never silently discarded.
 */
import { describe, it, expect } from "vitest";
import { mapAuthorityTraceToResolvedAuthorities } from "../oemAuthorityRetrieval";
import {
  attachResolvedAuthoritiesToFindings,
  type OemCitationDensityAuthorityTrace,
} from "../annotatedCitationDensityEstimate";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";

function trace(
  sources: OemCitationDensityAuthorityTrace["authoritySources"]
): OemCitationDensityAuthorityTrace {
  return {
    authorityTraceStarted: true,
    authorityTraceCompleted: true,
    authorityCoverageStatus: "partial",
    googleDriveOrInternalSearchRan: true,
    driveSearchAttempted: true,
    driveSearchAvailable: true,
    driveMakeModelFolderMatched: true,
    driveMatchedFolders: [],
    driveDocumentsReviewed: [],
    onlineSearchAttempted: false,
    onlineSourcesReviewed: [],
    jurisdictionResolved: null,
    jurisdictionSourcesReviewed: [],
    oemSourcesReviewed: [],
    adasSourcesReviewed: [],
    motorPPageSourcesReviewed: [],
    scrsSourcesReviewed: [],
    policyLegalSourcesReviewed: [],
    authoritySources: sources,
  };
}

function scanFinding(id = "required-detector-scan-1"): CitationDensityFinding {
  return {
    id,
    operationLabel: "Pre-repair scan",
    category: "scan_diagnostic",
    estimateGapType: "missing_from_carrier",
  } as CitationDensityFinding;
}

describe("retrieved authorities survive the trip to the findings", () => {
  it("returns nothing for a trace that never ran, rather than throwing", () => {
    expect(mapAuthorityTraceToResolvedAuthorities(null)).toEqual([]);
    expect(mapAuthorityTraceToResolvedAuthorities(undefined)).toEqual([]);
    expect(mapAuthorityTraceToResolvedAuthorities(trace([]))).toEqual([]);
  });

  it("carries url, locator and declared make across — not just the title", () => {
    const [mapped] = mapAuthorityTraceToResolvedAuthorities(
      trace([
        {
          title: "Scanning position statement",
          sourceType: "oem_position_statement",
          evidenceTier: 2,
          verified: false,
          url: "https://drive.google.com/file/d/abc123/view",
          locator: "p. 4",
          appliesToMake: "Tesla",
          researchSourceType: "oem",
        },
      ])
    );
    expect(mapped.sourceTitle).toBe("Scanning position statement");
    expect(mapped.url).toBe("https://drive.google.com/file/d/abc123/view");
    expect(mapped.locator).toBe("p. 4");
    expect(mapped.appliesToMake).toBe("Tesla");
    expect(mapped.sourceType).toBe("oem");
  });

  it("drops a source with no citable name — an unnamed authority is not support", () => {
    const mapped = mapAuthorityTraceToResolvedAuthorities(
      trace([
        { title: "  ", sourceType: "oem_procedure", evidenceTier: 1, verified: false },
        { title: "OK", sourceType: "oem_procedure", evidenceTier: 1, verified: false },
        { title: "Front bumper removal", sourceType: "oem_procedure", evidenceTier: 1, verified: false },
      ])
    );
    expect(mapped.map((source) => source.sourceTitle)).toEqual(["Front bumper removal"]);
  });

  it("ranks a tier-1 OEM procedure above a tier-7 internet fallback", () => {
    const [oem, web] = mapAuthorityTraceToResolvedAuthorities(
      trace([
        { title: "OEM collision procedure", sourceType: "oem_procedure", evidenceTier: 1, verified: false },
        { title: "Some blog post", sourceType: "internet_fallback", evidenceTier: 7, verified: false },
      ])
    );
    expect(oem.confidenceScore).toBe(1);
    expect(web.confidenceScore!).toBeLessThan(0.2);
  });
});

describe("the D-4 make gate honours a DECLARED applicability", () => {
  it("attaches a correctly-filed statement whose title never names the make", () => {
    // This is the case the old gate missed: the Drive file is filed under the
    // Tesla folder, but its title is just "Scanning position statement", so a
    // text test for "Tesla" failed and the retrieved statement was refused.
    const finding = scanFinding();
    const attached = attachResolvedAuthoritiesToFindings(
      [finding],
      mapAuthorityTraceToResolvedAuthorities(
        trace([
          {
            title: "Scanning position statement",
            sourceType: "oem_position_statement",
            evidenceTier: 2,
            verified: false,
            appliesToMake: "Tesla",
            researchSourceType: "oem",
          },
        ])
      ),
      { vehicleMake: "Tesla" }
    );
    expect(attached).toBe(1);
    expect(finding.bestAvailableAuthority?.title).toBe("Scanning position statement");
    expect(finding.retrievalStatus).toBe("retrieved");
  });

  it("REFUSES a statement declared for another make, however well its title matches", () => {
    const finding = scanFinding();
    const attached = attachResolvedAuthoritiesToFindings(
      [finding],
      mapAuthorityTraceToResolvedAuthorities(
        trace([
          {
            title: "Tesla scanning position statement",
            sourceType: "oem_position_statement",
            evidenceTier: 2,
            verified: false,
            // Declared applicability contradicts the title — the declaration wins.
            appliesToMake: "Rivian",
            researchSourceType: "oem",
          },
        ])
      ),
      { vehicleMake: "Tesla" }
    );
    expect(attached).toBe(0);
    expect(finding.bestAvailableAuthority).toBeUndefined();
    // Refusal is stated, not silent.
    expect((finding.limitations ?? []).join(" ")).toMatch(
      /No Tesla-specific authority found for this finding type/
    );
  });

  it("still falls back to the title text when nothing is declared", () => {
    const finding = scanFinding();
    const attached = attachResolvedAuthoritiesToFindings(
      [finding],
      mapAuthorityTraceToResolvedAuthorities(
        trace([
          {
            title: "Tesla scanning position statement",
            sourceType: "oem_position_statement",
            evidenceTier: 2,
            verified: false,
            researchSourceType: "oem",
          },
        ])
      ),
      { vehicleMake: "Tesla" }
    );
    expect(attached).toBe(1);
  });
});
