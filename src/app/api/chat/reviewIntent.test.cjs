/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// The chat-intent helpers are module-private and dependency-free helpers
// inside the Next.js route handler. Importing route.ts would pull in db/auth/
// billing/next-server at module load, so instead we extract just those functions
// from source, transpile it, and exercise the real regex in isolation.
function loadClassifier() {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "api", "chat", "route.ts"),
    "utf8"
  );
  const match = source.match(/type ChatIntent[\s\S]*?function isReviewOrEstimateAnalysisIntent[\s\S]*?\n}/);
  if (!match) {
    throw new Error("Could not locate chat intent helpers in route.ts");
  }
  const compiled = ts.transpileModule(
    `${match[0]}\nmodule.exports = { classifyChatIntent, isReviewOrEstimateAnalysisIntent };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }
  );
  const moduleShim = { exports: {} };
  new Function("module", "exports", compiled.outputText)(
    moduleShim,
    moduleShim.exports
  );
  return moduleShim.exports;
}

const { classifyChatIntent, isReviewOrEstimateAnalysisIntent } = loadClassifier();

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("returns TRUE for actionable requests to act on files/an upload", () => {
  const actionable = [
    "review my estimate",
    "analyze these files",
    "go over the attached PDF",
    "can you look at what I just sent",
  ];
  for (const message of actionable) {
    assert.equal(
      isReviewOrEstimateAnalysisIntent(message),
      true,
      `expected actionable intent for: ${message}`
    );
  }
});

run("classifies pasted appraisal policy language as policy text review", () => {
  const message = [
    "If we and you do not agree on the amount of loss, then we and you may agree to an appraisal of the loss.",
    "Each party will select a competent appraiser and the two appraisers will select an umpire.",
    "A written decision agreed to by any two will be binding.",
    "",
    "Review the policy language regarding the RTA and provide instructions please.",
  ].join("\n");

  assert.equal(classifyChatIntent(message), "pasted_text_policy_review");
  assert.equal(isReviewOrEstimateAnalysisIntent(message), false);
});

run("classifies general chat as general_chat", () => {
  assert.equal(
    classifyChatIntent("What does right to appraisal usually mean in an auto claim?"),
    "general_chat"
  );
});

run("classifies attached estimate requests as estimate-file review", () => {
  assert.equal(classifyChatIntent("Analyze the attached estimate."), "estimate_file_review");
  assert.equal(isReviewOrEstimateAnalysisIntent("Analyze the attached estimate."), true);
});

run("classifies mixed policy text and estimate-file requests separately", () => {
  const message = [
    "If we and you do not agree on the amount of loss, each party will select an appraiser.",
    "Review this policy clause and then analyze the attached estimates.",
  ].join("\n");

  assert.equal(classifyChatIntent(message), "mixed_policy_and_estimate_file_review");
  assert.equal(isReviewOrEstimateAnalysisIntent(message), false);
});

run("classifies Citation Density requests outside estimate-file waiting guard", () => {
  assert.equal(
    classifyChatIntent("Generate a Citation Density report."),
    "citation_density_request"
  );
  assert.equal(isReviewOrEstimateAnalysisIntent("Generate a Citation Density report."), false);
});

run("returns FALSE for pure questions with no act-on-files intent", () => {
  const questions = [
    "explain this appraisal clause",
    "this is not an appraisal review, just a question",
    "what is the right to appraisal",
    "does PA require the carrier to negotiate",
  ];
  for (const message of questions) {
    assert.equal(
      isReviewOrEstimateAnalysisIntent(message),
      false,
      `expected non-actionable for: ${message}`
    );
  }
});

run("returns FALSE for a bare domain noun in isolation", () => {
  const bareNouns = [
    "appraisal",
    "claim",
    "carrier",
    "shop",
    "repair",
    "estimate",
    "supplement",
    "invoice",
    "photo",
    "zip",
    "work auth",
    "citation density",
  ];
  for (const noun of bareNouns) {
    assert.equal(
      isReviewOrEstimateAnalysisIntent(noun),
      false,
      `bare noun must not trigger review intent: ${noun}`
    );
  }
});
