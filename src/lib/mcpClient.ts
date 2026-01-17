import { spawn } from "node:child_process";
import path from "node:path";

// Minimal JSON-RPC over stdio client for MCP servers
type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: any;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string;
  result?: any;
  error?: any;
};

function makeId() {
  return Math.random().toString(36).slice(2);
}

export async function mcpCallTool(opts: {
  toolName: string;
  args?: Record<string, any>;
}) {
  // Adjust path if your MCP server file name differs
  const mcpServerPath = path.join(process.cwd(), "my-mcp-server", "server.ts");

  // Use tsx to run the MCP server in dev. (In prod, you'll run build/index.js)
  const child = spawn("npx", ["tsx", mcpServerPath], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });

  const send = (req: JsonRpcRequest) => {
    child.stdin.write(JSON.stringify(req) + "\n");
  };

  const readJsonLines = async (): Promise<JsonRpcResponse[]> => {
    return new Promise((resolve, reject) => {
      const responses: JsonRpcResponse[] = [];
      let buffer = "";

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            responses.push(parsed);
          } catch (e) {
            // ignore non-json lines
          }
        }
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("MCP server timed out waiting for response"));
      }, 8000);

      const cleanup = () => {
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        child.stderr.off("data", onErr);
      };

      const onErr = (chunk: Buffer) => {
        // stderr is useful if MCP fails
        // but don't reject immediately because some libs print warnings
      };

      child.stdout.on("data", onData);
      child.stderr.on("data", onErr);

      // Resolve when we receive a response for our request id
      const poll = setInterval(() => {
        // We'll stop after we see a "tools/call" response
        const hasToolCallResult = responses.some((r) => r.result || r.error);
        if (hasToolCallResult) {
          clearInterval(poll);
          cleanup();
          resolve(responses);
        }
      }, 50);
    });
  };

  // 1) Ask for tools/list (optional sanity)
  const id1 = makeId();
  send({ jsonrpc: "2.0", id: id1, method: "tools/list" });

  // 2) Call tool
  const id2 = makeId();
  send({
    jsonrpc: "2.0",
    id: id2,
    method: "tools/call",
    params: {
      name: opts.toolName,
      arguments: opts.args ?? {},
    },
  });

  const responses = await readJsonLines();

  // Close the child process
  child.kill();

  const toolResponse = responses.find((r) => r.id === id2);
  if (!toolResponse) throw new Error("No MCP tool response received");

  if (toolResponse.error) {
    throw new Error(
      typeof toolResponse.error?.message === "string"
        ? toolResponse.error.message
        : "MCP tool call failed"
    );
  }

  return toolResponse.result;
}
