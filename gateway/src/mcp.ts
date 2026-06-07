import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bus } from "./bus.js";

const DEFAULT_TIMEOUT = Number(process.env.INSTRUCTION_TIMEOUT_MS ?? 25_000);

/**
 * Claude Code セッションが接続する MCP サーバを構築する。
 * セッションはこれらのツールをループ呼び出しして「リモートワーカー」として振る舞う。
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "claudecode-remote-gateway",
    version: "0.1.0",
  });

  server.registerTool(
    "wait_for_instruction",
    {
      title: "Wait for the next remote instruction",
      description:
        "Long-poll for the next instruction on a channel. Blocks up to timeout_ms (default 25s). " +
        "channel: 'exec' (general Claude chat), 'task' (task-list editing only), or 'paper' (paper explanation editing only). " +
        "Returns JSON {instruction_id, text} when an instruction arrives, or NO_INSTRUCTION on timeout. " +
        "On timeout, simply call this tool again to keep listening.",
      inputSchema: {
        timeout_ms: z.number().int().min(1000).max(60_000).optional(),
        channel: z.enum(["exec", "task", "paper"]).optional(),
      },
    },
    async ({ timeout_ms, channel }) => {
      const inst = await bus.waitForInstruction(channel ?? "exec", timeout_ms ?? DEFAULT_TIMEOUT);
      if (!inst) {
        return {
          content: [
            {
              type: "text",
              text: "NO_INSTRUCTION (timeout). No new instruction yet — call wait_for_instruction again to keep listening.",
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ instruction_id: inst.id, text: inst.text }) }],
      };
    }
  );

  server.registerTool(
    "send_response",
    {
      title: "Send a response back to the web app",
      description:
        "Send your reply/result for an instruction back to the web app user. " +
        "Set done=true when the task for this instruction is complete (default true).",
      inputSchema: {
        text: z.string(),
        instruction_id: z.string().optional(),
        done: z.boolean().optional(),
      },
    },
    async ({ text, instruction_id, done }) => {
      bus.sendResponse(instruction_id ?? null, text, done ?? true);
      return { content: [{ type: "text", text: "delivered" }] };
    }
  );

  server.registerTool(
    "push_progress",
    {
      title: "Push an intermediate progress update",
      description: "Send an intermediate progress note to the web app while still working on the instruction.",
      inputSchema: {
        text: z.string(),
        instruction_id: z.string().optional(),
      },
    },
    async ({ text, instruction_id }) => {
      bus.pushProgress(instruction_id ?? null, text);
      return { content: [{ type: "text", text: "ok" }] };
    }
  );

  return server;
}
