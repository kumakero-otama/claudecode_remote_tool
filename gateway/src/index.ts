import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildMcpServer } from "./mcp.js";
import { bus, type BusEvent } from "./bus.js";

const MCP_PORT = Number(process.env.MCP_PORT ?? 8765);
const API_PORT = Number(process.env.API_PORT ?? 8766);
const MCP_TOKEN = required("MCP_TOKEN");
const API_TOKEN = required("GATEWAY_API_TOKEN");

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[gateway] FATAL: missing required env ${name}`);
    process.exit(1);
  }
  return v;
}

// Bearer トークンを検証するミドルウェア（タイミング非依存の単純比較で十分な用途）
function bearer(expected: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

/* ----------------------------- MCP server ----------------------------- */
// Claude Code セッションが Streamable HTTP で接続する。ホスト 127.0.0.1 のみに公開。
const mcpApp = express();
mcpApp.use(express.json({ limit: "4mb" }));

const transports: Record<string, StreamableHTTPServerTransport> = {};

mcpApp.post("/mcp", bearer(MCP_TOKEN), async (req, res) => {
  const sid = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sid && transports[sid]) {
    transport = transports[sid];
  } else if (!sid && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport;
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };
    const server = buildMcpServer();
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: no valid session ID provided" },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

const handleSessionReq = async (req: Request, res: Response) => {
  const sid = req.headers["mcp-session-id"] as string | undefined;
  if (!sid || !transports[sid]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sid].handleRequest(req, res);
};
mcpApp.get("/mcp", bearer(MCP_TOKEN), handleSessionReq);
mcpApp.delete("/mcp", bearer(MCP_TOKEN), handleSessionReq);

mcpApp.listen(MCP_PORT, () => {
  console.log(`[gateway] MCP (Streamable HTTP) listening on :${MCP_PORT}/mcp`);
});

/* ----------------------------- Web-facing API ----------------------------- */
// web コンテナ(BFF)からのみ docker network 経由でアクセスされる。Bearer 必須。
const api = express();
api.use(express.json({ limit: "1mb" }));
api.use(bearer(API_TOKEN));

api.get("/status", (_req, res) => {
  res.json(bus.status());
});

// Webアプリから指示を投入
api.post("/instruction", (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const from = typeof req.body?.from === "string" ? req.body.from : undefined;
  const channel = req.body?.channel === "task" ? "task" : req.body?.channel === "paper" ? "paper" : "exec";
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  const inst = bus.submitInstruction(text, from, channel);
  res.json({ id: inst.id });
});

// 応答・経過を SSE でストリーム配信
api.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`event: status\ndata: ${JSON.stringify(bus.status())}\n\n`);

  const listener = (e: BusEvent) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  bus.on("event", listener);

  const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 20_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    bus.off("event", listener);
  });
});

api.listen(API_PORT, () => {
  console.log(`[gateway] Web API listening on :${API_PORT}`);
});
