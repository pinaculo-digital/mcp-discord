import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response, NextFunction } from "express";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "./server.js";
import { config } from "./config.js";

// In-memory token store
const validTokens = new Set<string>();

function generateAccessToken(clientId: string, clientSecret: string): string {
  return createHash("sha256").update(`${clientId}:${clientSecret}:${randomUUID()}`).digest("hex");
}

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!config.MCP_CLIENT_SECRET) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: missing Bearer token" },
      id: null,
    });
    return;
  }

  const token = authHeader.slice(7);
  if (validTokens.has(token)) {
    next();
    return;
  }

  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized: invalid token" },
    id: null,
  });
}

export async function startTransport() {
  const transportMode = process.env.MCP_TRANSPORT || "stdio";

  if (transportMode === "http") {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    // OAuth2 metadata discovery
    app.get("/.well-known/oauth-authorization-server", (_req, res) => {
      const baseUrl = `${_req.protocol}://${_req.get("host")}`;
      res.json({
        issuer: baseUrl,
        token_endpoint: `${baseUrl}/oauth/token`,
        token_endpoint_auth_methods_supported: ["client_secret_post"],
        grant_types_supported: ["client_credentials"],
        response_types_supported: ["token"],
      });
    });

    // OAuth2 token endpoint (client credentials grant)
    app.post("/oauth/token", (req, res) => {
      const grantType = req.body.grant_type;
      const clientId = req.body.client_id;
      const clientSecret = req.body.client_secret;

      if (grantType !== "client_credentials") {
        res.status(400).json({ error: "unsupported_grant_type" });
        return;
      }

      if (!clientId || !clientSecret) {
        res.status(400).json({ error: "invalid_request", error_description: "client_id and client_secret are required" });
        return;
      }

      if (clientId !== config.MCP_CLIENT_ID || clientSecret !== config.MCP_CLIENT_SECRET) {
        res.status(401).json({ error: "invalid_client" });
        return;
      }

      const accessToken = generateAccessToken(clientId, clientSecret);
      validTokens.add(accessToken);

      console.log("OAuth2 token issued for client:", clientId);

      res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 86400,
      });
    });

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

    // Root and health check endpoints
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
      if (config.MCP_CLIENT_SECRET) {
        console.log("OAuth2 authentication enabled");
      }
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
