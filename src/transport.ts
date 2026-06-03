import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response, NextFunction } from "express";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "./server.js";
import { config } from "./config.js";

// In-memory token store (token → expires_at in ms)
const validTokens = new Map<string, number>();

interface RegisteredClient {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  created_at: number;
}

const clients = new Map<string, RegisteredClient>();

interface AuthCode {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  expires_at: number;
}

const authCodes = new Map<string, AuthCode>();

function generateAccessToken(clientId: string, clientSecret: string): string {
  return createHash("sha256").update(`${clientId}:${clientSecret}:${randomUUID()}`).digest("hex");
}

function authMiddleware(req: Request, res: Response, next: NextFunction) {
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
  // Static bearer bypass for clients without OAuth discovery (Cursor, Cline).
  if (config.MCP_STATIC_BEARER && token === config.MCP_STATIC_BEARER) {
    next();
    return;
  }
  const exp = validTokens.get(token);
  if (exp && exp >= Date.now()) {
    next();
    return;
  }
  if (exp) {
    validTokens.delete(token);
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
    // Honor X-Forwarded-Proto from reverse proxy (easypanel/traefik/nginx terminate TLS).
    // Without this, req.protocol returns "http" and OAuth metadata advertises http:// URLs.
    app.set("trust proxy", true);
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    // OAuth2 metadata discovery
    app.get("/.well-known/oauth-authorization-server", (req, res) => {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      res.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        registration_endpoint: `${baseUrl}/register`,
        grant_types_supported: ["authorization_code"],
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    });

    app.get("/.well-known/oauth-protected-resource", (req, res) => {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      res.json({
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"],
      });
    });

    // OAuth2 dynamic client registration (RFC 7591)
    app.post("/register", (req, res) => {
      const redirectUris = req.body?.redirect_uris;
      if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((u) => typeof u === "string" && u.length > 0)) {
        res.status(400).json({ error: "invalid_redirect_uri", error_description: "redirect_uris must be a non-empty array of strings" });
        return;
      }

      const clientName = typeof req.body?.client_name === "string" ? req.body.client_name : undefined;
      const clientId = randomUUID();
      const createdAt = Math.floor(Date.now() / 1000);

      clients.set(clientId, {
        client_id: clientId,
        client_name: clientName,
        redirect_uris: redirectUris,
        created_at: createdAt,
      });

      res.status(201).json({
        client_id: clientId,
        client_id_issued_at: createdAt,
        redirect_uris: redirectUris,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });
    });

    // OAuth2 authorization endpoint — single-user auto-approve
    app.get("/authorize", (req, res) => {
      const responseType = req.query.response_type;
      const clientId = req.query.client_id;
      const redirectUri = req.query.redirect_uri;
      const codeChallenge = req.query.code_challenge;
      const codeChallengeMethod = req.query.code_challenge_method;
      const state = req.query.state;

      if (responseType !== "code") {
        res.status(400).json({ error: "unsupported_response_type" });
        return;
      }

      if (typeof clientId !== "string") {
        res.status(400).json({ error: "invalid_client" });
        return;
      }
      const client = clients.get(clientId);
      if (!client) {
        res.status(400).json({ error: "invalid_client" });
        return;
      }

      if (typeof redirectUri !== "string" || !client.redirect_uris.includes(redirectUri)) {
        res.status(400).json({ error: "invalid_redirect_uri" });
        return;
      }

      if (codeChallengeMethod !== "S256" || typeof codeChallenge !== "string" || codeChallenge.length === 0) {
        res.status(400).json({ error: "invalid_code_challenge" });
        return;
      }

      const code = `${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
      authCodes.set(code, {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        expires_at: Date.now() + 60_000,
      });

      const redirect = new URL(redirectUri);
      redirect.searchParams.set("code", code);
      if (typeof state === "string") {
        redirect.searchParams.set("state", state);
      }
      res.redirect(302, redirect.toString());
    });

    // OAuth2 token endpoint (authorization_code/PKCE)
    app.post("/oauth/token", (req, res) => {
      const grantType = req.body.grant_type;

      if (grantType === "authorization_code") {
        const code = req.body.code;
        const codeVerifier = req.body.code_verifier;
        const clientId = req.body.client_id;
        const redirectUri = req.body.redirect_uri;

        if (typeof code !== "string" || typeof codeVerifier !== "string" || typeof clientId !== "string") {
          res.status(400).json({ error: "invalid_request", error_description: "code, code_verifier and client_id are required" });
          return;
        }

        const entry = authCodes.get(code);
        if (!entry || entry.expires_at < Date.now()) {
          res.status(400).json({ error: "invalid_grant", error_description: "authorization code invalid or expired" });
          return;
        }

        if (entry.client_id !== clientId || entry.redirect_uri !== redirectUri) {
          res.status(400).json({ error: "invalid_grant", error_description: "client_id or redirect_uri mismatch" });
          return;
        }

        const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
        if (challenge !== entry.code_challenge) {
          res.status(400).json({ error: "invalid_grant", error_description: "PKCE verifier mismatch" });
          return;
        }

        authCodes.delete(code);
        const accessToken = generateAccessToken(clientId, "pkce");
        validTokens.set(accessToken, Date.now() + 86_400_000);

        console.log("OAuth2 token issued (PKCE) for client:", clientId);

        res.json({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 86400,
        });
        return;
      }

      res.status(400).json({ error: "unsupported_grant_type" });
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
