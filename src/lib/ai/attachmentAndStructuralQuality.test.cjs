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
const { enrichAnalysisAttachments, extractEgnyteUrls, extractEgnytePathFromUrl } = requireTs(
  "src/lib/ai/analysisAttachmentService.ts"
);

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

runAsync("Egnyte linked documents are detected and incorporated into the analysis corpus", async () => {
  let fetchedPath = null;
  const attachments = await enrichAnalysisAttachments({
    attachments: [
      {
        id: "a1",
        filename: "estimate.txt",
        type: "text/plain",
        text: "Supporting document: https://acme.egnyte.com/dl/folder/vehicle-notes.txt",
      },
    ],
    deps: {
      downloadLinkedFile: async (pathValue) => {
        fetchedPath = pathValue;
        return Buffer.from("Vehicle-specific Egnyte notes\nFront-right support replacement only.");
      },
    },
  });

  assert.equal(fetchedPath, "/folder/vehicle-notes.txt");
  assert.equal(attachments.some((attachment) => attachment.filename === "vehicle-notes.txt"), true);
  assert.equal(
    attachments.some((attachment) => /Egnyte linked document/i.test(attachment.text)),
    true
  );
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

runAsync("PDF vision observations contribute when PDF file payload is available", async () => {
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
      summarizePdfAttachment: async () =>
        "Document type: estimate pdf\nKey visible estimate facts: total 19428.53\nVisible damage/photo observations: front-right damage photos present",
    },
  });

  assert.match(attachments[0].text, /Key visible estimate facts: total 19428\.53/);
  assert.match(attachments[0].text, /front-right damage photos present/);
});

run("Egnyte URL helpers normalize expected paths", () => {
  const urls = extractEgnyteUrls(
    "See https://acme.egnyte.com/dl/Claims/Shop%2021733.pdf and https://acme.egnyte.com/#path=/Claims/Notes.txt"
  );

  assert.equal(urls.length, 2);
  assert.equal(
    extractEgnytePathFromUrl("https://acme.egnyte.com/dl/Claims/Shop%2021733.pdf"),
    "/Claims/Shop 21733.pdf"
  );
  assert.equal(
    extractEgnytePathFromUrl("https://acme.egnyte.com/#path=/Claims/Notes.txt"),
    "/Claims/Notes.txt"
  );
});
