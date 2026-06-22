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
  buildRebuttalEmailPdf,
} = require("./builders/rebuttalEmailPdfBuilder.ts");
const {
  buildDisputeIntelligencePdf,
} = require("./builders/disputeIntelligencePdfBuilder.ts");
const {
  buildAnnotatedEstimateReviewPdf,
  buildAnnotatedEstimateReviewModel,
  buildEstimatorChangeRequestListPdf,
  buildEstimateScrubberPdf,
} = require("./builders/estimateScrubberPdfBuilder.ts");
const {
  buildDoiComplaintPacketPdf,
} = require("./builders/doiComplaintPacketPdfBuilder.ts");
const {
  buildPolicyRightsReviewPdf,
} = require("./builders/policyRightsReviewPdfBuilder.ts");
const {
  buildCollisionSnapshot,
} = require("./builders/collisionSnapshot.ts");
const {
  buildExportResearchSections,
} = require("./builders/exportResearchSections.ts");
const {
  sanitizeReportText,
} = require("./builders/exportPdf.ts");

const TEST_VIN = "1GKKNRLS7MZ123456";
const APPRAISAL_PROCESS_CHAT_CONTEXT = [
  "User-Provided Chat Context",
  "Insurance carrier has denied Right to Appraisal clauses in the past, citing repairs are complete. They force the shop to inform the vehicle owner of the dispute and their options after the first teardown. When an appraisal clause is invoked, the insurance then sends an independent appraiser to inspect and generate an estimate. The vehicle owner's appraiser does the same. It has historically been agreed that once inspections are completed and confirmed, the shop continues repairs and the award letter is signed at the end, once all documents are available for review. On this claim, the IA company is telling the owner’s IA that the insurance is demanding an award letter be signed after supplement 1, before the shop can continue and complete repairs. The owner’s IA has not agreed to those terms and has obtained legal team involvement.",
].join("\n\n");

const REPORT = {
  summary: {
    riskScore: "moderate",
    confidence: "moderate",
    criticalIssues: 1,
    evidenceQuality: "moderate",
  },
  vehicle: {
    vin: TEST_VIN,
    year: 2021,
    make: "GMC",
    model: "Acadia",
    trim: "SLT AWD",
    source: "attachment",
    confidence: 0.92,
  },
  issues: [
    {
      id: "issue-1",
      category: "documentation",
      title: "Pre-Repair Scan",
      finding: "Pre-Repair Scan",
      impact: "Pre-scan support is not clearly represented in the estimate.",
      missingOperation: "Pre-Repair Scan",
      severity: "medium",
      evidenceIds: [],
    },
  ],
  requiredProcedures: [],
  presentProcedures: [],
  missingProcedures: ["Pre-Repair Scan"],
  supplementOpportunities: ["Add and document Four-Wheel Alignment."],
  evidence: [
    {
      id: "evidence-1",
      title: "Estimate excerpt",
      snippet: "2021 GMC Acadia VIN 1GKKNRLS7MZ123456. Pre-scan not shown. Alignment not documented.",
      source: "shop estimate",
      authority: "inferred",
    },
  ],
  recommendedActions: [
    "The current estimate underwrites scan and alignment support that should be carried clearly.",
  ],
  analysis: undefined,
};

const ANALYSIS = {
  mode: "comparison",
  parserStatus: "ok",
  summary: {
    riskScore: "moderate",
    confidence: "moderate",
    criticalIssues: 1,
    evidenceQuality: "moderate",
  },
  findings: [],
  supplements: [],
  evidence: [
    {
      source: "shop estimate",
      quote: "Pre-scan not shown and alignment support remains open.",
    },
  ],
  operations: [
    {
      operation: "Pre-Repair Scan",
      component: "Front bumper and ADAS",
      rawLine: "Proc Pre-Repair Scan",
    },
    {
      operation: "Four-Wheel Alignment",
      component: "Suspension",
      rawLine: "Algn Four-Wheel Alignment",
    },
  ],
  rawEstimateText: "Proc Pre-Repair Scan\nAlgn Four-Wheel Alignment",
  narrative: "The carrier posture underwrites scan and alignment support relative to the repair path.",
  vehicle: REPORT.vehicle,
};

function run(name, test) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("rebuttal PDF renders expected sections", () => {
  const document = buildRebuttalEmailPdf({
    report: REPORT,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(document.header.title, "Carrier Rebuttal Email");
  assert.ok(document.sections.some((section) => section.title === "Recommended Subject"));
  assert.ok(document.sections.some((section) => section.title === "Editable Email Body"));
  assert.ok(document.summary.some((item) => item.label === "VIN" && item.value === TEST_VIN));
});

run("legacy dispute PDF builder renders unified Repair Intelligence report", () => {
  const document = buildDisputeIntelligencePdf({
    report: REPORT,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(document.header.title, "Repair Intelligence Report");
  assert.ok(document.sections.some((section) => section.title === "Executive Repair Position"));
  assert.ok(document.sections.some((section) => section.title === "Evidence Reviewed"));
  assert.ok(document.sections.some((section) => section.title === "Estimate Comparison"));
  assert.ok(document.sections.some((section) => section.title === "Open Verification Items"));
  assert.ok(document.sections.some((section) => section.title === "Negotiation/Appraisal Posture"));
  assert.ok(document.sections.some((section) => section.title === "File Review Diagnostics"));
  assert.ok(document.sections.some((section) => section.title === "Limits / Disclaimer"));
  assert.ok(
    document.sections.some((section) =>
      section.title === "Supported Findings"
    )
  );
  assert.ok(
    document.sections.some((section) =>
      (section.bullets ?? []).some((bullet) => /Recommended next action|current gap|support posture/i.test(bullet))
    )
  );
  const exportedText = JSON.stringify(document);
  assert.doesNotMatch(exportedText, /\| status |\| evidence |\| Support:/i);
  assert.doesNotMatch(exportedText, /MISSING_CRITICAL_EVIDENCE|Carrier\. vulnerabilities|Shop\. vulnerabilities/);
  assert.doesNotMatch(exportedText, /\d+ indexed items? (?:was|were) excluded/i);
});

run("Repair Intelligence research sections suppress placeholder source-link references", () => {
  const sections = buildExportResearchSections({
    id: "research-1",
    reportType: "repair_intelligence",
    generatedAt: "2026-05-19T00:00:00.000Z",
    retrievalTimestamp: "2026-05-19T00:00:00.000Z",
    immutableSnapshotHash: "hash",
    agentsRun: ["OEM Procedure Agent"],
    searchQueriesUsed: [],
    sourcesReviewed: [],
    sourcesRejected: [],
    unsupportedFindings: [],
    citationMap: [],
    verificationSummary: {
      uncitedLegalClaimsRejected: 0,
      fabricatedStatutesRejected: 0,
      staleOrSupersededRegulationsRejected: 0,
      unsupportedOemRequirementsRejected: 0,
      inferredPolicyRightsDowngraded: 0,
    },
    sourcesAccepted: [
      {
        id: "source-1",
        sourceType: "web",
        sourceTitle: "OEM calibration bulletin",
        url: "source link",
        locator: "source link",
        retrievalTimestamp: "2026-05-19T00:00:00.000Z",
        confidenceScore: 0.8,
        supportCategory: "Verified OEM / Position Statement Support",
        agent: "OEM Procedure Agent",
        accepted: true,
      },
    ],
  });
  const text = JSON.stringify(sections);

  assert.match(text, /OEM calibration bulletin/);
  assert.doesNotMatch(text, /Reference: source link|Not clearly Not clearly/);
});

run("Repair Intelligence research sections keep non-jurisdiction law leads out of Verified Law", () => {
  const sections = buildExportResearchSections({
    id: "research-law-jurisdiction",
    reportType: "repair_intelligence",
    generatedAt: "2026-05-19T00:00:00.000Z",
    retrievalTimestamp: "2026-05-19T00:00:00.000Z",
    immutableSnapshotHash: "hash",
    agentsRun: ["Legal / Regulation Agent"],
    searchQueriesUsed: [],
    sourcesReviewed: [],
    sourcesRejected: [],
    unsupportedFindings: [],
    citationMap: [],
    verificationSummary: {
      uncitedLegalClaimsRejected: 0,
      fabricatedStatutesRejected: 0,
      staleOrSupersededRegulationsRejected: 0,
      unsupportedOemRequirementsRejected: 0,
      inferredPolicyRightsDowngraded: 0,
    },
    sourcesAccepted: [
      {
        id: "pa-law",
        sourceType: "law",
        sourceTitle: "Pennsylvania unfair claim handling regulation",
        url: "https://www.insurance.pa.gov/example",
        locator: "PA DOI",
        jurisdiction: "PA",
        retrievalTimestamp: "2026-05-19T00:00:00.000Z",
        confidenceScore: 0.86,
        supportCategory: "Verified Law",
        agent: "Legal / Regulation Agent",
        accepted: true,
      },
      {
        id: "tx-law",
        sourceType: "law",
        sourceTitle: "Texas claim handling bulletin",
        url: "https://www.tdi.texas.gov/example",
        locator: "TX DOI",
        jurisdiction: "TX",
        retrievalTimestamp: "2026-05-19T00:00:00.000Z",
        confidenceScore: 0.86,
        supportCategory: "Research Leads - Not Jurisdiction Verified",
        agent: "Legal / Regulation Agent",
        accepted: true,
      },
      {
        id: "unknown-law",
        sourceType: "law",
        sourceTitle: "Generic claim handling article",
        url: "https://example.test/law",
        locator: "unknown jurisdiction",
        jurisdiction: "not established",
        retrievalTimestamp: "2026-05-19T00:00:00.000Z",
        confidenceScore: 0.5,
        supportCategory: "Research Leads - Not Jurisdiction Verified",
        agent: "Legal / Regulation Agent",
        accepted: true,
      },
    ],
  });
  const verifiedLaw = sections.find((section) => section.title === "Verified Law");
  const researchLeads = sections.find((section) => section.title === "Research Leads — Not Jurisdiction Verified");

  assert.ok(verifiedLaw);
  assert.ok(researchLeads);
  assert.match(JSON.stringify(verifiedLaw), /Pennsylvania unfair claim handling regulation/);
  assert.doesNotMatch(JSON.stringify(verifiedLaw), /Texas claim handling bulletin|Generic claim handling article|not established/i);
  assert.match(JSON.stringify(researchLeads), /Texas claim handling bulletin|Generic claim handling article/i);
});

run("shared PDF presentation cleanup normalizes duplicate not-clearly labels", () => {
  const text = [
    sanitizeReportText("Not clearly Not clearly shown"),
    sanitizeReportText("not clearly not clearly shown"),
    sanitizeReportText("Carrier estimate.: Not clearly Not clearly shown."),
    sanitizeReportText("Shop estimate.: not clearly not clearly shown."),
  ].join("\n");

  assert.match(text, /Carrier estimate: Not clearly shown\./);
  assert.match(text, /Shop estimate: Not clearly shown\./);
  assert.doesNotMatch(text, /Not clearly Not clearly|not clearly not clearly|estimate\.:/);
});

run("customer-report presentation cleanup avoids unsupported Pennsylvania wording", () => {
  const text = sanitizeReportText(
    "In Pennsylvania, the file also supports asking for written status updates when the claim is delayed or when the repair position is not being explained clearly. Pennsylvania-specific options should not return."
  );

  assert.match(text, /If state-specific claim-handling rules apply, you may also be able to request written status updates/i);
  assert.match(text, /state-specific options should not return/i);
  assert.doesNotMatch(text, /In Pennsylvania|Pennsylvania-specific/i);
});

run("Estimate scrubber standalone builder remains Citation Density Gap while rail uses Delta Citation Density Report", () => {
  const document = buildEstimateScrubberPdf({
    report: REPORT,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(document.header.title, "Citation Density Gap Report");
  assert.equal(document.filename, "citation-density-gap-report.pdf");
  assert.ok(document.sections.some((section) => section.title === "1. Bottom Line"));
  assert.ok(document.sections.some((section) => section.title === "4. Authority Matrix"));
  assert.ok(document.sections.some((section) => section.title === "8. Source Boundary"));
  assert.ok(!document.sections.some((section) => section.title === "Estimate QA Findings"));
  const chatbotSource = fs.readFileSync(path.join(process.cwd(), "src", "components", "ChatbotPage.tsx"), "utf8");
  assert.match(chatbotSource, /Delta Citation Density Report/i);
  assert.match(chatbotSource, /downloadReportDocument\("estimate_scrubber"\)/i);
  assert.match(
    fs.readFileSync(path.join(process.cwd(), "src", "app", "api", "reports", "send", "route.ts"), "utf8"),
    /case "estimate_scrubber":[\s\S]*Delta Citation Density Report/i
  );
});

run("Citation Density Gap Report shows citation gaps beside estimate anchors", () => {
  const annotatedReport = {
    ...REPORT,
    issues: [
      ...REPORT.issues,
      {
        id: "issue-adas",
        category: "calibration",
        title: "ADAS Calibration Procedure Support",
        finding: "ADAS Calibration Procedure Support",
        impact: "Post-repair scan and calibration support is referenced but not invoice-backed.",
        missingOperation: "ADAS Calibration Procedure Support",
        severity: "medium",
        evidenceIds: ["evidence-chain-12345"],
      },
    ],
    evidence: [
      {
        id: "evidence-chain-12345",
        title: "Parser fragment {line:evidence-chain-12345}",
        snippet: "Subl Post-repair scan -- pending invoice",
        source: "carrier estimate",
        authority: "inferred",
      },
    ],
  };
  const document = buildAnnotatedEstimateReviewPdf({
    report: annotatedReport,
    analysis: {
      ...ANALYSIS,
      operations: [
        ...ANALYSIS.operations,
        {
          operation: "Post-repair scan",
          component: "Scan and calibration",
          rawLine: "Subl Post-repair scan -- pending invoice",
        },
      ],
    },
    panel: null,
    assistantAnalysis: null,
  });
  const text = JSON.stringify(document);

  assert.equal(document.header.title, "Citation Density Gap Report");
  assert.equal(document.filename, "citation-density-gap-report.pdf");
  assert.ok(document.sections.some((section) => section.title === "3. Highest-Priority Gaps"));
  assert.ok(document.sections.some((section) => section.title === "6. Proof Needed Before Leading With This"));
  assert.ok(document.summary.some((item) => item.label === "Needs Authority / Proof" && Number(item.value) > 0));
  assert.match(text, /Gap \/ operation \| Carrier issue \| Estimate impact \| Authority status \| Missing proof \| Priority \| Next action/i);
  assert.match(text, /Needs proof: ADAS Calibration Procedure Support is referenced but final invoice-backed completion is not shown/i);
  assert.match(text, /Proof Needed Before Leading With This/);
  assert.match(text, /Citation density/i);
  assert.match(text, /Estimate evidence supports the existence of a difference/i);
  assert.match(text, /CCC Secure Share source confirms this estimate line was present in the structured estimate data/i);
  assert.match(text, /The CCC estimate data supports the existence of this line-item difference\. OEM\/P-page\/DEG\/legal support has not yet been verified/i);
  assert.doesNotMatch(text, /Estimate documentation the existence/i);
  assert.doesNotMatch(text, /CCC Secure Share documentation this estimate line/i);
  assert.doesNotMatch(text, /OEMdocumentation/i);
  assert.doesNotMatch(text, /Support Confidence|Confidence:|evidence-chain-12345|Parser fragment/);
  assert.doesNotMatch(text, /Operation: .* \| Status:/i);
  assert.doesNotMatch(text, /DOI violation|violated law/i);
});

run("Citation Density Gap model exposes stable anchors and citation readiness fields", () => {
  const model = buildAnnotatedEstimateReviewModel({
    report: {
      ...REPORT,
      issues: [
        ...REPORT.issues,
        {
          id: "issue-alignment-proof",
          category: "alignment",
          title: "Four-Wheel Alignment Completion Record",
          finding: "Four-Wheel Alignment Completion Record",
          impact: "Alignment appears in the estimate, but completion support should be confirmed.",
          missingOperation: "Four-Wheel Alignment",
          severity: "medium",
          evidenceIds: [],
        },
      ],
    },
    analysis: {
      ...ANALYSIS,
      issues: [
        ...(ANALYSIS.issues ?? []),
        {
          id: "issue-alignment-proof",
          category: "alignment",
          title: "Four-Wheel Alignment Completion Record",
          finding: "Four-Wheel Alignment Completion Record",
          impact: "Alignment appears in the estimate, but completion support should be confirmed.",
          missingOperation: "Four-Wheel Alignment",
          severity: "medium",
          evidenceIds: [],
        },
      ],
      estimateComparisons: {
        rows: [
          {
            id: "alignment-row",
            category: "Diagnostics",
            operation: "Four-Wheel Alignment",
            lhsSource: "Shop",
            rhsSource: "Carrier",
            lhsValue: "Algn Four-Wheel Alignment",
            rhsValue: "Alignment not documented",
            delta: "Completion proof pending",
            deltaType: "changed",
          },
        ],
      },
      rawEstimateText: [
        "Subl Post-repair scan -- pending invoice",
        "Algn Four-Wheel Alignment",
        "Frame setup and measure",
      ].join("\n"),
    },
    panel: null,
    assistantAnalysis: null,
  });

  assert.ok(model.lineAnchors.some((anchor) => anchor.lineId.startsWith("line-1")));
  assert.ok(model.annotations.length >= 2);
  const annotation = model.annotations[0];
  assert.ok(annotation.id);
  assert.ok(annotation.estimateId);
  assert.ok(annotation.lineId);
  assert.ok(annotation.category);
  assert.ok(["red", "yellow", "blue", "green", "gray"].includes(annotation.severity));
  assert.ok(["verified", "referenced", "inferred", "missing"].includes(annotation.supportStatus));
  assert.ok(annotation.citationGapBucket);
  assert.ok(Number.isFinite(annotation.citationDensityScore));
  assert.ok(["citation_ready", "estimate_evidence_only", "needs_authority", "needs_completion_proof", "weak_do_not_lead"].includes(annotation.citationReadiness));
  assert.equal(annotation.visibility.customer, true);
  assert.equal(annotation.visibility.estimator, true);
  assert.ok(
    model.annotations.some((item) =>
      /scan|alignment/i.test(`${item.title} ${item.anchorText}`) &&
      item.supportStatus !== "inferred"
    )
  );
  assert.ok(model.annotations.some((item) =>
    item.citationReadiness === "needs_completion_proof" ||
    item.citationReadiness === "needs_authority" ||
    item.category === "Needs invoice/proof" ||
    item.category === "Needs OEM procedure support"
  ));
  assert.ok(model.annotations.some((item) =>
    item.citationGapBucket === "needs_oem_procedure" ||
    item.citationGapBucket === "needs_invoice_or_completion_proof"
  ));
  assert.ok(model.citationDensityFindings.length >= model.annotations.length);
  const densityFinding = model.citationDensityFindings[0];
  assert.ok(densityFinding.id);
  assert.ok(densityFinding.operationLabel);
  assert.ok([
    "adas_calibration",
    "scan_diagnostic",
    "refinish",
    "r_and_i",
    "parts_downgrade",
    "hardware_fasteners",
    "one_time_use_parts",
    "not_included_operation",
    "labor_difference",
    "rental",
    "towing_storage",
    "policy_coverage",
    "state_regulation",
    "structural_or_fit_verification",
    "other",
  ].includes(densityFinding.category));
  assert.ok([
    "missing_from_carrier",
    "reduced_by_carrier",
    "present_but_under_documented",
    "referenced_not_produced",
    "needs_proof",
    "weak_do_not_lead",
  ].includes(densityFinding.estimateGapType));
  assert.ok(Number.isFinite(densityFinding.citationDensityScore));
  assert.ok(Number.isInteger(densityFinding.verifiedAuthorityCount));
  assert.ok(Array.isArray(densityFinding.missingAuthorityTypes));
  assert.ok(densityFinding.currentSupportSummary);
  assert.ok(densityFinding.missingProofSummary);
  assert.ok(densityFinding.recommendedNextAction);
  assert.ok(["low", "medium", "high"].includes(densityFinding.confidence));
  assert.ok(Array.isArray(densityFinding.limitations));
  assert.ok(model.citationDensityFindings.some((item) =>
    item.estimateGapType === "needs_proof" ||
    item.estimateGapType === "present_but_under_documented" ||
    item.estimateGapType === "referenced_not_produced"
  ));
  assert.ok(!model.citationDensityFindings.every((item) =>
    item.estimateGapType === "missing_from_carrier" ||
    item.estimateGapType === "reduced_by_carrier"
  ));
  assert.doesNotMatch(JSON.stringify(model), /evidence-chain-\d+|debug confidence|internal reasoning/i);
});

run("Citation Density Gap Report classifies proof gaps and referenced Toyota links", () => {
  const model = buildAnnotatedEstimateReviewModel({
    report: {
      ...REPORT,
      issues: [
        {
          id: "issue-toyota-procedure",
          category: "calibration",
          title: "Toyota blind spot monitor calibration procedure",
          finding: "Toyota blind spot monitor calibration procedure",
          impact: "Toyota OEM procedure link is referenced, but the actual procedure text is not produced in the file.",
          missingOperation: "Blind spot monitor calibration",
          severity: "high",
          evidenceIds: ["toyota-link"],
        },
        {
          id: "issue-calibration-completion",
          category: "documentation",
          title: "Final invoice completion record",
          finding: "Final invoice completion record",
          impact: "The operation may be valid, but final invoice or completion proof is absent.",
          missingOperation: "Final invoice completion record",
          severity: "medium",
          evidenceIds: [],
        },
        {
          id: "issue-cosmetic-soft",
          category: "cosmetic",
          title: "General cosmetic research lead",
          finding: "General cosmetic research lead",
          impact: "General non-make-specific internet lead is too soft to lead the supplement package.",
          missingOperation: "Cosmetic refinish blend note",
          severity: "low",
          evidenceIds: [],
        },
      ],
      evidence: [
        {
          id: "toyota-link",
          title: "Toyota OEM procedure link referenced but not produced",
          snippet: "Toyota OEM procedure link referenced but not produced; actual procedure text is not attached.",
          source: "Toyota OEM procedure referenced but not produced",
          authority: "referenced",
        },
        {
          id: "evidence-ccc",
          title: "CCC Secure Share workfile",
          snippet: "CCC Secure Share source confirms estimate line presence only.",
          source: "CCC workfile artifact",
          authority: "estimate evidence",
        },
      ],
      estimateFacts: {
        documentedHighlights: [
          "CCC Secure Share workfile artifact",
        ],
        documentedProcedures: [],
      },
      rawEstimateText: "Toyota blind spot monitor calibration procedure referenced but not produced\nFinal invoice completion record missing\nGeneral non-make-specific research lead",
    },
    analysis: {
      ...ANALYSIS,
      rawEstimateText: "Toyota blind spot monitor calibration procedure referenced but not produced\nFinal invoice completion record missing\nGeneral non-make-specific research lead",
    },
    panel: null,
    assistantAnalysis: null,
  });
  const document = buildAnnotatedEstimateReviewPdf({
    report: {
      ...REPORT,
      issues: [
        {
          id: "issue-toyota-procedure",
          category: "calibration",
          title: "Toyota blind spot monitor calibration procedure",
          finding: "Toyota blind spot monitor calibration procedure",
          impact: "Toyota OEM procedure link is referenced, but the actual procedure text is not produced in the file.",
          missingOperation: "Blind spot monitor calibration",
          severity: "high",
          evidenceIds: ["toyota-link"],
        },
        {
          id: "issue-calibration-completion",
          category: "documentation",
          title: "Final invoice completion record",
          finding: "Final invoice completion record",
          impact: "The operation may be valid, but final invoice or completion proof is absent.",
          missingOperation: "Final invoice completion record",
          severity: "medium",
          evidenceIds: [],
        },
        {
          id: "issue-cosmetic-soft",
          category: "cosmetic",
          title: "General cosmetic research lead",
          finding: "General cosmetic research lead",
          impact: "General non-make-specific internet lead is too soft to lead the supplement package.",
          missingOperation: "Cosmetic refinish blend note",
          severity: "low",
          evidenceIds: [],
        },
      ],
      evidence: [
        {
          id: "toyota-link",
          title: "Toyota OEM procedure link referenced but not produced",
          snippet: "Toyota OEM procedure link referenced but not produced; actual procedure text is not attached.",
          source: "Toyota OEM procedure referenced but not produced",
          authority: "referenced",
        },
        {
          id: "evidence-ccc",
          title: "CCC Secure Share workfile",
          snippet: "CCC Secure Share source confirms estimate line presence only.",
          source: "CCC workfile artifact",
          authority: "estimate evidence",
        },
      ],
      estimateFacts: {
        documentedHighlights: [
          "CCC Secure Share workfile artifact",
        ],
        documentedProcedures: [],
      },
      rawEstimateText: "Toyota blind spot monitor calibration procedure referenced but not produced\nFinal invoice completion record missing\nGeneral non-make-specific research lead",
    },
    analysis: {
      ...ANALYSIS,
      rawEstimateText: "Toyota blind spot monitor calibration procedure referenced but not produced\nFinal invoice completion record missing\nGeneral non-make-specific research lead",
    },
    panel: null,
    assistantAnalysis: null,
  });
  const text = JSON.stringify(document);

  assert.ok(model.annotations.some((item) =>
    item.citationGapBucket === "needs_oem_procedure" ||
    item.citationGapBucket === "needs_invoice_or_completion_proof"
  ));
  assert.ok(model.citationDensityFindings.some((item) =>
    /ADAS Calibration Procedure Support|Toyota blind spot monitor calibration procedure/i.test(item.operationLabel) &&
    item.citationStatus.oem === "referenced_not_produced" &&
    item.verifiedAuthorityCount === 0
  ));
  assert.ok(model.citationDensityFindings.some((item) => item.estimateGapType === "weak_do_not_lead"));
  assert.ok(document.sections.some((section) => section.title === "2. Citation Density Score"));
  assert.ok(document.sections.some((section) => section.title === "6. Proof Needed Before Leading With This"));
  assert.ok(document.sections.some((section) => section.title === "7. Weak / Do Not Lead"));
  assert.match(text, /CCC Secure Share source confirms this estimate line was present in the structured estimate data/i);
  assert.match(text, /estimate evidence/i);
  assert.doesNotMatch(text, /verified OEM support|verified OEM procedure|CCC proves|CCC confirms this operation is required/i);
  assert.doesNotMatch(text, /Find every line item the insurer left off|Every finding ships with the documentation your adjuster needs|One workflow, one source of truth|Gaps surfaced before the repair starts|GuideCoat|Bainbridge/i);
});

run("Citation Density Gap Report does not anchor test-fit findings to generic option lines", () => {
  const params = {
    report: {
      ...REPORT,
      issues: [
        {
          id: "issue-test-fit",
          category: "fit",
          title: "Test fit verification",
          finding: "Test fit verification",
          impact: "Panel fit should be confirmed without relying on vehicle option text.",
          missingOperation: "Test fit",
          severity: "medium",
          evidenceIds: [],
        },
      ],
    },
    analysis: {
      ...ANALYSIS,
      operations: [
        {
          operation: "Test fit",
          component: "Vehicle options",
          rawLine: "Power Driver Seat Telescopic Wheel Traction Control PAINT.",
        },
      ],
      rawEstimateText: "Power Driver Seat Telescopic Wheel Traction Control PAINT.",
    },
    panel: null,
    assistantAnalysis: null,
  };
  const model = buildAnnotatedEstimateReviewModel(params);
  const document = buildAnnotatedEstimateReviewPdf(params);
  const text = JSON.stringify(model.annotations);
  const documentText = JSON.stringify(document);

  assert.match(text, /Fit and finish clarification/);
  assert.doesNotMatch(text, /Power Driver Seat Telescopic Wheel Traction Control PAINT/i);
  assert.doesNotMatch(documentText, /Power Driver Seat Telescopic Wheel Traction Control PAINT|\[INFO\]: This line is present/i);
});

run("Collision Snapshot formats comparison deltas without parser-style labels", () => {
  const snapshot = buildCollisionSnapshot({
    renderModel: {
      vehicle: REPORT.vehicle,
      reportFields: {
        documentedHighlights: ["Estimate comparison identifies procedure and reset differences."],
        documentedProcedures: [],
      },
      supplementItems: [],
      findingReasoning: [],
      confidenceIntegrity: {
        adjustedConfidence: "Moderate",
        completenessStatus: "PARTIAL",
        uploadedFileCount: 1,
        indexedFileCount: 1,
        reviewedFileCount: 1,
        reviewableFileCount: 1,
        excludedFromReviewCount: 0,
        excludedFromReviewReasons: [],
        totalKnownFileCount: 1,
        uploadLimitReached: false,
        userIndicatedMoreFiles: false,
        missingCriticalEvidence: [],
        userFacingDisclosure: "Current file set remains partial.",
      },
      disputeStrategy: { priorityFindings: [] },
      pressureMode: { mode: "explanatory", rationale: "Snapshot comparison label test.", itemBreakdown: [] },
      valuation: { acvRange: null, dvRange: null, acvConfidence: null, dvConfidence: null, acvReasoning: "" },
    },
    estimateComparisons: {
      rows: [
        {
          id: "proc-row",
          category: "Procedures",
          operation: "Proc",
          lhsSource: "Shop estimate",
          rhsSource: "Carrier estimate",
          lhsValue: "shown",
          rhsValue: null,
          delta: "Present only in shop estimate",
          deltaType: "added",
        },
        {
          id: "reset-row",
          category: "Electrical labor",
          operation: "Reset electrical components",
          lhsSource: "Shop estimate",
          rhsSource: "Carrier estimate",
          lhsValue: "0.3",
          rhsValue: null,
          delta: "Only on left",
          deltaType: "added",
        },
        {
          id: "tire-label-row",
          category: "Labels",
          operation: "Repl Tire info label",
          lhsSource: "Shop estimate",
          rhsSource: "Carrier estimate",
          lhsValue: "Repl Tire info label",
          rhsValue: null,
          delta: "Present only in shop estimate",
          deltaType: "added",
        },
      ],
    },
  });
  const text = JSON.stringify(snapshot.estimateComparison.keyDeltas);

  assert.match(text, /Procedure item: present only in shop estimate\./);
  assert.match(text, /Reset electrical components: 0\.3 hrs in shop estimate; not clearly shown in carrier estimate\./);
  assert.match(text, /Repl Tire info label: present only in shop estimate\./);
  assert.doesNotMatch(text, /Proc vs not shown|Only on left|Repl Tire info label Repl Tire info label vs not shown Present only/i);
});

run("Collision Snapshot favors side-impact dispute drivers over generic front-end items", () => {
  const snapshot = buildCollisionSnapshot({
    vehicle: REPORT.vehicle,
    reportFields: {
      documentedHighlights: ["Left side impact with left doors, quarter panel, wheel-area alignment, and ADAS calibration review."],
      documentedProcedures: ["Left quarter/door fit and wheel alignment verification."],
    },
    supplementItems: [],
    findingReasoning: [
      {
        issue: "Generic front-end structural support",
        why_it_matters: "Front-end support can matter in some collisions.",
        what_proves_it: "Generic front structure reference.",
        next_action: "Review front bumper and radiator support.",
        leverageScore: 100,
        evidenceLevel: "REFERENCED_BUT_NOT_COMPLETED",
        claimSpecificity: "medium",
        confidence: 0.6,
      },
      {
        issue: "Left side structure and door/quarter fit",
        why_it_matters: "Side structure, door gaps, quarter fit, and wheel alignment are the supported dispute drivers.",
        what_proves_it: "Left side impact and repair documentation.",
        next_action: "Confirm side-structure measurements, door/quarter fit, wheel-area alignment, and calibration records.",
        leverageScore: 20,
        evidenceLevel: "DOCUMENTED",
        claimSpecificity: "high",
        confidence: 0.8,
      },
    ],
    confidenceIntegrity: {
      adjustedConfidence: "Moderate",
      completenessStatus: "PARTIAL",
      uploadedFileCount: 1,
      indexedFileCount: 1,
      reviewedFileCount: 1,
      reviewableFileCount: 1,
      excludedFromReviewCount: 0,
      excludedFromReviewReasons: [],
      totalKnownFileCount: 1,
      uploadLimitReached: false,
      userIndicatedMoreFiles: false,
      missingCriticalEvidence: [],
      userFacingDisclosure: "Current file set remains partial.",
    },
    disputeStrategy: { priorityFindings: [] },
    pressureMode: { mode: "explanatory", rationale: "Snapshot presentation test.", itemBreakdown: [] },
    valuation: { acvRange: null, dvRange: null, acvConfidence: null, dvConfidence: null, acvReasoning: "" },
  });
  const text = JSON.stringify(snapshot.topDisputeItems);

  assert.match(text, /Left side structure and door\/quarter fit/);
  assert.doesNotMatch(text, /Generic front-end structural support/);
});

run("Policy Rights Review promotes uploaded policy document evidence", () => {
  const policyReport = {
    ...REPORT,
    evidenceRegistry: [
      {
        id: "policy-upload-1",
        sourceType: "policy_document",
        label: "Allstate Pennsylvania policy packet.pdf",
        extractedText: [
          "Pennsylvania Financial Responsibility Identification Card",
          "Allstate policy declarations",
          "This policy is issued for a Pennsylvania risk.",
          "Collision Coverage and Comprehensive Coverage are shown.",
          "If we cannot agree, either party may demand appraisal.",
          "Duties after loss include cooperation and proof of loss.",
        ].join("\n"),
        extractedSummary:
          "Carrier: Allstate. Jurisdiction indicator: PA. Coverage indicators: collision, comprehensive. Dispute-resolution language: If we cannot agree, either party may demand appraisal.",
        structuredFacts: {
          carrier: "Allstate",
          jurisdiction: "PA",
          coverage: "collision, comprehensive",
          appraisalOrArbitration: "If we cannot agree, either party may demand appraisal.",
          dutiesAfterLoss: "Duties after loss include cooperation and proof of loss.",
          policyForms: ["PA-AUTO-POLICY"],
        },
        ingestionState: "uploaded",
        evidenceStatus: "DOCUMENTED",
        relatedIssueKeys: [],
        createdAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:00.000Z",
      },
    ],
    ingestionMeta: {
      uploadedFileCount: 1,
    },
  };

  const document = buildPolicyRightsReviewPdf({
    report: policyReport,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: null,
  });
  const text = JSON.stringify(document);

  assert.equal(document.header.title, "Policy & Rights Review");
  assert.ok(document.summary.some((item) => item.label === "Jurisdiction" && /PA|Pennsylvania/i.test(item.value)));
  assert.ok(document.summary.some((item) => item.label === "Jurisdiction Confidence" && item.value === "High"));
  assert.match(text, /Uploaded policy packet|Allstate Pennsylvania policy packet|policy document/i);
  assert.match(text, /appraisal|cannot agree/i);
  assert.doesNotMatch(text, /No uploaded policy|no verified policy language/i);
});

run("Policy Rights Review labels redacted policy metadata neutrally without implying Georgia jurisdiction", () => {
  const policyReport = {
    ...REPORT,
    evidenceRegistry: [
      {
        id: "policy-upload-redacted",
        sourceType: "policy_document",
        label: "policy packet with Georgia (GA) policy indicators.pdf",
        extractedText: [
          "Pennsylvania Financial Responsibility Identification Card",
          "Collision Coverage and Comprehensive Coverage are shown.",
          "If we cannot agree, either party may demand appraisal.",
        ].join("\n"),
        extractedSummary:
          "Jurisdiction indicator: PA. Redacted source metadata may contain unrelated state shorthand.",
        structuredFacts: {
          jurisdiction: "PA",
          appraisalOrArbitration: "If we cannot agree, either party may demand appraisal.",
        },
        ingestionState: "uploaded",
        evidenceStatus: "DOCUMENTED",
        relatedIssueKeys: [],
        createdAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:00.000Z",
      },
    ],
    ingestionMeta: {
      uploadedFileCount: 1,
    },
  };

  const document = buildPolicyRightsReviewPdf({
    report: policyReport,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: "Pennsylvania claim jurisdiction is established from the claim file.",
  });
  const text = JSON.stringify(document);

  assert.ok(document.summary.some((item) => item.label === "Jurisdiction" && /PA|Pennsylvania/i.test(item.value)));
  assert.match(text, /uploaded policy packet \/ appraisal-language support; jurisdiction metadata redacted or ambiguous/i);
  assert.match(text, /Jurisdiction metadata: redacted or ambiguous/i);
  assert.match(text, /Source metadata is redacted or ambiguous; policy language should be reviewed directly/i);
  assert.doesNotMatch(text, /Georgia \(GA\) policy indicators|Jurisdiction: Georgia \(GA\)/i);
});

run("Estimate Delta labels visible subset as top items when count is larger", () => {
  const addedRows = Array.from({ length: 25 }, (_, index) => ({
    id: `added-${index + 1}`,
    category: "Operations",
    operation: `Added operation ${index + 1}`,
    lhsSource: "Original estimate",
    rhsSource: "Newer estimate",
    lhsValue: null,
    rhsValue: `Added labor ${index + 1}`,
    delta: "Added in newer estimate",
    deltaType: "removed",
  }));
  const document = buildEstimatorChangeRequestListPdf({
    report: REPORT,
    analysis: {
      ...ANALYSIS,
      estimateComparisons: {
        rows: addedRows,
      },
    },
    panel: null,
    assistantAnalysis: null,
  });
  const addedSummary = document.summary.find((item) => item.label === "Added");
  const addedSection = document.sections.find((section) => /added in newer estimate/i.test(section.title));

  assert.equal(addedSummary?.value, "25");
  assert.ok(addedSection);
  assert.match(addedSection.title, /^Top added in newer estimate$/i);
  assert.equal(addedSection.bullets?.[0], "Showing 8 of 25 matching items.");
  assert.equal((addedSection.bullets ?? []).filter((bullet) => /^Added operation \d+:/i.test(bullet)).length, 8);
  assert.doesNotMatch(addedSection.title, /^Added In Newer Estimate$/i);
});

run("Annotated Estimate Review selects lower-cost carrier estimate and keeps comparison internal", () => {
  const comparisonAnalysis = {
    ...ANALYSIS,
    estimateComparisons: {
      rows: [
        {
          id: "total-row",
          category: "Estimate Total",
          operation: "Estimate total",
          lhsSource: "Shop",
          rhsSource: "Carrier",
          lhsValue: "$12,500.00",
          rhsValue: "$8,250.00",
          delta: "$4,250.00",
          deltaType: "changed",
        },
        {
          id: "hood-row",
          category: "Parts",
          operation: "Hood replacement",
          partName: "Hood",
          lhsSource: "Shop",
          rhsSource: "Carrier",
          lhsValue: "OEM hood",
          rhsValue: "A/M hood",
          delta: "Alternate part difference",
          deltaType: "changed",
          notes: ["Confirm part fit, warranty, safety, and repair procedure requirements."],
        },
        {
          id: "scan-row",
          category: "Diagnostics",
          operation: "Post-repair scan",
          lhsSource: "Shop",
          rhsSource: "Carrier",
          lhsValue: "Post-repair scan with report",
          rhsValue: "Subl Post-repair scan -- pending invoice",
          delta: "Proof pending",
          deltaType: "changed",
        },
        {
          id: "newer-added-row",
          category: "Operations",
          operation: "Additional refinish labor",
          lhsSource: "Original estimate",
          rhsSource: "Newer estimate",
          lhsValue: null,
          rhsValue: "Refinish labor 1.5",
          delta: "Added in newer estimate",
          deltaType: "removed",
        },
        {
          id: "newer-missing-row",
          category: "Operations",
          operation: "Wheel opening molding",
          lhsSource: "Original estimate",
          rhsSource: "Newer estimate",
          lhsValue: "R&I wheel opening molding",
          rhsValue: null,
          delta: "Missing from newer estimate",
          deltaType: "added",
        },
        {
          id: "newer-price-row",
          category: "Parts",
          operation: "Lock support price",
          lhsSource: "Original estimate",
          rhsSource: "Newer estimate",
          lhsValue: "$120.00",
          rhsValue: "$95.00",
          delta: "-$25.00",
          valueUnit: "currency",
          deltaType: "changed",
        },
      ],
    },
    rawEstimateText: "Carrier estimate\nA/M hood\nSubl Post-repair scan -- pending invoice\nAlgn Four-Wheel Alignment\nShop estimate\nOEM hood",
  };
  const model = buildAnnotatedEstimateReviewModel({
    report: REPORT,
    analysis: comparisonAnalysis,
    panel: null,
    assistantAnalysis: null,
  });
  const annotated = buildAnnotatedEstimateReviewPdf({
    report: REPORT,
    analysis: comparisonAnalysis,
    panel: null,
    assistantAnalysis: null,
  });
  const estimatorList = buildEstimatorChangeRequestListPdf({
    report: REPORT,
    analysis: comparisonAnalysis,
    panel: null,
    assistantAnalysis: null,
  });
  const chatbotSource = fs.readFileSync(path.join(process.cwd(), "src", "components", "ChatbotPage.tsx"), "utf8");
  const text = JSON.stringify({ model, annotated, estimatorList });

  assert.equal(model.scrubTarget.role, "carrier");
  assert.equal(model.scrubTarget.lowerCostTotal, 8250);
  assert.match(model.scrubTarget.label, /Lower-cost carrier estimate/i);
  assert.equal(annotated.header.title, "Citation Density Gap Report");
  assert.match(text, /1\. Bottom Line/);
  assert.equal(estimatorList.header.title, "Estimate Delta / Change Requests");
  assert.equal(estimatorList.filename, "estimate-delta-change-requests.pdf");
  assert.ok(estimatorList.sections.some((section) => /^(Added In Newer Estimate|Top added in newer estimate|ONLY IN ESTIMATE 1|Top only in estimate 1|ONLY IN SHOP ESTIMATE|Top only in shop estimate)$/i.test(section.title)));
  assert.ok(estimatorList.sections.some((section) => /^(Missing From Newer Estimate|ONLY IN ESTIMATE 2|ONLY IN CARRIER ESTIMATE|REMOVED FROM NEWER ESTIMATE)$/i.test(section.title)));
  assert.ok(estimatorList.sections.some((section) => /^(Changed Labor \/ Qty \/ Price|CHANGED FROM PRIOR ESTIMATE|CHANGED BETWEEN ESTIMATES)$/i.test(section.title)));
  assert.ok(estimatorList.sections.some((section) => section.title === "Possible Rekey / Lock / Supplement Gaps"));
  assert.match(JSON.stringify(estimatorList), /Additional refinish labor|Refinish labor 1\.5/i);
  assert.match(JSON.stringify(estimatorList), /Wheel opening molding/i);
  assert.match(JSON.stringify(estimatorList), /Lock support price/i);
  assert.ok(model.citationDensityFindings.some((finding) =>
    /refinish|labor/i.test(finding.operationLabel) &&
    ["missing_from_carrier", "reduced_by_carrier", "present_but_under_documented", "referenced_not_produced", "needs_proof"].includes(finding.estimateGapType) &&
    finding.verifiedAuthorityCount === 0
  ));
  assert.ok(!model.citationDensityFindings.some((finding) =>
    /refinish|labor/i.test(finding.operationLabel) &&
    Object.values(finding.citationStatus).includes("verified")
  ));
  assert.match(text, /A\/M hood/);
  assert.match(text, /OEM hood/);
  assert.match(text, /Alternate part difference/);
  assert.match(text, /fit, safety, warranty/);
  assert.doesNotMatch(chatbotSource, /side_by_side_estimate_comparison/);
  assert.doesNotMatch(chatbotSource, /supplement_request_checklist|Supplement Support Package/);
  assert.doesNotMatch(chatbotSource, /Side-by-side PDF|Side-By-Side Estimate Comparison/);
  assert.doesNotMatch(JSON.stringify(estimatorList), /legal|DOI/i);
  assert.doesNotMatch(text, /legal authority|DOI violation|verified OEM procedure/i);
});

run("DOI packet is blocked when complaint prerequisites are missing", () => {
  const document = buildDoiComplaintPacketPdf({
    report: REPORT,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: APPRAISAL_PROCESS_CHAT_CONTEXT,
  });

  assert.equal(document.header.title, "DOI Readiness Review");
  assert.equal(document.filename, "doi-readiness-review.pdf");
  assert.ok(document.summary.some((item) => item.label === "DOI Readiness State" && item.value === "NOT_READY_FOR_DOI"));
  assert.ok(document.summary.some((item) => item.label === "Verified Regulation Sources" && item.value === "0"));
  assert.ok(
    document.sections.some((section) =>
      section.title === "DOI Readiness Status" &&
      section.bullets.some((bullet) =>
        bullet.includes("No verified legal violation is asserted unless verified legal authority and documented claim-handling conduct are both present.")
      )
    )
  );
  assert.ok(document.sections.some((section) => section.title === "Current Upload Provenance"));
  assert.ok(document.sections.some((section) => section.title === "User-Provided Chat Context"));
  assert.doesNotMatch(JSON.stringify(document), /Reported Premature Appraisal Award Demand|Reported Restriction On Continuing Repairs|Reported Post-Repair Appraisal Denial Concerns/i);
  assert.doesNotMatch(JSON.stringify(document), /insurer violated law/i);
});

run("DOI readiness does not treat technical repair disputes as regulatory misconduct", () => {
  const technicalOnlyReport = {
    ...REPORT,
    retrievalSummary: {
      driveDocsUsed: 0,
      webSourcesUsed: 1,
      serperStatus: "SUCCESS",
      oemEvidenceFound: false,
      sourcesInfluencingFindings: [
        {
          title: "Pennsylvania Department of Insurance claim handling regulation",
          sourceType: "web",
          url: "https://www.insurance.pa.gov/claim-handling-regulation",
          relatedFindingIds: ["issue-1"],
        },
      ],
    },
  };

  const document = buildDoiComplaintPacketPdf({
    report: technicalOnlyReport,
    analysis: {
      ...ANALYSIS,
      narrative:
        "Pennsylvania estimate dispute for a missing operation, scan/calibration gap, OEM procedure support, supplement dispute, structural verification issue, and appraisal amount disagreement.",
    },
    panel: {
      narrative: "Appraisal amount disagreement only.",
      supplements: [],
      stateLeverage: [],
      appraisal: {
        triggered: true,
        reasoning: "The file reflects an appraisal amount disagreement only.",
      },
    },
    assistantAnalysis: "Pennsylvania repair scope and appraisal amount disagreement only.",
  });

  assert.equal(document.header.title, "DOI Readiness Review");
  assert.ok(document.summary.some((item) => item.label === "DOI Readiness State" && item.value === "NOT_READY_FOR_DOI"));
  assert.ok(document.summary.some((item) => item.label === "Verified Regulation Sources" && item.value === "1"));
  assert.ok(document.summary.some((item) => item.label === "Documented Conduct Items" && item.value === "0"));
  assert.ok(document.sections.some((section) => section.title === "Claim Handling / Appraisal Dispute Summary"));
  assert.ok(document.sections.some((section) => section.title === "Supporting Repair/Scope Attachments"));
  assert.ok(!document.sections.some((section) => section.title === "Optional Draft Complaint"));
});

run("DOI and Policy reviews disclose stale appraisal chat context without promoting it", () => {
  const doiDocument = buildDoiComplaintPacketPdf({
    report: REPORT,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: APPRAISAL_PROCESS_CHAT_CONTEXT,
  });
  const policyDocument = buildPolicyRightsReviewPdf({
    report: REPORT,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: APPRAISAL_PROCESS_CHAT_CONTEXT,
  });

  const doiContext = doiDocument.sections.find((section) => section.title === "User-Provided Chat Context");
  const policyContext = policyDocument.sections.find((section) => section.title === "User-Provided Chat Context");
  const doiDisputeSummary = doiDocument.sections.find((section) => section.title === "Claim Handling / Appraisal Dispute Summary");
  const policyDisputeFocus = policyDocument.sections.find((section) => section.title === "Policy / Appraisal Dispute Focus");
  assert.ok(doiContext);
  assert.ok(policyContext);
  assert.ok(doiDisputeSummary);
  assert.ok(policyDisputeFocus);
  assert.match(JSON.stringify(doiContext), /prior_chat_context may mention an appraisal-process dispute/i);
  assert.match(JSON.stringify(policyContext), /prior_chat_context may mention an appraisal-process or claim-handling concern/i);
  assert.match(JSON.stringify(policyDisputeFocus), /Policy rights are insufficient because the current file does not include policy language/i);
  assert.match(JSON.stringify(doiDocument), /Current upload evidence source: current_upload estimates only/i);
  assert.doesNotMatch(JSON.stringify({ doiDocument, policyDocument }), /The user reports|appraisal may later be resisted|before the shop can continue|premature demand|repair-continuation restriction/i);
  assert.doesNotMatch(
    JSON.stringify({ doiDocument, policyDocument }),
    /insurer violated law|verified legal violation|claim-\[REDACTED_CLAIM\]|policy-\[REDACTED_POLICY\]|\buploaded document\b|Same rationale as earlier|Current estimate analysis; citation still needed|Calibration Verification Open/i
  );
});

run("DOI complaint packet renders only when readiness prerequisites are met", () => {
  const readyReport = {
    ...REPORT,
    evidence: [
      ...REPORT.evidence,
      {
        id: "carrier-email-1",
        title: "Carrier email",
        snippet: "The insurer refused to provide a written claim position after the supplement review request.",
        source: "uploaded carrier correspondence",
        authority: "internal",
      },
    ],
    retrievalSummary: {
      driveDocsUsed: 0,
      webSourcesUsed: 1,
      serperStatus: "SUCCESS",
      oemEvidenceFound: false,
      sourcesInfluencingFindings: [
        {
          title: "Pennsylvania Department of Insurance claim handling regulation",
          sourceType: "web",
          url: "https://www.insurance.pa.gov/claim-handling-regulation",
          relatedFindingIds: ["carrier-email-1"],
        },
      ],
    },
  };

  const document = buildDoiComplaintPacketPdf({
    report: readyReport,
    analysis: {
      ...ANALYSIS,
      narrative: "Pennsylvania claim handling dispute with documented refusal to provide a written claim position.",
    },
    panel: null,
    assistantAnalysis: "Pennsylvania claim handling dispute.",
  });

  assert.equal(document.header.title, "DOI Complaint Packet");
  assert.equal(document.filename, "doi-complaint-packet.pdf");
  assert.ok(document.summary.some((item) => item.label === "DOI Readiness State" && item.value === "READY_FOR_DOI"));
  assert.ok(document.summary.some((item) => item.label === "Verified Regulation Sources" && item.value === "1"));
  assert.ok(document.sections.some((section) => section.title === "Complaint Grounds - Documented Claim Conduct"));
  assert.ok(document.sections.some((section) => section.title === "Supporting Repair/Scope Attachments"));
  assert.ok(document.sections.some((section) => section.title === "Additional Repair/Scope Attachment Detail"));
  assert.ok(!document.sections.some((section) => section.title === "Unresolved Operations"));
  const complaintGrounds = document.sections.find((section) => section.title === "Complaint Grounds - Documented Claim Conduct");
  assert.ok(complaintGrounds.bullets.every((bullet) => !/Pre-Repair Scan|Four-Wheel Alignment/i.test(bullet)));
});
