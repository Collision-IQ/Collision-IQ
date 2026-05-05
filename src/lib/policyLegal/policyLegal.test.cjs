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

const {
  buildPolicyLegalContext,
  buildPolicyLegalContextWithDbRegulations,
} = require("./context.ts");
const { buildPolicyLegalRegulationsDebugPayload } = require("./debugPayload.ts");
const {
  buildPolicyLegalRegulationsEndpointResult,
  clearPolicyLegalRegulationsCacheForTests,
  corruptPolicyLegalRegulationsCacheForTests,
} = require("./regulationsEndpoint.ts");
const {
  buildPolicyLegalSnapshotsEndpointResult,
} = require("./snapshotsEndpoint.ts");
const {
  buildPolicyLegalAccessLogData,
  buildPolicyLegalCitationSnapshotData,
  persistPolicyLegalCitationSnapshot,
} = require("./audit.ts");
const {
  getPolicyLegalMetricCount,
  observePolicyLegalReviewGenerated,
  resetPolicyLegalMetricsForTests,
} = require("./observability.ts");
const { buildPolicyLegalReviewIfEnabled } = require("./gate.ts");
const { buildPolicyLegalHealthPayload } = require("./health.ts");
const { buildPolicyLegalReview } = require("./review.ts");
const { resolveStateFromZip } = require("./stateFromZip.ts");
const {
  getApplicableRegulations,
  PLACEHOLDER_CITATION,
  regulationFromPrismaRecord,
} = require("./regulations.ts");
const {
  normalizeVerifiedRegulationSeedRecord,
} = require("./verifiedRegulationSeed.cjs");

const pendingTests = [];

function run(name, test) {
  const pending = Promise.resolve()
    .then(test)
    .then(() => {
      console.log(`PASS ${name}`);
    })
    .catch((error) => {
      console.error(`FAIL ${name}`);
      throw error;
    });

  pendingTests.push(pending);
}

function makeReport(overrides = {}) {
  return {
    summary: {
      riskScore: "moderate",
      confidence: "moderate",
      criticalIssues: 0,
      evidenceQuality: "weak",
    },
    issues: [],
    requiredProcedures: [],
    presentProcedures: [],
    missingProcedures: [],
    supplementOpportunities: [],
    evidence: [],
    recommendedActions: [],
    ...overrides,
  };
}

function makeOperation(overrides = {}) {
  return {
    operation: "Proc",
    component: "Pre-repair scan",
    rawLine: "Proc Pre-repair scan",
    ...overrides,
  };
}

run("valid ZIP resolves to state", () => {
  assert.equal(resolveStateFromZip("90210"), "CA");
  assert.equal(resolveStateFromZip("19103"), "PA");
  assert.equal(resolveStateFromZip("33101-1234"), "FL");
});

run("invalid or missing ZIP resolves to null", () => {
  assert.equal(resolveStateFromZip("not-a-zip"), null);
  assert.equal(resolveStateFromZip("00000"), null);
  assert.equal(resolveStateFromZip(null), null);
  assert.equal(resolveStateFromZip(undefined), null);
});

run("no verified regulation uses governing-regulation fallback", () => {
  const context = buildPolicyLegalContext({ zip: "19103" });
  const review = buildPolicyLegalReview({
    context,
    report: makeReport(),
    operations: [makeOperation()],
  });

  assert.equal(review.claim_context.claim_state, "PA");
  assert.equal(review.line_item_reviews[0].regulatory_support, "No");
  assert.equal(review.line_item_reviews[0].source_type, "None");
  assert.equal(review.line_item_reviews[0].citation, "No governing regulation found.");
});

run("TBD placeholder citation does not count as regulatory support", () => {
  const context = buildPolicyLegalContext({ state: "PA" });
  assert.ok(context.applicable_regulations.some((item) => item.citation === PLACEHOLDER_CITATION));

  const review = buildPolicyLegalReview({
    context,
    report: makeReport(),
    operations: [makeOperation()],
  });

  assert.equal(review.compliance_summary.regulation_supported_items, 0);
  assert.equal(review.regulatory_support_log[0].support, "placeholder");
  assert.equal(review.regulatory_support_log[0].citation, "No governing regulation found.");
});

run("each line item receives citation and source fallback", () => {
  const review = buildPolicyLegalReview({
    context: buildPolicyLegalContext({ state: "PA" }),
    report: makeReport(),
    operations: [
      makeOperation({ rawLine: "Proc Pre-repair scan" }),
      makeOperation({ component: "Bumper cover", rawLine: "R&I Bumper cover" }),
    ],
  });

  assert.equal(review.line_item_reviews.length, 2);
  for (const item of review.line_item_reviews) {
    assert.equal(item.citation, "No governing regulation found.");
    assert.equal(item.source_type, "None");
    assert.equal(item.incomplete, false);
  }
});

run("disputable item detection highlights strong OEM-supported issue", () => {
  const review = buildPolicyLegalReview({
    context: buildPolicyLegalContext({ state: "PA" }),
    report: makeReport({
      issues: [
        {
          id: "issue-1",
          category: "scan",
          title: "Pre-repair scan missing",
          finding: "Pre-repair scan function is not clearly represented.",
          impact: "Diagnostic discovery remains open.",
          missingOperation: "Pre-repair scan",
          severity: "high",
          evidenceIds: [],
        },
      ],
      requiredProcedures: [
        {
          procedure: "Pre-repair scan",
          reason: "Required procedure context supports scan documentation.",
          source: "oem_doc",
          severity: "high",
        },
      ],
    }),
    operations: [makeOperation()],
  });

  assert.equal(review.line_item_reviews[0].source_type, "OEM");
  assert.equal(review.line_item_reviews[0].dispute_strength, "High");
  assert.equal(review.disputable_items.length, 1);
});

run("PolicyLegalConfidenceScore calculation is deterministic", () => {
  const review = buildPolicyLegalReview({
    context: buildPolicyLegalContext({ state: "PA" }),
    report: makeReport({
      issues: [
        {
          id: "issue-1",
          category: "scan",
          title: "Pre-repair scan missing",
          finding: "Pre-repair scan function is not clearly represented.",
          impact: "Diagnostic discovery remains open.",
          missingOperation: "Pre-repair scan",
          severity: "high",
          evidenceIds: [],
        },
      ],
      requiredProcedures: [
        {
          procedure: "Pre-repair scan",
          reason: "Required procedure context supports scan documentation.",
          source: "oem_doc",
          severity: "high",
        },
      ],
    }),
    operations: [makeOperation()],
  });

  assert.deepEqual(review.final_score.components, {
    citation_completeness: 100,
    oem_compliance: 100,
    regulatory_compliance: 0,
    insurer_alignment: 0,
    dispute_strength: 100,
  });
  assert.equal(review.final_score.PolicyLegalConfidenceScore, 70);
});

run("legacy report compatibility handles missing policy/legal fields and arrays", () => {
  const review = buildPolicyLegalReview({
    context: buildPolicyLegalContext({ zip: null }),
    report: {},
    operations: [],
  });

  assert.equal(review.claim_context.claim_state, null);
  assert.deepEqual(review.line_item_reviews, []);
  assert.deepEqual(review.disputable_items, []);
  assert.equal(review.final_score.PolicyLegalConfidenceScore, 0);
});

run("Prisma camelCase Regulation record maps into review support", () => {
  const prismaRecord = {
    id: "pa-labor-procedures-verified",
    state: "pa",
    category: "labor_procedures",
    rule: "Verified labor procedure support record.",
    citation: "Verified PA labor procedure citation",
    sourceUrl: "https://example.test/pa-labor",
    sourceName: "Example Source",
    applicability: "Applies to labor procedure dispute support.",
    severity: "high",
    effectiveDate: new Date("2026-01-15T00:00:00.000Z"),
    retrievedAt: new Date("2026-02-01T00:00:00.000Z"),
    verifiedBy: "Policy Team",
    notes: "Test record",
  };
  const mapped = regulationFromPrismaRecord(prismaRecord);
  assert.equal(mapped.source_url, "https://example.test/pa-labor");
  assert.equal(mapped.source_name, "Example Source");
  assert.equal(mapped.effective_date, "2026-01-15T00:00:00.000Z");
  assert.equal(mapped.retrieved_at, "2026-02-01T00:00:00.000Z");
  assert.equal(mapped.verified_by, "Policy Team");
  assert.equal(mapped.notes, "Test record");
  assert.equal(mapped.verification_state, "verified");

  const context = {
    ...buildPolicyLegalContext({ state: "PA" }),
    applicable_regulations: getApplicableRegulations("PA", [prismaRecord]),
  };
  const review = buildPolicyLegalReview({
    context,
    report: makeReport(),
    operations: [makeOperation()],
  });

  assert.equal(review.claim_context.applicable_regulations[0].source_url, "https://example.test/pa-labor");
  assert.equal(review.claim_context.applicable_regulations[0].effective_date, "2026-01-15T00:00:00.000Z");
  assert.equal(review.line_item_reviews[0].regulatory_support, "Yes");
  assert.equal(review.line_item_reviews[0].source_type, "Regulation");
  assert.equal(review.line_item_reviews[0].citation, "Verified PA labor procedure citation");
});

run("empty Regulation table falls back to placeholder JSON dataset", () => {
  const applicable = getApplicableRegulations("PA", []);
  assert.ok(applicable.length > 0);
  assert.ok(applicable.every((record) => record.state === "PA"));
  assert.ok(applicable.every((record) => record.verification_state === "placeholder"));
});

run("valid verified regulation seed record is accepted", () => {
  const normalized = normalizeVerifiedRegulationSeedRecord({
    state: "pa",
    category: "labor_procedures",
    rule: "Verified labor rule.",
    citation: "Verified citation",
    sourceName: "Example Source",
    source_url: "https://example.test/source",
    retrieved_at: "2026-03-01T00:00:00.000Z",
    effective_date: "2026-02-01",
    verified_by: "Policy Team",
    notes: "Source reviewed.",
  });

  assert.equal(normalized.id, "pa-labor_procedures");
  assert.equal(normalized.state, "PA");
  assert.equal(normalized.sourceName, "Example Source");
  assert.equal(normalized.sourceUrl, "https://example.test/source");
  assert.ok(normalized.retrievedAt instanceof Date);
  assert.ok(normalized.effectiveDate instanceof Date);
  assert.equal(normalized.verifiedBy, "Policy Team");
  assert.equal(normalized.notes, "Source reviewed.");
});

run("verified regulation seed rejects TBD citation", () => {
  assert.throws(
    () =>
      normalizeVerifiedRegulationSeedRecord({
        state: "PA",
        category: "labor_procedures",
        rule: "Rule",
        citation: "TBD - requires official state source verification",
        sourceName: "Example Source",
        sourceUrl: "https://example.test/source",
        retrievedAt: "2026-03-01T00:00:00.000Z",
      }),
    /citation must not start with TBD/
  );
});

run("verified regulation seed rejects missing source URL", () => {
  assert.throws(
    () =>
      normalizeVerifiedRegulationSeedRecord({
        state: "PA",
        category: "labor_procedures",
        rule: "Rule",
        citation: "Verified citation",
        sourceName: "Example Source",
        retrievedAt: "2026-03-01T00:00:00.000Z",
      }),
    /requires sourceUrl or source_url/
  );
});

run("DB verified record overrides placeholder support", () => {
  const verified = normalizeVerifiedRegulationSeedRecord({
    id: "pa-labor-procedures-verified",
    state: "PA",
    category: "labor_procedures",
    rule: "Verified labor rule.",
    citation: "Verified citation",
    sourceName: "Example Source",
    sourceUrl: "https://example.test/source",
    retrievedAt: "2026-03-01T00:00:00.000Z",
  });
  const context = {
    ...buildPolicyLegalContext({ state: "PA" }),
    applicable_regulations: getApplicableRegulations("PA", [verified]),
  };
  const review = buildPolicyLegalReview({
    context,
    report: makeReport(),
    operations: [makeOperation()],
  });

  assert.equal(review.claim_context.applicable_regulations.length, 1);
  assert.equal(review.claim_context.applicable_regulations[0].verification_state, "verified");
  assert.equal(review.line_item_reviews[0].regulatory_support, "Yes");
  assert.equal(review.line_item_reviews[0].citation, "Verified citation");
});

run("verified DB regulation is used in review without manually supplying dbRecords", async () => {
  const verified = normalizeVerifiedRegulationSeedRecord({
    id: "fl-parts-verified-runtime",
    state: "FL",
    category: "parts_usage",
    rule: "Verified aftermarket parts disclosure rule.",
    citation: "Verified FL parts citation",
    sourceName: "Florida Source",
    sourceUrl: "https://example.test/fl-parts",
    retrievedAt: "2026-05-05T00:00:00.000Z",
    verifiedBy: "Policy Team",
    notes: "Runtime lookup test.",
  });
  const context = await buildPolicyLegalContextWithDbRegulations({
    state: "FL",
    findRegulations: async (state) => {
      assert.equal(state, "FL");
      return [verified];
    },
  });
  const review = buildPolicyLegalReview({
    context,
    report: makeReport(),
    operations: [makeOperation({ rawLine: "Line 5 Aftermarket front bumper cover" })],
  });

  assert.equal(context.applicable_regulations[0].id, "fl-parts-verified-runtime");
  assert.equal(review.line_item_reviews[0].source_type, "Regulation");
  assert.equal(review.line_item_reviews[0].regulatory_support, "Yes");
  assert.equal(review.line_item_reviews[0].citation, "Verified FL parts citation");
});

run("placeholder context is used only when no verified DB record exists", async () => {
  const context = await buildPolicyLegalContextWithDbRegulations({
    state: "FL",
    findRegulations: async () => [],
  });
  const review = buildPolicyLegalReview({
    context,
    report: makeReport(),
    operations: [makeOperation({ rawLine: "Line 5 Aftermarket front bumper cover" })],
  });

  assert.ok(context.applicable_regulations.length > 0);
  assert.ok(context.applicable_regulations.every((item) => item.verification_state === "placeholder"));
  assert.equal(review.line_item_reviews[0].source_type, "None");
  assert.equal(review.line_item_reviews[0].regulatory_support, "No");
  assert.equal(review.line_item_reviews[0].citation, "No governing regulation found.");
});

run("policy/legal context DB failure falls back safely", async () => {
  resetPolicyLegalMetricsForTests();
  const context = await buildPolicyLegalContextWithDbRegulations({
    state: "FL",
    findRegulations: async () => {
      throw new Error("simulated DB failure");
    },
  });
  const review = buildPolicyLegalReview({
    context,
    report: makeReport(),
    operations: [makeOperation({ rawLine: "Line 5 Aftermarket front bumper cover" })],
  });

  assert.ok(getPolicyLegalMetricCount("policy_legal_regulation_db_fallback") >= 1);
  assert.ok(context.applicable_regulations.every((item) => item.verification_state === "placeholder"));
  assert.equal(review.line_item_reviews[0].source_type, "None");
  assert.equal(review.line_item_reviews[0].regulatory_support, "No");
});

run("verified regulation seed rejects missing source metadata", () => {
  assert.throws(
    () =>
      normalizeVerifiedRegulationSeedRecord({
        state: "PA",
        category: "labor_procedures",
        rule: "Rule",
        citation: "Verified citation",
        sourceUrl: "https://example.test/source",
        retrievedAt: "2026-03-01T00:00:00.000Z",
      }),
    /missing required field: sourceName/
  );

  assert.throws(
    () =>
      normalizeVerifiedRegulationSeedRecord({
        state: "PA",
        category: "labor_procedures",
        rule: "Rule",
        citation: "Verified citation",
        sourceName: "Example Source",
        sourceUrl: "https://example.test/source",
      }),
    /requires retrievedAt or retrieved_at/
  );

  assert.throws(
    () =>
      normalizeVerifiedRegulationSeedRecord({
        state: "PA",
        category: "labor_procedures",
        rule: "Rule",
        citation: "Verified citation",
        sourceName: "Example Source",
        sourceUrl: "https://example.test/source",
        retrievedAt: "03/01/2026",
      }),
    /retrievedAt must be an ISO date/
  );
});

run("regulations debug payload returns verified before placeholders with counts", () => {
  const verified = normalizeVerifiedRegulationSeedRecord({
    id: "fl-labor_procedures",
    state: "FL",
    category: "labor_procedures",
    rule: "Verified labor rule.",
    citation: "Verified FL citation",
    sourceName: "Florida Source",
    sourceUrl: "https://example.test/fl",
    retrievedAt: "2026-03-01T00:00:00.000Z",
  });
  const payload = buildPolicyLegalRegulationsDebugPayload({
    state: "FL",
    dbRecords: [verified],
  });

  assert.equal(payload.state, "FL");
  assert.equal(payload.counts.verified, 1);
  assert.ok(payload.counts.placeholder > 0);
  assert.equal(payload.total, payload.counts.verified + payload.counts.placeholder);
  assert.equal(payload.records[0].verification_state, "verified");
  assert.equal(payload.records[0].source_metadata.sourceName, "Florida Source");
  assert.equal(payload.records[0].source_metadata.sourceUrl, "https://example.test/fl");
  assert.equal(payload.records[0].source_metadata.retrievedAt, "2026-03-01T00:00:00.000Z");
});

run("placeholder records never show regulatory support Yes", () => {
  const review = buildPolicyLegalReview({
    context: buildPolicyLegalContext({ state: "FL" }),
    report: makeReport(),
    operations: [makeOperation()],
  });

  assert.equal(review.line_item_reviews[0].regulatory_support, "No");
  assert.notEqual(review.line_item_reviews[0].regulatory_support, "Yes");
  assert.equal(review.line_item_reviews[0].citation, "No governing regulation found.");
});

run("regulations endpoint blocks unauthenticated requests", async () => {
  const result = await buildPolicyLegalRegulationsEndpointResult({
    state: "FL",
    currentUser: null,
    findRegulations: async () => [],
  });

  assert.equal(result.status, 401);
  assert.match(result.body.error, /Authentication is required/);
});

run("regulations endpoint blocks non-admin requests", async () => {
  const result = await buildPolicyLegalRegulationsEndpointResult({
    state: "FL",
    currentUser: { isPlatformAdmin: false },
    findRegulations: async () => [],
  });

  assert.equal(result.status, 403);
  assert.match(result.body.error, /Admin or internal access is required/);
});

run("regulations endpoint rejects invalid state", async () => {
  const result = await buildPolicyLegalRegulationsEndpointResult({
    state: "Florida",
    currentUser: { isPlatformAdmin: true },
    findRegulations: async () => [],
  });

  assert.equal(result.status, 400);
  assert.match(result.body.error, /state must be a 2-letter/);
});

run("regulations endpoint returns verified records before placeholders", async () => {
  clearPolicyLegalRegulationsCacheForTests();
  const verified = normalizeVerifiedRegulationSeedRecord({
    id: "fl-labor_procedures",
    state: "FL",
    category: "labor_procedures",
    rule: "Verified labor rule.",
    citation: "Verified FL citation",
    sourceName: "Florida Source",
    sourceUrl: "https://example.test/fl",
    retrievedAt: "2026-03-01T00:00:00.000Z",
  });
  const result = await buildPolicyLegalRegulationsEndpointResult({
    state: "fl",
    currentUser: { isPlatformAdmin: true },
    findRegulations: async () => [verified],
    bypassCache: true,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.records[0].verification_state, "verified");
  assert.equal(result.body.records[0].citation, "Verified FL citation");
  assert.equal(result.body.counts.verified, 1);
  assert.ok(result.body.counts.placeholder > 0);
});

run("regulations endpoint cache returns stable payload", async () => {
  clearPolicyLegalRegulationsCacheForTests();
  let calls = 0;
  const firstRecord = normalizeVerifiedRegulationSeedRecord({
    id: "fl-labor_procedures",
    state: "FL",
    category: "labor_procedures",
    rule: "First verified labor rule.",
    citation: "First verified citation",
    sourceName: "Florida Source",
    sourceUrl: "https://example.test/fl-first",
    retrievedAt: "2026-03-01T00:00:00.000Z",
  });
  const secondRecord = normalizeVerifiedRegulationSeedRecord({
    id: "fl-labor_procedures",
    state: "FL",
    category: "labor_procedures",
    rule: "Second verified labor rule.",
    citation: "Second verified citation",
    sourceName: "Florida Source",
    sourceUrl: "https://example.test/fl-second",
    retrievedAt: "2026-03-01T00:00:00.000Z",
  });
  const findRegulations = async () => {
    calls += 1;
    return calls === 1 ? [firstRecord] : [secondRecord];
  };

  const first = await buildPolicyLegalRegulationsEndpointResult({
    state: "FL",
    currentUser: { isPlatformAdmin: true },
    findRegulations,
    now: 1000,
  });
  const second = await buildPolicyLegalRegulationsEndpointResult({
    state: "FL",
    currentUser: { isPlatformAdmin: true },
    findRegulations,
    now: 2000,
  });

  assert.equal(first.cacheStatus, "miss");
  assert.equal(second.cacheStatus, "hit");
  assert.equal(calls, 1);
  assert.equal(first.body.records[0].citation, "First verified citation");
  assert.equal(second.body.records[0].citation, "First verified citation");
});

run("regulations endpoint access logs are created with counts and cache status", async () => {
  clearPolicyLegalRegulationsCacheForTests();
  const logs = [];
  const verified = normalizeVerifiedRegulationSeedRecord({
    id: "ga-labor_procedures",
    state: "GA",
    category: "labor_procedures",
    rule: "Verified labor rule.",
    citation: "Verified GA citation",
    sourceName: "Georgia Source",
    sourceUrl: "https://example.test/ga",
    retrievedAt: "2026-03-01T00:00:00.000Z",
  });

  const result = await buildPolicyLegalRegulationsEndpointResult({
    state: "GA",
    currentUser: { isPlatformAdmin: true },
    findRegulations: async () => [verified],
    bypassCache: true,
    logAccess: (entry) => {
      logs.push(
        buildPolicyLegalAccessLogData({
          userId: "user_admin",
          requestId: "req_123",
          ...entry,
        })
      );
    },
  });

  assert.equal(result.status, 200);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].userId, "user_admin");
  assert.equal(logs[0].requestId, "req_123");
  assert.equal(logs[0].state, "GA");
  assert.equal(logs[0].status, 200);
  assert.equal(logs[0].cacheStatus, "bypass");
  assert.equal(logs[0].verifiedCount, 1);
  assert.ok(logs[0].placeholderCount > 0);
  assert.equal(logs[0].totalCount, result.body.total);
});

run("review citation snapshot includes regulation and citation ids", () => {
  const verified = normalizeVerifiedRegulationSeedRecord({
    id: "pa-labor-procedure-source",
    state: "PA",
    category: "labor_procedures",
    rule: "Verified labor procedure support.",
    citation: "Verified PA labor citation",
    sourceName: "Pennsylvania Source",
    sourceUrl: "https://example.test/pa-labor",
    retrievedAt: "2026-03-01T00:00:00.000Z",
  });
  const context = {
    ...buildPolicyLegalContext({ state: "PA" }),
    applicable_regulations: getApplicableRegulations("PA", [verified]),
  };
  const review = buildPolicyLegalReview({
    context,
    report: makeReport(),
    operations: [makeOperation({ rawLine: "Labor procedure operation" })],
  });
  const snapshot = buildPolicyLegalCitationSnapshotData({
    caseId: "case_123",
    claimId: "claim_456",
    review,
    generatedAt: new Date("2026-05-05T12:00:00.000Z"),
  });

  assert.deepEqual(snapshot.regulationIdsUsed, ["pa-labor-procedure-source"]);
  assert.deepEqual(snapshot.regulationSourcesUsed, [
    {
      id: "pa-labor-procedure-source",
      citation: "Verified PA labor citation",
      sourceName: "Pennsylvania Source",
      sourceUrl: "https://example.test/pa-labor",
      retrievedAt: "2026-03-01T00:00:00.000Z",
      verifiedBy: null,
      notes: null,
    },
  ]);
  assert.deepEqual(snapshot.citationsUsed, ["Verified PA labor citation"]);
  assert.deepEqual(snapshot.oemSourcesUsed, []);
  assert.deepEqual(snapshot.carrierSourcesUsed, []);
  assert.equal(snapshot.caseId, "case_123");
  assert.equal(snapshot.claimId, "claim_456");
  assert.equal(snapshot.claimState, "PA");
  assert.equal(snapshot.policyLegalConfidenceScore, review.final_score.PolicyLegalConfidenceScore);
});

run("review snapshot marks placeholder citations without treating them as support", () => {
  const review = buildPolicyLegalReview({
    context: buildPolicyLegalContext({ state: "FL" }),
    report: makeReport(),
    operations: [makeOperation({ rawLine: "Labor procedure operation" })],
  });
  const snapshot = buildPolicyLegalCitationSnapshotData({
    caseId: "case_placeholder",
    review,
    generatedAt: new Date("2026-05-05T12:00:00.000Z"),
  });

  assert.equal(review.line_item_reviews[0].regulatory_support, "No");
  assert.equal(review.line_item_reviews[0].source_type, "None");
  assert.deepEqual(snapshot.regulationIdsUsed, []);
  assert.ok(snapshot.placeholderCitations.length > 0);
  assert.ok(
    snapshot.placeholderCitations.every(
      (entry) => entry.citation === "No governing regulation found."
    )
  );
});

run("repeated policy/legal review creates a new immutable snapshot payload", () => {
  const review = buildPolicyLegalReview({
    context: buildPolicyLegalContext({ state: "PA" }),
    report: makeReport(),
    operations: [makeOperation()],
  });
  const createdSnapshots = [];
  const createSnapshot = (generatedAt) => {
    const data = buildPolicyLegalCitationSnapshotData({
      caseId: "case_repeat",
      review,
      generatedAt,
    });
    createdSnapshots.push({
      id: `snapshot_${createdSnapshots.length + 1}`,
      ...data,
    });
  };

  createSnapshot(new Date("2026-05-05T12:00:00.000Z"));
  createSnapshot(new Date("2026-05-05T12:05:00.000Z"));

  assert.equal(createdSnapshots.length, 2);
  assert.notEqual(createdSnapshots[0].id, createdSnapshots[1].id);
  assert.notEqual(
    createdSnapshots[0].generatedAt.toISOString(),
    createdSnapshots[1].generatedAt.toISOString()
  );
  assert.deepEqual(createdSnapshots[0].citationsUsed, createdSnapshots[1].citationsUsed);
});

function makeSnapshotRecord(overrides = {}) {
  return {
    id: "snapshot_1",
    caseId: "case_1",
    claimId: "claim_1",
    claimState: "PA",
    regulationIdsUsed: ["pa-labor-procedure-source"],
    citationsUsed: ["Verified PA labor citation"],
    oemSourcesUsed: ["OEM procedure support: Pre-repair scan"],
    carrierSourcesUsed: ["Insurer guideline: scan documentation"],
    placeholderCitations: [],
    policyLegalConfidenceScore: 70,
    generatedAt: new Date("2026-05-05T12:00:00.000Z"),
    ...overrides,
  };
}

run("snapshots endpoint blocks unauthenticated requests", async () => {
  const result = await buildPolicyLegalSnapshotsEndpointResult({
    caseId: "case_1",
    claimId: null,
    currentUser: null,
    findSnapshots: async () => [],
  });

  assert.equal(result.status, 401);
  assert.match(result.body.error, /Authentication is required/);
});

run("snapshots endpoint blocks non-admin requests", async () => {
  const result = await buildPolicyLegalSnapshotsEndpointResult({
    caseId: "case_1",
    claimId: null,
    currentUser: { isPlatformAdmin: false },
    findSnapshots: async () => [],
  });

  assert.equal(result.status, 403);
  assert.match(result.body.error, /Admin or internal access is required/);
});

run("snapshots endpoint returns newest snapshots first", async () => {
  const result = await buildPolicyLegalSnapshotsEndpointResult({
    caseId: "case_1",
    claimId: null,
    currentUser: { isPlatformAdmin: true },
    findSnapshots: async () => [
      makeSnapshotRecord({
        id: "snapshot_old",
        generatedAt: new Date("2026-05-05T12:00:00.000Z"),
      }),
      makeSnapshotRecord({
        id: "snapshot_new",
        generatedAt: new Date("2026-05-05T12:05:00.000Z"),
      }),
    ],
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.snapshots[0].snapshot_id, "snapshot_new");
  assert.equal(result.body.snapshots[1].snapshot_id, "snapshot_old");
  assert.equal(result.body.snapshots[0].claim_state, "PA");
  assert.equal(result.body.snapshots[0].PolicyLegalConfidenceScore, 70);
});

run("snapshots endpoint shows repeated reviews as distinct snapshots", async () => {
  const result = await buildPolicyLegalSnapshotsEndpointResult({
    caseId: "case_repeat",
    claimId: null,
    currentUser: { isPlatformAdmin: true },
    findSnapshots: async () => [
      makeSnapshotRecord({
        id: "snapshot_1",
        caseId: "case_repeat",
        generatedAt: new Date("2026-05-05T12:00:00.000Z"),
      }),
      makeSnapshotRecord({
        id: "snapshot_2",
        caseId: "case_repeat",
        generatedAt: new Date("2026-05-05T12:05:00.000Z"),
      }),
    ],
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.total, 2);
  assert.deepEqual(
    result.body.snapshots.map((snapshot) => snapshot.snapshot_id),
    ["snapshot_2", "snapshot_1"]
  );
});

run("snapshots endpoint marks placeholders without regulatory support", async () => {
  const result = await buildPolicyLegalSnapshotsEndpointResult({
    caseId: "case_placeholder",
    claimId: null,
    currentUser: { isPlatformAdmin: true },
    findSnapshots: async () => [
      makeSnapshotRecord({
        id: "snapshot_placeholder",
        caseId: "case_placeholder",
        regulationIdsUsed: [],
        placeholderCitations: [
          {
            category: "labor_procedures",
            citation: "No governing regulation found.",
            note: "No verified governing regulation is available in the MVP dataset.",
          },
        ],
      }),
    ],
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.snapshots[0].regulation_ids_used, []);
  assert.equal(result.body.snapshots[0].placeholder_citations[0].verification_state, "placeholder");
  assert.equal(result.body.snapshots[0].placeholder_citations[0].regulatory_support, "No");
  assert.equal(
    result.body.snapshots[0].placeholder_citations[0].citation,
    "No governing regulation found."
  );
});

run("missing citation increments metric and logs enforcement failure without line details", () => {
  resetPolicyLegalMetricsForTests();
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    observePolicyLegalReviewGenerated({
      claim_context: {
        claim_state: "PA",
        applicable_regulations: [],
        oem_procedures: [],
        carrier_guidelines: [],
        policy_context: {},
        citation_required: true,
      },
      compliance_summary: {
        total_line_items: 1,
        complete_citations: 0,
        incomplete_items: 1,
        oem_supported_items: 0,
        regulation_supported_items: 0,
        insurer_aligned_items: 0,
        unsupported_legal_claims_blocked: 1,
        disclaimer: "This is not legal advice.",
      },
      line_item_reviews: [],
      disputable_items: [],
      regulatory_support_log: [],
      citation_log: [
        {
          line_item: "Customer name and address should not appear in logs",
          citation: "",
          source_type: "None",
          complete: false,
        },
      ],
      missing_support: [],
      final_score: {
        PolicyLegalConfidenceScore: 0,
        components: {
          citation_completeness: 0,
          oem_compliance: 0,
          regulatory_compliance: 0,
          insurer_alignment: 0,
          dispute_strength: 0,
        },
      },
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(getPolicyLegalMetricCount("policy_legal_missing_citation"), 1);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].event, "citation_enforcement_failure");
  assert.equal(warnings[0][1].missingCitationCount, 1);
  assert.equal(JSON.stringify(warnings[0]).includes("Customer name and address"), false);
});

run("placeholder usage is counted", () => {
  resetPolicyLegalMetricsForTests();
  buildPolicyLegalReview({
    context: buildPolicyLegalContext({ state: "FL" }),
    report: makeReport(),
    operations: [makeOperation({ rawLine: "Labor procedure operation" })],
  });

  assert.ok(getPolicyLegalMetricCount("policy_legal_placeholder_used") > 0);
  assert.equal(getPolicyLegalMetricCount("policy_legal_verified_regulation_used"), 0);
});

run("verified regulation usage is counted", () => {
  resetPolicyLegalMetricsForTests();
  const verified = normalizeVerifiedRegulationSeedRecord({
    id: "pa-labor-procedure-observability",
    state: "PA",
    category: "labor_procedures",
    rule: "Verified labor procedure support.",
    citation: "Verified PA labor observability citation",
    sourceName: "Pennsylvania Source",
    sourceUrl: "https://example.test/pa-labor-observability",
    retrievedAt: "2026-03-01T00:00:00.000Z",
  });
  const context = {
    ...buildPolicyLegalContext({ state: "PA" }),
    applicable_regulations: getApplicableRegulations("PA", [verified]),
  };

  buildPolicyLegalReview({
    context,
    report: makeReport(),
    operations: [makeOperation({ rawLine: "Labor procedure operation" })],
  });

  assert.equal(getPolicyLegalMetricCount("policy_legal_verified_regulation_used"), 1);
});

run("feature disabled skips policy/legal review", () => {
  const review = buildPolicyLegalReviewIfEnabled({
    context: buildPolicyLegalContext({ state: "PA" }),
    report: makeReport(),
    operations: [makeOperation()],
    env: { POLICY_LEGAL_INTELLIGENCE_ENABLED: "false" },
  });

  assert.equal(review, undefined);
});

run("regulation DB lookup failure falls back safely to placeholders", async () => {
  resetPolicyLegalMetricsForTests();
  clearPolicyLegalRegulationsCacheForTests();

  const result = await buildPolicyLegalRegulationsEndpointResult({
    state: "PA",
    currentUser: { isPlatformAdmin: true },
    findRegulations: async () => {
      throw new Error("database unavailable");
    },
    bypassCache: true,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.counts.verified, 0);
  assert.ok(result.body.counts.placeholder > 0);
  assert.ok(result.body.records.every((record) => record.verification_state === "placeholder"));
  assert.ok(getPolicyLegalMetricCount("policy_legal_regulation_db_fallback") >= 1);
});

run("health endpoint payload returns expected readiness fields", async () => {
  const payload = await buildPolicyLegalHealthPayload({
    env: { POLICY_LEGAL_INTELLIGENCE_ENABLED: "true" },
    countVerifiedRegulations: async () => 3,
    findLastSnapshot: async () => ({
      generatedAt: new Date("2026-05-05T12:00:00.000Z"),
    }),
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    "enabled",
    "last_snapshot_timestamp",
    "placeholder_dataset_available",
    "regulation_table_reachable",
    "verified_regulation_count",
  ]);
  assert.equal(payload.enabled, true);
  assert.equal(payload.regulation_table_reachable, true);
  assert.equal(payload.placeholder_dataset_available, true);
  assert.equal(payload.verified_regulation_count, 3);
  assert.equal(payload.last_snapshot_timestamp, "2026-05-05T12:00:00.000Z");
});

run("fallback placeholders do not fabricate regulatory support", async () => {
  clearPolicyLegalRegulationsCacheForTests();
  const result = await buildPolicyLegalRegulationsEndpointResult({
    state: "FL",
    currentUser: { isPlatformAdmin: true },
    findRegulations: async () => {
      throw new Error("database unavailable");
    },
    bypassCache: true,
  });
  const context = {
    ...buildPolicyLegalContext({ state: "FL" }),
    applicable_regulations: result.body.records,
  };
  const review = buildPolicyLegalReview({
    context,
    report: makeReport(),
    operations: [makeOperation({ rawLine: "Labor procedure operation" })],
  });

  assert.equal(review.line_item_reviews[0].regulatory_support, "No");
  assert.equal(review.line_item_reviews[0].source_type, "None");
  assert.equal(review.line_item_reviews[0].citation, "No governing regulation found.");
  assert.equal(review.compliance_summary.regulation_supported_items, 0);
});

run("regulation DB outage falls back and does not create regulatory support", async () => {
  resetPolicyLegalMetricsForTests();
  clearPolicyLegalRegulationsCacheForTests();
  const result = await buildPolicyLegalRegulationsEndpointResult({
    state: "PA",
    currentUser: { isPlatformAdmin: true },
    findRegulations: async () => {
      throw new Error("simulated Prisma outage");
    },
    bypassCache: true,
  });
  const review = buildPolicyLegalReview({
    context: {
      ...buildPolicyLegalContext({ state: "PA" }),
      applicable_regulations: result.body.records,
    },
    report: makeReport(),
    operations: [makeOperation({ rawLine: "Labor procedure operation" })],
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.counts.verified, 0);
  assert.ok(result.body.counts.placeholder > 0);
  assert.ok(getPolicyLegalMetricCount("policy_legal_regulation_db_fallback") >= 1);
  assert.equal(review.line_item_reviews[0].regulatory_support, "No");
  assert.equal(review.compliance_summary.regulation_supported_items, 0);
});

run("malformed regulation record is ignored and review remains valid", () => {
  const malformedRecords = [
    {
      id: "pa-malformed",
      state: null,
      category: "labor_procedures",
      rule: "Malformed rule",
      citation: "Malformed citation",
      sourceUrl: "https://example.test/malformed",
      sourceName: "Bad Source",
      applicability: null,
      severity: "high",
      effectiveDate: null,
      retrievedAt: null,
      verifiedBy: null,
      notes: null,
    },
  ];
  const applicable = getApplicableRegulations("PA", malformedRecords);
  const review = buildPolicyLegalReview({
    context: {
      ...buildPolicyLegalContext({ state: "PA" }),
      applicable_regulations: applicable,
    },
    report: makeReport(),
    operations: [makeOperation({ rawLine: "Labor procedure operation" })],
  });

  assert.deepEqual(applicable, []);
  assert.equal(review.claim_context.claim_state, "PA");
  assert.equal(review.line_item_reviews[0].citation, "No governing regulation found.");
  assert.equal(review.line_item_reviews[0].regulatory_support, "No");
});

run("snapshot write failure logs metric and does not throw", async () => {
  resetPolicyLegalMetricsForTests();
  const review = buildPolicyLegalReview({
    context: buildPolicyLegalContext({ state: "PA" }),
    report: makeReport(),
    operations: [makeOperation()],
  });
  const snapshotData = buildPolicyLegalCitationSnapshotData({
    caseId: "case_snapshot_failure",
    review,
    generatedAt: new Date("2026-05-05T12:00:00.000Z"),
  });
  const result = await persistPolicyLegalCitationSnapshot({
    data: snapshotData,
    createSnapshot: async () => {
      throw new Error("snapshot write failed");
    },
  });

  assert.equal(result.created, false);
  assert.equal(getPolicyLegalMetricCount("policy_legal_snapshot_create_failed"), 1);
});

run("corrupted regulation cache is rebuilt safely", async () => {
  clearPolicyLegalRegulationsCacheForTests();
  corruptPolicyLegalRegulationsCacheForTests("TX", {
    expiresAt: 999999,
    payload: {
      total: "bad",
      records: "bad",
      counts: null,
    },
  });
  let calls = 0;
  const result = await buildPolicyLegalRegulationsEndpointResult({
    state: "TX",
    currentUser: { isPlatformAdmin: true },
    findRegulations: async () => {
      calls += 1;
      return [];
    },
    now: 1000,
  });

  assert.equal(result.status, 200);
  assert.equal(result.cacheStatus, "miss");
  assert.equal(calls, 1);
  assert.ok(result.body.records.every((record) => record.verification_state === "placeholder"));
});

run("feature flag toggle mid-run does not leak partial review objects", () => {
  const context = buildPolicyLegalContext({ state: "PA" });
  const enabled = buildPolicyLegalReviewIfEnabled({
    context,
    report: makeReport(),
    operations: [makeOperation()],
    env: { POLICY_LEGAL_INTELLIGENCE_ENABLED: "true" },
  });
  const disabled = buildPolicyLegalReviewIfEnabled({
    context,
    report: makeReport(),
    operations: [makeOperation()],
    env: { POLICY_LEGAL_INTELLIGENCE_ENABLED: "false" },
  });

  assert.ok(enabled);
  assert.equal(disabled, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call({ policyLegalReview: disabled }, "claim_context"), false);
});

run("high-volume lightweight review generation has isolated outputs", () => {
  resetPolicyLegalMetricsForTests();
  const reviews = Array.from({ length: 25 }, (_, index) =>
    buildPolicyLegalReview({
      context: buildPolicyLegalContext({ state: index % 2 === 0 ? "PA" : "FL" }),
      report: makeReport(),
      operations: [makeOperation({ rawLine: `Labor procedure operation ${index}` })],
    })
  );
  const lineItems = new Set(
    reviews.map((review) => review.line_item_reviews[0]?.line_item)
  );

  assert.equal(reviews.length, 25);
  assert.equal(lineItems.size, 25);
  assert.equal(getPolicyLegalMetricCount("policy_legal_review_generated"), 25);
  assert.ok(reviews.every((review) => review.final_score.PolicyLegalConfidenceScore >= 0));
});

Promise.all(pendingTests).catch(() => {
  process.exitCode = 1;
});
