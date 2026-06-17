import "server-only";

import fs from "node:fs";
import { spawn } from "node:child_process";
import { collisionIqModels, collisionIqProvider } from "@/lib/modelConfig";

const WINDOWS_OPENCLAW_NODE =
  "C:\\Users\\Colli\\AppData\\Local\\OpenClaw\\deps\\portable-node\\node.exe";
const WINDOWS_OPENCLAW_CLI =
  "C:\\Users\\Colli\\AppData\\Local\\OpenClaw\\deps\\portable-node\\node_modules\\openclaw\\openclaw.mjs";

export async function generateOpenClawText(params: {
  instructions?: string;
  input: unknown;
}): Promise<{ output_text: string; model: string }> {
  const model = collisionIqModels.openclawPrimary;
  const agentId = process.env.OPENCLAW_AGENT_ID?.trim() || "main";
  const compiledPrompt = compileOpenClawPrompt(params.instructions, params.input);
  const output = await runOpenClawAgent(agentId, compiledPrompt);

  return {
    output_text: sanitizeOpenClawOutput(output.stdout),
    model,
  };
}

function compileOpenClawPrompt(instructions: string | undefined, input: unknown) {
  return `Instructions:
${instructions?.trim() || ""}

Personalization:
Do not use developer/operator names, local account names, Windows usernames, or OpenClaw account names. Address the end user only if the authenticated profile supplies a display name in the application context; otherwise use neutral language like "Hi there" or no greeting.

Input:
${stringifyInput(input)}`;
}

function stringifyInput(input: unknown) {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function runOpenClawAgent(agentId: string, compiledPrompt: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const command = resolveOpenClawCommand();
    const args = [
      command.entryJs,
      "agent",
      "--agent",
      agentId,
      "--message",
      compiledPrompt,
    ];
    logOpenClawSpawn(command.command, args);
    const child = spawn(
      command.command,
      args,
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, collisionIqProvider.openclawTimeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(Object.assign(new Error(`OpenClaw process failed to start using ${command.description}: ${error.message}. Check that the executable exists at ${command.command} and the CLI script exists at ${command.entryJs}.`), {
        code: "openclaw_process_start_failed",
        provider: "openclaw",
        command: command.command,
        args: redactOpenClawArgs(args),
      }));
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject(Object.assign(
          new Error(`OpenClaw process timed out after ${collisionIqProvider.openclawTimeoutMs}ms.`),
          {
            code: "openclaw_process_timeout",
            provider: "openclaw",
            stdout: stdout.slice(0, 500),
            stderr: stderr.slice(0, 500),
          }
        ));
        return;
      }

      if (code !== 0) {
        reject(Object.assign(
          new Error(
            `OpenClaw process failed (${signal ? `signal ${signal}` : `exit ${code}`}): ${stderr.slice(0, 500) || stdout.slice(0, 500)}`
          ),
          {
            status: code,
            statusCode: code,
            code: "openclaw_process_failed",
            provider: "openclaw",
            stdout: stdout.slice(0, 500),
            stderr: stderr.slice(0, 500),
          }
        ));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function resolveOpenClawCommand() {
  const configuredPath = process.env.OPENCLAW_CLI_PATH?.trim();
  if (configuredPath) {
    return {
      command: configuredPath,
      entryJs: WINDOWS_OPENCLAW_CLI,
      description: `OPENCLAW_CLI_PATH (${configuredPath}) with OpenClaw entry (${WINDOWS_OPENCLAW_CLI})`,
    };
  }

  if (process.platform === "win32") {
    return {
      command: WINDOWS_OPENCLAW_NODE,
      entryJs: WINDOWS_OPENCLAW_CLI,
      description: `portable OpenClaw Node (${WINDOWS_OPENCLAW_NODE})`,
    };
  }

  return {
    command: "node",
    entryJs: "openclaw",
    description: `"node openclaw" on PATH`,
  };
}

export function getOpenClawAvailability() {
  const command = resolveOpenClawCommand();
  const commandExists = isExecutableAvailable(command.command);
  const entryExists = fs.existsSync(/* turbopackIgnore: true */ command.entryJs);
  return {
    available: commandExists && entryExists,
    command: command.command,
    entryJs: command.entryJs,
    description: command.description,
    reason: commandExists
      ? entryExists
        ? undefined
        : `OpenClaw CLI script is missing at ${command.entryJs}.`
      : `OpenClaw executable is missing or not executable at ${command.command}.`,
  };
}

function isExecutableAvailable(command: string) {
  if (command === "node") return true;
  try {
    fs.accessSync(/* turbopackIgnore: true */ command, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function logOpenClawSpawn(command: string, args: string[]) {
  console.info("[openclaw] spawning CLI", {
    command,
    args: redactOpenClawArgs(args),
  });
}

function redactOpenClawArgs(args: string[]) {
  return args.map((arg, index) => {
    if (args[index - 1] !== "--message") return arg;
    return `${arg.slice(0, 80)}${arg.length > 80 ? "...[truncated]" : ""}`;
  });
}

function sanitizeOpenClawOutput(text: string): string {
  const cleaned = text
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .filter((line) => !isOpenClawInternalLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return sanitizePersonalizationLeak(cleaned);
}

function sanitizePersonalizationLeak(text: string, authenticatedFirstName?: string): string {
  const blockedNames = ["vinny", "colli", process.env.USERNAME || ""]
    .map((name) => name.trim())
    .filter(Boolean);

  return blockedNames
    .reduce((output, name) => {
      if (isAllowedFirstName(name, authenticatedFirstName)) return output;
      const escapedName = escapeRegExp(name);
      return output
        .replace(
          new RegExp(`^\\s*(?:hey|hi|hello)\\s+${escapedName}[,.!]\\s*`, "i"),
          "Hi there. "
        )
        .replace(new RegExp(`^\\s*${escapedName}[,.!]\\s*`, "i"), "");
    }, text)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isAllowedFirstName(name: string, authenticatedFirstName?: string) {
  return authenticatedFirstName?.trim().toLowerCase() === name;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isOpenClawInternalLine(line: string) {
  const trimmed = line.trim();
  return (
    /^\[agents\/tool-policy\].*$/i.test(trimmed) ||
    /^agents\/tool-policy.*$/i.test(trimmed) ||
    /tool policy removed .* tool\(s\).*tools\.profile/i.test(trimmed) ||
    /^tools\.profile\b/i.test(trimmed) ||
    /^\[plugins\].*$/i.test(trimmed) ||
    /^gateway connect failed:/i.test(trimmed) ||
    /^embedded fallback:/i.test(trimmed) ||
    /^gateway target:/i.test(trimmed) ||
    /^source:/i.test(trimmed) ||
    /^config:/i.test(trimmed) ||
    /^bind:/i.test(trimmed) ||
    /^\[agent\/embedded\].*$/i.test(trimmed) ||
    isOpenClawLogLine(trimmed)
  );
}

function isOpenClawLogLine(line: string) {
  const trimmed = line.trim();
  return (
    /^openclaw\b/i.test(trimmed) ||
    /^\[openclaw\]/i.test(trimmed) ||
    /^using agent\b/i.test(trimmed) ||
    /^agent:\s/i.test(trimmed) ||
    /^model:\s/i.test(trimmed)
  );
}
