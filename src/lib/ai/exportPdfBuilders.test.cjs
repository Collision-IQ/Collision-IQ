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
  assert.ok(
    document.sections.some((section) =>
      section.title === "Top Dispute Drivers"
    )
  );
  assert.ok(
    document.sections.some((section) =>
      (section.bullets ?? []).some((bullet) => /Recommended next action|current gap|support posture/i.test(bullet))
    )
  );
  assert.doesNotMatch(JSON.stringify(document), /\| status |\| evidence |\| Support:/i);
});

run("Estimate scrubber export is merged into Annotated Estimate Scrubber", () => {
  const document = buildEstimateScrubberPdf({
    report: REPORT,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(document.header.title, "Annotated Estimate Scrubber");
  assert.equal(document.filename, "annotated-estimate-scrubber.pdf");
  assert.ok(document.sections.some((section) => section.title === "Annotated Estimate Lines"));
  assert.ok(!document.sections.some((section) => section.title === "Estimate QA Findings"));
});

run("Annotated Estimate Review shows scrubber findings beside estimate anchors", () => {
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

  assert.equal(document.header.title, "Annotated Estimate Scrubber");
  assert.equal(document.filename, "annotated-estimate-scrubber.pdf");
  assert.ok(document.sections.some((section) => section.title === "Annotated Estimate Lines"));
  assert.match(text, /Line \d+:/i);
  assert.match(text, /Ask the insurer or repair shop to confirm whether adas calibration procedure support is included and documented/i);
  assert.match(text, /Requested Clarifications/);
  assert.doesNotMatch(text, /Support Confidence|Confidence:|evidence-chain-12345|Parser fragment/);
  assert.doesNotMatch(text, /Operation: .* \| Status:/i);
  assert.doesNotMatch(text, /DOI violation|violated law/i);
});

run("Annotated Estimate Review model exposes stable anchors and audience-safe annotation fields", () => {
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
  assert.equal(annotation.visibility.customer, true);
  assert.equal(annotation.visibility.estimator, true);
  assert.ok(
    model.annotations.some((item) =>
      /scan|alignment/i.test(`${item.title} ${item.anchorText}`) &&
      item.supportStatus !== "inferred"
    )
  );
  assert.doesNotMatch(JSON.stringify(model), /evidence-chain-\d+|debug confidence|internal reasoning/i);
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
  assert.equal(annotated.header.title, "Annotated Estimate Scrubber");
  assert.match(text, /Estimate Selected For Scrub/);
  assert.equal(estimatorList.header.title, "Estimator Change Request List");
  assert.match(text, /A\/M hood/);
  assert.match(text, /OEM hood/);
  assert.match(text, /Alternate part difference/);
  assert.match(text, /fit, safety, warranty/);
  assert.doesNotMatch(chatbotSource, /side_by_side_estimate_comparison/);
  assert.doesNotMatch(chatbotSource, /supplement_request_checklist|Supplement Support Package/);
  assert.doesNotMatch(chatbotSource, /Side-by-side PDF|Side-By-Side Estimate Comparison/);
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
      section.title === "Complaint Readiness Status" &&
      section.bullets.some((bullet) =>
        bullet.includes("The file currently supports an appraisal-process and repair-scope dispute. It does not yet establish a verified unfair claims handling violation because no confirmed regulatory citation, written denial, delay log, refusal-to-review documentation, or communication timeline has been isolated.")
      )
    )
  );
  assert.deepEqual(
    document.sections.map((section) => section.title),
    [
      "Complaint Readiness Status",
      "What The File Currently Supports",
      "User-Provided Chat Context",
      "What Is Not Yet Proven",
      "Missing Complaint Evidence",
      "Documents Needed Before Filing",
    ]
  );
  assert.doesNotMatch(JSON.stringify(document), /force payment|insurer violated law/i);
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
  assert.ok(document.sections.some((section) => section.title === "What The File Currently Supports"));
  assert.ok(!document.sections.some((section) => section.title === "Optional Draft Complaint"));
});

run("DOI and Policy reviews include appraisal-process chat context without treating it as verified misconduct", () => {
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
  assert.ok(doiContext);
  assert.ok(policyContext);
  assert.match(JSON.stringify(doiContext), /appraisal-process dispute/i);
  assert.match(JSON.stringify(doiContext), /written carrier or IA demand/i);
  assert.match(JSON.stringify(policyContext), /Uploaded policy\/appraisal language/i);
  assert.doesNotMatch(JSON.stringify({ doiDocument, policyDocument }), /insurer violated law|verified legal violation/i);
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
  assert.ok(document.sections.some((section) => section.title === "Evidence Attachments - Repair/Estimate Dispute Items"));
  assert.ok(!document.sections.some((section) => section.title === "Unresolved Operations"));
  const complaintGrounds = document.sections.find((section) => section.title === "Complaint Grounds - Documented Claim Conduct");
  assert.ok(complaintGrounds.bullets.every((bullet) => !/Pre-Repair Scan|Four-Wheel Alignment/i.test(bullet)));
});
