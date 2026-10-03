/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key";

function requireTs(modulePath) {
  const fullPath = path.resolve(modulePath);
  const source = fs.readFileSync(fullPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      allowJs: true,
      baseUrl: path.resolve("."),
      paths: {
        "@/*": ["src/*"],
      },
    },
    fileName: fullPath,
  }).outputText;
  const module = { exports: {} };
  const dirname = path.dirname(fullPath);
  const localRequire = (specifier) => {
    if (specifier === "server-only") {
      return {};
    }
    if (specifier.startsWith("@/")) {
      const resolvedBase = path.resolve("src", specifier.slice(2));
      const candidates = [
        resolvedBase,
        `${resolvedBase}.ts`,
        `${resolvedBase}.js`,
        path.join(resolvedBase, "index.ts"),
        path.join(resolvedBase, "index.js"),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          if (candidate.endsWith(".ts")) return requireTs(candidate);
          return require(candidate);
        }
      }
    }
    if (specifier.startsWith(".")) {
      const resolvedBase = path.resolve(dirname, specifier);
      const candidates = [
        resolvedBase,
        `${resolvedBase}.ts`,
        `${resolvedBase}.js`,
        path.join(resolvedBase, "index.ts"),
        path.join(resolvedBase, "index.js"),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          if (candidate.endsWith(".ts")) return requireTs(candidate);
          return require(candidate);
        }
      }
    }
    return require(specifier);
  };
  const script = new vm.Script(transpiled, { filename: fullPath });
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: localRequire,
    __dirname: dirname,
    __filename: fullPath,
    console,
    process,
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  script.runInContext(context);
  return module.exports;
}

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function runAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const { buildSupplementLines } = requireTs("src/lib/ai/builders/supplementBuilder.ts");
const { generateNegotiationResponse } = requireTs("src/lib/ai/builders/negotiationEngine.ts");
const {
  enrichAnalysisAttachments,
  extractDriveUrls,
  extractDriveFileId,
  extractEgnyteUrls,
  extractEgnytePathFromUrl,
} = requireTs("src/lib/ai/analysisAttachmentService.ts");

// Linked-document enrichment only runs when Google Drive ingestion is switched
// on (isDriveEnabled reads GOOGLE_DRIVE_ENABLED at call time). Set it for the
// duration of one test so the result never depends on the host environment.
async function withDriveEnabled(fn) {
  const previous = process.env.GOOGLE_DRIVE_ENABLED;
  process.env.GOOGLE_DRIVE_ENABLED = "true";
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_DRIVE_ENABLED;
    else process.env.GOOGLE_DRIVE_ENABLED = previous;
  }
}

function makeStructuralReport(overrides = {}) {
  return {
    summary: {
      riskScore: "moderate",
      confidence: "high",
      criticalIssues: 1,
      evidenceQuality: "moderate",
    },
    vehicle: {
      year: 2018,
      make: "Tesla",
      model: "Model S",
      trim: "75D AWD",
      vin: "5YJSA1E21JF264319",
      source: "attachment",
      confidence: 0.95,
    },
    issues: [],
    requiredProcedures: [],
    presentProcedures: [],
    missingProcedures: [
      "Structural Measurement Verification",
      "Structural Setup and Pull Verification",
    ],
    supplementOpportunities: [
      "Front Structure Scope / Tie Bar / Upper Rail Reconciliation",
    ],
    evidence: [
      {
        id: "e1",
        title: "Estimate",
        snippet:
          "Front bumper reinforcement and upper tie bar replacement. Measure front-end geometry after support replacement. No frame pull shown.",
        source: "estimate.pdf",
        authority: "inferred",
      },
    ],
    recommendedActions: [],
    sourceEstimateText:
      "2018 TESL Model S 75D AWD. Upper tie bar and radiator support replacement. Dimensional verification recommended after support replacement.",
    estimateFacts: {
      documentedProcedures: [],
      documentedHighlights: [],
    },
    ...overrides,
  };
}

run("structural gating keeps measurement without escalating to pull/setup", () => {
  const lines = buildSupplementLines(makeStructuralReport());
  const titles = lines.map((line) => line.title);

  assert.equal(titles.includes("Structural Measurement Verification"), true);
  assert.equal(titles.includes("Structural Setup and Pull Verification"), false);
});

run("aluminum-sensitive scenario does not default to pull language without support", () => {
  const lines = buildSupplementLines(
    makeStructuralReport({
      sourceEstimateText:
        "2018 TESL Model S 75D AWD aluminum front support replacement. Measure geometry and fit after tie bar replacement.",
      requiredProcedures: [
        {
          procedure: "Structural Measurement Verification",
          reason: "Dimensional confirmation after support replacement.",
          source: "oem_doc",
          severity: "high",
        },
      ],
    })
  );
  const titles = lines.map((line) => line.title);

  assert.equal(titles.includes("Structural Measurement Verification"), true);
  assert.equal(titles.includes("Structural Setup and Pull Verification"), false);
});

run("negotiation output does not reintroduce unsupported structural pull asks", () => {
  const response = generateNegotiationResponse(makeStructuralReport());

  assert.equal(/Structural Setup and Pull Verification/i.test(response), false);
  assert.equal(/Structural Measurement Verification/i.test(response), true);
});

run("proactive OEM-backed hardware guidance survives partial estimate hints", () => {
  const lines = buildSupplementLines(
    makeStructuralReport({
      evidence: [
        {
          id: "e2",
          title: "OEM note",
          snippet:
            "Front bumper removal disturbed clips and seals around the repair area, but the estimate does not show replacement hardware documentation.",
          source: "estimate.pdf",
          authority: "inferred",
        },
      ],
      missingProcedures: [],
      supplementOpportunities: [
        "OEM support in Tesla Model S Front Bumper Procedure.pdf indicates one-time-use hardware, seals, or clips may already be implicated, but the replacement and related documentation posture remains open.",
      ],
    })
  );

  assert.equal(
    lines.some((line) => line.title === "One-Time-Use Hardware / Seals / Clips"),
    true
  );
});

runAsync("Drive-linked documents are detected and incorporated into the analysis corpus", async () => {
  let fetchedFileId = null;
  const attachments = await withDriveEnabled(() =>
    enrichAnalysisAttachments({
      attachments: [
        {
          id: "a1",
          filename: "estimate.txt",
          type: "text/plain",
          text: "Supporting document: https://drive.google.com/file/d/1VehicleNotesId/view?usp=sharing",
        },
      ],
      deps: {
        downloadLinkedFile: async (fileId) => {
          fetchedFileId = fileId;
          return Buffer.from("Vehicle-specific Drive notes\nFront-right support replacement only.");
        },
      },
    })
  );

  assert.equal(fetchedFileId, "1VehicleNotesId");
  assert.equal(attachments.length, 2);
  const linked = attachments[1];
  assert.equal(linked.id, "drive:1:1VehicleNotesId");
  assert.equal(linked.filename, "drive-linked-1");
  assert.match(linked.text, /Drive-linked document source: 1VehicleNotesId/);
  assert.match(linked.text, /Provenance: Drive-linked external document/);
});

runAsync("image uploads contribute structured image observations", async () => {
  const attachments = await enrichAnalysisAttachments({
    attachments: [
      {
        id: "img1",
        filename: "damage-photo.jpg",
        type: "image/jpeg",
        text: "",
        imageDataUrl: "data:image/jpeg;base64,ZmFrZQ==",
      },
    ],
    deps: {
      summarizeImageAttachment: async () =>
        "Document type: damage photo\nVisible damage zones: front right\nStructural cues: none visible",
    },
  });

  assert.match(attachments[0].text, /Document type: damage photo/);
  assert.match(attachments[0].text, /Visible damage zones: front right/);
});

runAsync("PDF attachments pass through normalization with their extracted text unchanged", async () => {
  let pdfSummarizerCalled = false;
  const attachments = await enrichAnalysisAttachments({
    attachments: [
      {
        id: "pdf1",
        filename: "estimate.pdf",
        type: "application/pdf",
        text: "Sparse extracted text",
        imageDataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
        pageCount: 4,
      },
    ],
    deps: {
      // No longer part of AttachmentVisionDeps; must never be consulted.
      summarizePdfAttachment: async () => {
        pdfSummarizerCalled = true;
        return "Key visible estimate facts: total 19428.53";
      },
    },
  });

  assert.equal(pdfSummarizerCalled, false);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].text, "Sparse extracted text");
  assert.equal(attachments[0].pageCount, 4);
});

run("Drive URL helpers extract Google Drive links and file ids (Egnyte aliases follow)", () => {
  const urls = extractDriveUrls(
    "See https://drive.google.com/file/d/1AbC_dEf-123/view?usp=sharing and https://docs.google.com/document/d/2XyZ987/edit plus https://acme.egnyte.com/dl/Claims/Shop%2021733.pdf"
  );

  // Spread into this realm's Array: the module runs in its own vm context.
  assert.deepEqual([...urls], [
    "https://drive.google.com/file/d/1AbC_dEf-123/view?usp=sharing",
    "https://docs.google.com/document/d/2XyZ987/edit",
  ]);
  assert.equal(extractDriveFileId("https://drive.google.com/file/d/1AbC_dEf-123/view?usp=sharing"), "1AbC_dEf-123");
  assert.equal(extractDriveFileId("https://docs.google.com/document/d/2XyZ987/edit"), "2XyZ987");
  assert.equal(extractDriveFileId("https://drive.google.com/open?id=3OpenId"), "3OpenId");
  assert.equal(extractDriveFileId("https://acme.egnyte.com/dl/Claims/Shop%2021733.pdf"), null);
  // Backward-compatible export names kept by 82206a2 resolve to the Drive helpers.
  assert.equal(extractEgnyteUrls, extractDriveUrls);
  assert.equal(extractEgnytePathFromUrl, extractDriveFileId);
});
