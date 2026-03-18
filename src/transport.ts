import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "./server.js";
import { config } from "./config.js";

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const secret = config.MCP_CLIENT_SECRET;
  if (!secret) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${secret}`) {
    next();
    return;
  }

  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized: invalid or missing client secret" },
    id: null,
  });
}

export async function startTransport() {
  const transportMode = process.env.MCP_TRANSPORT || "stdio";

  if (transportMode === "http") {
    const app = express();
    app.use(express.json());
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    // Apply auth to all /mcp routes
    app.use("/mcp", authMiddleware);

    app.post("/mcp", async (req, res) => {
      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
          transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              transports[sid] = transport;
            },
          });
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) {
              delete transports[sid];
            }
          };
          const sessionServer = createServer();
          await sessionServer.connect(transport);
        } else {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: No valid session ID" },
            id: null,
          });
          return;
        }

        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error("Error handling POST /mcp:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: `Internal error: ${error}` },
            id: null,
          });
        }
      }
    });

    app.get("/mcp", async (req, res) => {
      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
          res.status(400).send("Invalid or missing session ID");
          return;
        }
        await transports[sessionId].handleRequest(req, res);
      } catch (error) {
        console.error("Error handling GET /mcp:", error);
        if (!res.headersSent) {
          res.status(500).send("Internal Server Error");
        }
      }
    });

    app.delete("/mcp", async (req, res) => {
      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
          res.status(400).send("Invalid or missing session ID");
          return;
        }
        await transports[sessionId].handleRequest(req, res);
      } catch (error) {
        console.error("Error handling DELETE /mcp:", error);
        if (!res.headersSent) {
          res.status(500).send("Internal Server Error");
        }
      }
    });

    // Root and health check endpoints (needed for EasyPanel/Docker health checks)
    app.get("/", (_req, res) => {
      res.json({ status: "ok", service: "MCP-Discord", endpoint: "/mcp" });
    });

    app.get("/health", (_req, res) => {
      res.json({ status: "ok" });
    });

    const port = parseInt(process.env.PORT || "3000", 10);
    app.listen(port, "0.0.0.0", () => {
      console.log(`MCP Streamable HTTP server running on 0.0.0.0:${port}`);
      console.log(`Endpoint: http://localhost:${port}/mcp`);
    });
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

// Prevent unhandled errors from crashing the process
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
process.on("SIGTERM", () => {
  console.log("Received SIGTERM signal — keeping server alive");
});
process.on("SIGINT", () => {
  console.log("Received SIGINT signal");
  process.exit(0);
});
