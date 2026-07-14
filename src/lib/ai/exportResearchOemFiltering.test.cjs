/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilenameWithAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const absolute = path.join(process.cwd(), "src", request.slice(2));
    return originalResolveFilename.call(this, absolute, parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function registerTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: filename,
  });

  module._compile(compiled.outputText, filename);
};

const { __exportResearchTestHooks } = require("./exportResearch.ts");
const { buildExportResearchSections } = require("./builders/exportResearchSections.ts");
const { resolveVehicleApplicabilityContext } = require("./vehicleApplicability.ts");

function run(name, test) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function buildSource(id, title, supportCategory = "Verified OEM / Position Statement Support") {
  return {
    id,
    sourceType: "oem",
    sourceTitle: title,
    url: `https://example.test/${id}`,
    locator: title,
    retrievalTimestamp: "2026-05-19T00:00:00.000Z",
    confidenceScore: 0.86,
    supportCategory,
    agent: "OEM Procedure Agent",
    accepted: true,
  };
}

function buildSnapshot(sourcesAccepted, verificationSummary) {
  return {
    id: "research-oem-filtering",
    reportType: "repair_intelligence",
    generatedAt: "2026-05-19T00:00:00.000Z",
    retrievalTimestamp: "2026-05-19T00:00:00.000Z",
    immutableSnapshotHash: "hash",
    agentsRun: ["OEM Procedure Agent"],
    searchQueriesUsed: [],
    sourcesReviewed: [],
    sourcesAccepted,
    sourcesRejected: [],
    unsupportedFindings: [],
    citationMap: [],
    verificationSummary,
  };
}

run("Tesla report does not render Honda/Acura under verified OEM", () => {
  const tesla = resolveVehicleApplicabilityContext({ year: 2020, make: "Tesla", model: "Model 3" });
  const verified = __exportResearchTestHooks.verifyResearchSources([
    buildSource("honda-oem", "Honda Acura position statement on bumper repair"),
    buildSource("tesla-oem", "Tesla collision repair position statement Model 3"),
  ], undefined, tesla);
  const sections = buildExportResearchSections(buildSnapshot(verified.accepted, verified.summary));
  const verifiedOem = sections.find((section) => section.title === "Verified OEM / Position Statement Support");

  assert.ok(verifiedOem);
  assert.match(JSON.stringify(verifiedOem), /Tesla collision repair position statement/);
  assert.doesNotMatch(JSON.stringify(verifiedOem), /Honda|Acura/i);
});

run("Tesla report allows Tesla under verified OEM", () => {
  const tesla = resolveVehicleApplicabilityContext({ year: 2020, make: "Tesla", model: "Model 3" });
  assert.equal(
    __exportResearchTestHooks.mapSupportCategory("oem", "Tesla collision repair position statement", {
      sourceText: "Tesla collision repair position statement Model 3 structural repair",
      vehicleContext: tesla,
    }),
    "Verified OEM / Position Statement Support"
  );
});

run("Chrysler report allows Mopar/Stellantis/FCA under verified OEM", () => {
  const chrysler = resolveVehicleApplicabilityContext({ year: 2024, make: "Chrysler", model: "Grand Wagoneer" });
  for (const title of [
    "Mopar position statement on pre- and post-repair scanning",
    "Stellantis collision repair position statement",
    "FCA position statement structural repair procedures",
  ]) {
    assert.equal(
      __exportResearchTestHooks.mapSupportCategory("oem", title, {
        sourceText: title,
        vehicleContext: chrysler,
      }),
      "Verified OEM / Position Statement Support"
    );
  }
});

run("Chrysler report does not allow Hyundai/GM/Honda under verified OEM", () => {
  const chrysler = resolveVehicleApplicabilityContext({ year: 2024, make: "Chrysler", model: "Grand Wagoneer" });
  for (const title of [
    "Hyundai collision repair position statement",
    "GM repair procedures position statement",
    "Honda Acura bumper repair position statement",
  ]) {
    assert.equal(
      __exportResearchTestHooks.mapSupportCategory("oem", title, {
        sourceText: title,
        vehicleContext: chrysler,
      }),
      "Unsupported / Needs Review"
    );
  }
});

run("Mercedes report rejects Nissan/GM position statements outright (RO21888)", () => {
  const mercedes = resolveVehicleApplicabilityContext({ year: 2025, make: "Mercedes-Benz", model: "GLE 350" });
  const verified = __exportResearchTestHooks.verifyResearchSources(
    [
      buildSource("nissan-oem", "Nissan/INFINITI Position Statements"),
      buildSource("gm-oem", "GM Parts collision position statements", "General Research Leads - Not Make-Specific"),
      buildSource("mb-oem", "Mercedes-Benz GLE structural repair position statement"),
    ],
    undefined,
    mercedes
  );
  assert.ok(
    verified.accepted.some(
      (source) =>
        /Mercedes/.test(source.sourceTitle) &&
        source.supportCategory === "Verified OEM / Position Statement Support"
    )
  );
  assert.ok(!verified.accepted.some((source) => /Nissan|GM Parts/.test(source.sourceTitle)));
  assert.equal(verified.summary.wrongMakeOemLeadsRejected, 2);
});

run("off-topic federal law leads are rejected (FAR class deviation, EPA lead-and-copper)", () => {
  const lawSource = (id, title) => ({
    ...buildSource(id, title),
    sourceType: "law",
    supportCategory: "Verified Law",
    jurisdiction: "Pennsylvania",
    confidenceScore: 0.9,
  });
  const verified = __exportResearchTestHooks.verifyResearchSources(
    [
      lawSource("far-law", "Class Deviation RFO-: FAR federal acquisition regulation update"),
      lawSource("epa-law", "Lead and Copper Rule | Department of Environmental Protection drinking water"),
      lawSource("doi-law", "Pennsylvania DOI motor vehicle physical damage appraisal regulation"),
    ],
    "PA"
  );
  const rejectedTitles = verified.rejected.map((source) => source.sourceTitle).join(" ");
  assert.match(rejectedTitles, /FAR federal acquisition/);
  assert.match(rejectedTitles, /Lead and Copper/);
  assert.equal(verified.summary.offTopicLawLeadsRejected, 2);
  assert.ok(verified.accepted.some((source) => /Pennsylvania DOI/.test(source.sourceTitle)));
});

run("no accepted OEM source renders an honest none-found line, never a wrong make", () => {
  const sections = buildExportResearchSections(
    buildSnapshot([], {
      uncitedLegalClaimsRejected: 0,
      fabricatedStatutesRejected: 0,
      staleOrSupersededRegulationsRejected: 0,
      unsupportedOemRequirementsRejected: 0,
      inferredPolicyRightsDowngraded: 0,
    })
  );
  const oemSection = sections.find((section) => section.title === "Verified OEM / Position Statement Support");
  assert.ok(oemSection);
  assert.match(JSON.stringify(oemSection), /No verified make-specific OEM position statement/);
});

run("rejected sources never render outside the internal audit view", () => {
  const rejectedSource = {
    ...buildSource("rejected-oem", "GM Parts position statements", "Unsupported / Needs Review"),
    accepted: false,
  };
  const snapshot = buildSnapshot([rejectedSource], {
    uncitedLegalClaimsRejected: 0,
    fabricatedStatutesRejected: 0,
    staleOrSupersededRegulationsRejected: 0,
    unsupportedOemRequirementsRejected: 0,
    inferredPolicyRightsDowngraded: 0,
  });
  const customerSections = buildExportResearchSections(snapshot);
  assert.ok(!customerSections.some((section) => section.title === "Unsupported / Needs Review"));
});

run("generic estimating or industry sources render only under research leads", () => {
  const sections = buildExportResearchSections(buildSnapshot([
    buildSource(
      "generic-oem",
      "I-CAR generic OEM repair information guidance",
      "General Research Leads - Not Make-Specific"
    ),
  ], {
    uncitedLegalClaimsRejected: 0,
    fabricatedStatutesRejected: 0,
    staleOrSupersededRegulationsRejected: 0,
    unsupportedOemRequirementsRejected: 0,
    inferredPolicyRightsDowngraded: 0,
  }));
  const verifiedOem = sections.find((section) => section.title === "Verified OEM / Position Statement Support");
  const generalLeads = sections.find((section) => section.title === "General Research Leads — Not Make-Specific");

  assert.ok(generalLeads);
  assert.match(JSON.stringify(generalLeads), /I-CAR generic OEM repair information guidance/);
  assert.ok(!verifiedOem);
});
