import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type McpToolResult = unknown;

export type McpBridge = {
  client: Client;
  proc: ChildProcessWithoutNullStreams;
  close: () => Promise<void>;
};

function getMcpCwd() {
  return path.join(process.cwd(), "my-mcp-server");
}

/**
 * Starts the MCP server over stdio and returns an MCP client bridge.
 * One bridge per request is the simplest + safest default.
 */
export async function createMcpBridge(): Promise<McpBridge> {
  const cwd = getMcpCwd();

  // Spawn MCP server via npx tsx for dev.
  // IMPORTANT: no shell:true (safer, more predictable).
  const proc = spawn("npx", ["tsx", "server.ts"], {
    cwd,
    stdio: "pipe",
    env: process.env,
  });

  proc.on("exit", (code, signal) => {
    console.log("[MCP] exited", { code, signal });
  });

  proc.stderr.on("data", (d) => {
    // Keep server logs for debugging
    console.error("[MCP] stderr:", d.toString());
  });

  // Depending on MCP SDK version, StdioClientTransport supports either:
  // 1) { process: proc }  OR
  // 2) { command, args, cwd }
  //
  // This form works on the commonly shipped variants:
  const transport = new StdioClientTransport({ process: proc } as any);

  const client = new Client(
    { name: "collision-iq-nextjs", version: "0.1.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  return {
    client,
    proc,
    close: async () => {
      try {
        await client.close();
      } catch {
        // ignore
      }
      try {
        proc.kill();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Convenience helper for one-shot tool calls (spawns MCP, calls tool, closes).
 * Use this when you only need one tool call.
 */
export async function mcpCallTool(opts: {
  toolName: string;
  args?: Record<string, any>;
  timeoutMs?: number;
}): Promise<McpToolResult> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const mcp = await createMcpBridge();

  const timeout = new Promise<never>((_, reject) => {
    const t = setTimeout(() => {
      try {
        mcp.proc.kill();
      } catch {}
      reject(new Error(`MCP tool call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (timeout as any).finally?.(() => clearTimeout(t));
  });

  try {
    const call = mcp.client.callTool({
      name: opts.toolName,
      arguments: opts.args ?? {},
    });

    return await Promise.race([call as any, timeout]);
  } finally {
    await mcp.close();
  }
}
