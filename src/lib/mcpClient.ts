import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type McpBridge = {
  client: Client;
  proc: ChildProcessWithoutNullStreams;
  close: () => Promise<void>;
};

function getMcpCwd() {
  // sibling folder at app root: /my-mcp-server
  return path.join(process.cwd(), "my-mcp-server");
}

/**
 * Start MCP server (stdio) + connect MCP client.
 * Per-request is safest (no shared state). Optimize later if needed.
 */
export async function createMcpBridge(): Promise<McpBridge> {
  const cwd = getMcpCwd();

  const proc = spawn("npx", ["tsx", "server.ts"], {
    cwd,
    stdio: "pipe",
    env: process.env,
  });

  proc.stderr.on("data", (d) => {
    // MCP logs for debugging
    console.error("[MCP] stderr:", d.toString());
  });

  proc.on("exit", (code, signal) => {
    console.log("[MCP] exit", { code, signal });
  });

  // SDK versions vary; this form works for many releases.
  // If your TS complains, switch to: new StdioClientTransport({ command:"npx", args:["tsx","server.ts"], cwd })
  const transport = new StdioClientTransport(
    { process: proc } as unknown as ConstructorParameters<typeof StdioClientTransport>[0]
  );

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
      } catch {}
      try {
        proc.kill();
      } catch {}
    },
  };
}
