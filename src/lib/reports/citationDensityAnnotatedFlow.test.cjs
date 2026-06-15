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
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const {
  resolveAnnotatedCitationDensityTarget,
  shouldGenerateAnnotatedCitationDensityEstimate,
} = require("./citationDensityIntent.ts");
const {
  buildPdfRectFromTopLeftAnchor,
  pdfRectToViewportRect,
} = require("./citationDensityCoordinates.ts");
const {
  NO_SOURCE_PDF_ERROR,
  NO_SOURCE_PDF_USER_MESSAGE,
  describeReviewTarget,
  isAnnotatableEstimatePdf,
  resolveSourceEstimatePdf,
  resolveSourceEstimatePdfSelection,
  resolveSourceEstimatePdfSelections,
} = require("./citationDensitySourcePdf.ts");

function pdfAttachment(overrides = {}) {
  return {
    id: overrides.id ?? "pdf-1",
    filename: overrides.filename ?? "carrier-estimate.pdf",
    type: overrides.type ?? "application/pdf",
    text: overrides.text ?? "Carrier insurance estimate lower cost estimate line 12 ADAS calibration",
    imageDataUrl: overrides.imageDataUrl ?? "data:application/pdf;base64,JVBERi0xLjQK",
    classification: "pdf",
    ...overrides,
  };
}

function reportWithEvidenceRegistry() {
  return {
    narrative: "",
    evidenceRegistry: [
      {
        id: "carrier-evidence",
        sourceType: "carrier_estimate",
        label: "Carrier Estimate",
        ingestionState: "ingested",
        evidenceStatus: "verified",
        relatedIssueKeys: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "shop-evidence",
        sourceType: "shop_estimate",
        label: "Shop Estimate",
        ingestionState: "ingested",
        evidenceStatus: "verified",
        relatedIssueKeys: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

function finding(overrides = {}) {
  return {
    id: "finding-1",
    operationLabel: "ADAS calibration",
    category: "adas_calibration",
    estimateGapType: "needs_proof",
    carrierEvidence: {
      lineNumber: "12",
      description: "ADAS calibration",
      amount: 250,
      laborHours: 1.5,
      sourceLabel: "Carrier Estimate",
    },
    shopEvidence: {
      lineNumber: "12",
      description: "ADAS calibration",
      amount: 450,
      laborHours: 2,
      sourceLabel: "Shop Estimate",
    },
    impact: {
      safetyImpact: "high",
      supplementPriority: "high",
    },
    citationStatus: {
      oem: "needed",
      pPages: "not_found",
      scrs: "not_applicable",
      deg: "not_applicable",
      nhtsa: "not_applicable",
      stateRegulation: "not_applicable",
      policy: "not_applicable",
      invoiceOrCompletionProof: "needed",
      photoOrTeardownProof: "not_found",
    },
    citationDensityScore: 35,
    verifiedAuthorityCount: 0,
    missingAuthorityTypes: ["OEM procedure"],
    currentSupportSummary: "Estimate line only.",
    missingProofSummary: "OEM proof needed.",
    recommendedNextAction: "Attach OEM procedure.",
    confidence: "medium",
    limitations: [],
    ...overrides,
  };
}

function run(name, test) {
  try {
    test();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

run("chat intent routes annotated citation density carrier estimate requests to annotated export", () => {
  const input = "Generate an annotated citation density estimate PDF for the carrier estimate.";

  assert.equal(shouldGenerateAnnotatedCitationDensityEstimate(input), true);
  assert.equal(resolveAnnotatedCitationDensityTarget(input), "carrier");

  const chatSource = fs.readFileSync(path.join(process.cwd(), "src/components/ChatWidget.tsx"), "utf8");
  assert.match(chatSource, /\/api\/reports\/citation-density\/annotated-estimate/);
  assert.doesNotMatch(chatSource, /sourceDocumentId:\s*sourcePdf\.attachmentId/);
  assert.match(chatSource, /Download Citation Density PDF/);
  assert.doesNotMatch(chatSource, /I can't generate a PDF|I can only give you the annotation set|use this in Adobe|use this in Bluebeam/i);
  assert.doesNotMatch(chatSource, /annotation set|line-by-documentation map|ready-to-apply|annotation table|annotation map/i);
});

run("server chat routes block annotated estimate text/table fallback", () => {
  const chatRoute = fs.readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
  const caseChatRoute = fs.readFileSync(path.join(process.cwd(), "src/app/api/case-chat/route.ts"), "utf8");

  assert.match(chatRoute, /shouldGenerateAnnotatedCitationDensityEstimate/);
  assert.match(caseChatRoute, /shouldGenerateAnnotatedCitationDensityEstimate/);
  assert.doesNotMatch(`${chatRoute}\n${caseChatRoute}`, /annotation set|line-by-documentation map|ready-to-apply|annotation table/i);
});

run("upload success status includes visible file names", () => {
  const chatSource = fs.readFileSync(path.join(process.cwd(), "src/components/ChatWidget.tsx"), "utf8");

  assert.match(chatSource, /function buildUploadSuccessStatus/);
  assert.match(chatSource, /uploadedDisplayNames/);
  assert.match(chatSource, /setUploadUiMessage\(successStatus\)/);
  assert.doesNotMatch(chatSource, /setUploadUiMessage\(\s*`\$\{successfulUploadCount\} \$\{successfulUploadCount === 1 \? "file"/);
});

run("chat intent routes annotate both estimates requests to both-target export", () => {
  const input = "Annotate both estimates with citation density findings.";

  assert.equal(shouldGenerateAnnotatedCitationDensityEstimate(input), true);
  assert.equal(resolveAnnotatedCitationDensityTarget(input), "both");

  const chatSource = fs.readFileSync(path.join(process.cwd(), "src/components/ChatWidget.tsx"), "utf8");
  assert.match(chatSource, /outputs\?: Array/);
  assert.match(chatSource, /Download Citation Density PDF/);
  assert.match(chatSource, /output\.estimateRole/);
});

run("explicit standalone summary requests do not trigger annotated estimate intent", () => {
  assert.equal(shouldGenerateAnnotatedCitationDensityEstimate("Download the Citation Density summary report."), false);
  assert.equal(shouldGenerateAnnotatedCitationDensityEstimate("Generate the standalone Citation Density Gap Report."), false);
});

run("export card primary Citation Density action calls annotated route, not standalone report builder", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/components/ChatbotPage.tsx"), "utf8");
  const downloadIndex = source.indexOf('if (reportType === "estimate_scrubber")');
  const annotatedFetchIndex = source.indexOf('"/api/reports/citation-density/annotated-estimate"', downloadIndex);
  const standaloneBuilderIndex = source.indexOf("buildAnnotatedEstimateReviewPdf", downloadIndex);

  assert.match(source, /Download Citation Density PDF/);
  assert.match(source, /Email Citation Density PDF/);
  assert.match(source, /Citation Density PDF/);
  assert.doesNotMatch(source, /<FileText[\s\S]{0,300}Citation Density Gap Report/);
  assert.doesNotMatch(source, /Download summary report/);
  assert.doesNotMatch(source, /Estimate delta/);
  assert.doesNotMatch(source, /downloadCitationDensitySummaryReport/);
  assert.doesNotMatch(source, /sourceDocumentId:\s*sourcePdf\.attachmentId/);
  assert.match(source, /targetEstimate:\s*"auto"/);
  assert.match(source, /Citation Density annotated export requires an original estimate PDF/);
  assert.ok(annotatedFetchIndex > downloadIndex);
  assert.ok(standaloneBuilderIndex === -1 || annotatedFetchIndex < standaloneBuilderIndex);
});

run("OEM Citation Density replaces Policy & Rights primary report card", () => {
  const pageSource = fs.readFileSync(path.join(process.cwd(), "src/components/ChatbotPage.tsx"), "utf8");
  const flowCopy = fs.readFileSync(path.join(process.cwd(), "src/components/StructuredAnalysisCanvas.tsx"), "utf8");
  const oemRouteSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/reports/oem-citation-density/annotated-estimate/route.ts"),
    "utf8"
  );

  assert.match(pageSource, /OEM Citation Density Report/);
  assert.match(pageSource, /Download OEM Citation Density PDF/);
  assert.match(pageSource, /Email OEM Citation Density PDF/);
  assert.match(pageSource, /"\/api\/reports\/oem-citation-density\/annotated-estimate"/);
  assert.doesNotMatch(pageSource, /<FileText[\s\S]{0,300}Policy & Rights Review/);
  assert.doesNotMatch(flowCopy, /Policy & Rights Review/);
  assert.match(oemRouteSource, /OEM_CITATION_DENSITY_ARTIFACT_VERSION/);
  assert.match(oemRouteSource, /buildOemCitationDensityFindings/);
});

run("Citation Density viewer configures worker and converts PDF coordinates", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/components/CitationDensityAnnotationViewer.tsx"), "utf8");

  assert.match(source, /GlobalWorkerOptions\.workerSrc/);
  assert.match(source, /pdfjs-dist\/build\/pdf\.worker\.mjs/);
  assert.doesNotMatch(source, /disableWorker:\s*true/);
  assert.match(source, /PDF viewer failed to initialize\. Download the PDF instead\./);
  assert.match(source, /pdfRectToViewportRect/);
  assert.match(source, /getAnnotationOverlayRect/);
  assert.doesNotMatch(source, /pdfHeight - source\.y - source\.height/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /data-finding-id=\{annotation\.findingId\}/);
  assert.match(source, /data-anchor-id=\{annotation\.anchorId\}/);
  assert.match(source, /data-annotation-key=\{selectionKey\}/);
  assert.match(source, /getAnnotationSelectionKey/);
  assert.match(source, /effectiveSelectedId/);
  assert.match(source, /setSelectedId\(selectionKey\)/);
  assert.match(source, /effectiveSelectedId === selectionKey/);
  assert.match(source, /ring-2 ring-red-500/);
});

run("shared Citation Density coordinate utility normalizes PDF and viewport rectangles", () => {
  const pdfRect = buildPdfRectFromTopLeftAnchor(
    { x: 50, y: 92, width: 180, height: 10 },
    { pdfWidth: 612, pdfHeight: 792, rotation: 0 },
    2
  );
  const overlay = pdfRectToViewportRect(pdfRect, {
    width: 765,
    height: 990,
    pdfWidth: 612,
    pdfHeight: 792,
    rotation: 0,
  });
  const rotated = pdfRectToViewportRect(pdfRect, {
    width: 990,
    height: 765,
    pdfWidth: 612,
    pdfHeight: 792,
    rotation: 90,
  });

  assert.ok(pdfRect.xPct > 0 && pdfRect.xPct < 1);
  assert.ok(pdfRect.yPct > 0 && pdfRect.yPct < 1);
  assert.ok(overlay.left > 0);
  assert.ok(overlay.top > 0);
  assert.ok(Math.abs(overlay.top - pdfRect.y * 1.25) < 0.01);
  assert.notEqual(rotated.left, overlay.left);
});

run("annotated export uses persisted artifact id for download and metadata", () => {
  const routeSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/reports/citation-density/annotated-estimate/route.ts"),
    "utf8"
  );
  const pageSource = fs.readFileSync(path.join(process.cwd(), "src/components/ChatbotPage.tsx"), "utf8");

  assert.match(routeSource, /artifactId/);
  assert.match(routeSource, /metadata=1&artifactId=/);
  assert.match(routeSource, /This export is no longer available\. Regenerate Citation Density PDF\./);
  assert.match(fs.readFileSync(path.join(process.cwd(), "src/lib/reports/annotatedCitationDensityEstimate.ts"), "utf8"), /toSourcePdfPageIndex\(sourcePdfPageNumber\)/);
  assert.match(fs.readFileSync(path.join(process.cwd(), "src/lib/reports/annotatedCitationDensityEstimate.ts"), "utf8"), /sourcePdfPageNumber - 1/);
  assert.match(pageSource, /artifactId/);
  assert.match(pageSource, /fetchAnnotatedCitationDensityPdfBlob\(data\.downloadUrl\)/);
});

run("Ask about finding sends selected finding context into active chat", () => {
  const pageSource = fs.readFileSync(path.join(process.cwd(), "src/components/ChatbotPage.tsx"), "utf8");
  const widgetSource = fs.readFileSync(path.join(process.cwd(), "src/components/ChatWidget.tsx"), "utf8");

  assert.match(widgetSource, /sendPrompt:\s*\(prompt:\s*string\)\s*=>\s*Promise<void>/);
  assert.match(widgetSource, /handleSendRef\.current\s*=\s*handleSend/);
  assert.match(widgetSource, /sendPrompt:\s*\(prompt\)\s*=>\s*handleSendRef\.current\(prompt\)/);
  assert.match(pageSource, /Open or continue this case before asking about a finding\./);
  assert.match(pageSource, /Explain Citation Density finding #\$\{annotation\.findingId\}/);
  assert.match(pageSource, /Marker: \$\{annotation\.markerNumber\}/);
  assert.match(pageSource, /for \$\{sourceEstimate\}, page \$\{annotation\.pageNumber\}, line \$\{lineLabel\}/);
  assert.match(pageSource, /Finding id: \$\{annotation\.findingId\}/);
  assert.match(pageSource, /Source estimate: \$\{annotation\.sourceDocumentRole\}/);
  assert.match(pageSource, /Normalized target text: \$\{annotation\.targetNormalizedText\}/);
  assert.match(pageSource, /Why it matters: \$\{annotation\.whyItMatters\}/);
  assert.match(pageSource, /Best authority: \$\{annotation\.bestAuthority\}/);
  assert.match(pageSource, /chatSessionControlsRef\.current\.sendPrompt\(prompt\)/);
});

run("Citation Density annotated export cannot use generated report PDFs as source pages", () => {
  const generatedReport = pdfAttachment({
    id: "gap-report",
    filename: "citation-density-gap-report.pdf",
    text: "Citation Density Gap Report Annotation Legend Unanchored Citation Density Findings",
  });
  const estimate = pdfAttachment({
    id: "carrier-estimate",
    filename: "carrier-estimate.pdf",
    text: "Carrier estimate line 12 ADAS calibration net total $3,200.00",
  });

  assert.equal(isAnnotatableEstimatePdf(generatedReport), false);
  assert.equal(isAnnotatableEstimatePdf(estimate), true);

  const selected = resolveSourceEstimatePdf({
    attachments: [generatedReport, estimate],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "carrier",
    findings: [finding()],
  });

  assert.equal(selected.id, "carrier-estimate");
});

run("one uploaded estimate PDF is selected as the annotated source base", () => {
  const selected = resolveSourceEstimatePdf({
    attachments: [pdfAttachment({ id: "only-estimate", filename: "uploaded-estimate.pdf" })],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "selected",
    findings: [finding()],
  });

  assert.equal(selected.id, "only-estimate");
  assert.equal(describeReviewTarget(selected, "selected", [selected]), "Uploaded estimate");
});

run("carrier target selects carrier or lower-cost PDF over shop PDF", () => {
  const carrier = pdfAttachment({
    id: "carrier",
    filename: "Carrier Estimate.pdf",
    text: "Carrier insurance estimate lower cost estimate line 12 ADAS calibration",
  });
  const shop = pdfAttachment({
    id: "shop",
    filename: "Shop Estimate.pdf",
    text: "Shop repair facility estimate higher cost ADAS calibration",
  });

  const selected = resolveSourceEstimatePdf({
    attachments: [shop, carrier],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "carrier",
    findings: [finding()],
  });

  assert.equal(selected.id, "carrier");
});

run("auto target defaults to the lower estimate PDF in a two-estimate dispute", () => {
  const carrier = pdfAttachment({
    id: "carrier",
    filename: "Carrier Estimate.pdf",
    text: "Carrier insurance estimate lower cost total $3,200.00 ADAS calibration",
  });
  const shop = pdfAttachment({
    id: "shop",
    filename: "Shop Estimate.pdf",
    text: "Shop repair facility estimate higher cost total $7,600.00 ADAS calibration",
  });

  const selections = resolveSourceEstimatePdfSelections({
    attachments: [shop, carrier],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "auto",
    findings: [finding({ primaryAnnotationRole: "both", crossEstimateIssue: true })],
  });

  assert.equal(selections.length, 1);
  assert.equal(selections[0].attachment.id, "carrier");
  assert.equal(selections[0].selectedEstimateTotal, 3200);
  assert.match(selections[0].selectionReason, /lower estimate PDF/i);
});

run("carrier target avoids appraisal, academy, and higher-cost preliminary PDFs", () => {
  const carrier = pdfAttachment({
    id: "carrier",
    filename: "Insurer lower-cost estimate.pdf",
    text: "Insurer estimate lower cost total $3,200.00 ADAS calibration",
  });
  const appraisal = pdfAttachment({
    id: "appraisal",
    filename: "RTA appraisal report.pdf",
    text: "Collision Academy right to appraisal higher cost preliminary total $7,800.00",
  });
  const shop = pdfAttachment({
    id: "shop",
    filename: "Shop Estimate.pdf",
    text: "Shop repair facility estimate higher cost total $7,600.00 ADAS calibration",
  });

  const selection = resolveSourceEstimatePdfSelection({
    attachments: [appraisal, shop, carrier],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "carrier",
    findings: [finding()],
  });

  assert.equal(selection.attachment.id, "carrier");
  assert.equal(selection.selectedEstimateRole, "carrier");
  assert.equal(selection.selectedEstimateTotal, 3200);
  assert.match(selection.selectionReason, /carrier\/lower-cost estimate PDF/i);
});

run("shop target selects shop PDF when both carrier and shop estimates are uploaded", () => {
  const carrier = pdfAttachment({
    id: "carrier",
    filename: "Carrier Estimate.pdf",
    text: "Carrier insurance estimate lower cost total $3,200.00 ADAS calibration",
  });
  const shop = pdfAttachment({
    id: "shop",
    filename: "Shop Estimate.pdf",
    text: "Shop repair facility estimate higher cost total $7,600.00 ADAS calibration",
  });

  const selection = resolveSourceEstimatePdfSelection({
    attachments: [carrier, shop],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "shop",
    findings: [finding()],
  });

  assert.equal(selection.attachment.id, "shop");
  assert.equal(selection.selectedEstimateRole, "shop");
  assert.equal(selection.selectedEstimateTotal, 7600);
});

run("shop target treats RTA appraisal PDFs as shop-side estimates", () => {
  const carrier = pdfAttachment({
    id: "carrier",
    filename: "Carrier Estimate.pdf",
    text: "Carrier insurance estimate lower cost total $3,200.00 ADAS calibration",
  });
  const rta = pdfAttachment({
    id: "rta",
    filename: "RTA Appraisal Estimate.pdf",
    text: "Right to appraisal repair facility higher cost total $7,600.00 ADAS calibration",
  });

  const selection = resolveSourceEstimatePdfSelection({
    attachments: [carrier, rta],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "shop",
    findings: [finding()],
  });

  assert.equal(selection.attachment.id, "rta");
  assert.equal(selection.selectedEstimateRole, "shop");
});

run("both target returns carrier and shop source selections", () => {
  const carrier = pdfAttachment({
    id: "carrier",
    filename: "Carrier Estimate.pdf",
    text: "Carrier insurance estimate lower cost total $3,200.00 ADAS calibration",
  });
  const shop = pdfAttachment({
    id: "shop",
    filename: "Shop Estimate.pdf",
    text: "Shop repair facility estimate higher cost total $7,600.00 ADAS calibration",
  });

  const selections = resolveSourceEstimatePdfSelection({
    attachments: [carrier, shop],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "both",
    findings: [finding({ primaryAnnotationRole: "both", crossEstimateIssue: true })],
  });

  assert.equal(selections.selectedEstimateRole, "carrier");

  const bothSelections = resolveSourceEstimatePdfSelections({
    attachments: [carrier, shop],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "both",
    findings: [finding({ primaryAnnotationRole: "both", crossEstimateIssue: true })],
  });
  assert.deepEqual(bothSelections.map((selection) => selection.selectedEstimateRole).sort(), ["carrier", "shop"]);
});

run("missing source PDF returns clear user-facing missing-source message data", () => {
  const selected = resolveSourceEstimatePdf({
    attachments: [
      pdfAttachment({
        id: "text-only",
        filename: "notes.txt",
        type: "text/plain",
        text: "not a pdf",
        imageDataUrl: undefined,
      }),
    ],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "carrier",
    findings: [finding()],
  });

  assert.equal(selected, null);
  assert.equal(NO_SOURCE_PDF_ERROR, "No original estimate PDF was found for annotation.");
  assert.match(NO_SOURCE_PDF_USER_MESSAGE, /select or upload the estimate PDF/i);
});

run("authority priority model does not treat estimate parser, CCC, or internet fallback as verified authority", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/lib/ai/builders/estimateScrubberPdfBuilder.ts"), "utf8");

  assert.match(source, /function isReviewedAuthoritySource/);
  assert.match(source, /EstimateParser\|CCC\|BMS\|Mitchell\|Audatex/);
  assert.match(source, /source\.sourceType === "InternetOEM"\)\s+return false/);
  assert.match(source, /Estimate evidence identifies the dispute; it is not OEM, P-page, DEG, legal, policy, or completion authority/);
});
