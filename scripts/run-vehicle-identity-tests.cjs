const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, ".tmp", "vehicle-identity-tests");
const testEntry = path.join("src", "lib", "ai", "__tests__", "vehicleIdentity.contract.test.ts");
const tscBin = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

cp.execFileSync(
  process.execPath,
  [
    tscBin,
    "--pretty",
    "false",
    "--target",
    "es2022",
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--resolveJsonModule",
    "--esModuleInterop",
    "--skipLibCheck",
    "--outDir",
    outDir,
    testEntry,
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
  }
);

cp.execFileSync(
  process.execPath,
  [path.join(outDir, "__tests__", "vehicleIdentity.contract.test.js")],
  {
    cwd: repoRoot,
    stdio: "inherit",
  }
);
