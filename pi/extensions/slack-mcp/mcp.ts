// Just enough MCP (Streamable HTTP, tools only) and Slack OAuth for Slack's
// hosted MCP server. No pi imports, so it can be tested with plain node.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";

export const MCP_URL = "https://mcp.slack.com/mcp";
const AUTHORIZE_URL = "https://slack.com/oauth/v2_user/authorize";
const TOKEN_URL = "https://slack.com/api/oauth.v2.user.access";
const PROTOCOL_VERSION = "2025-06-18";
const LOGIN_TIMEOUT_MS = 5 * 60_000;

// User scopes the Slack MCP server advertises. The Slack app must declare
// every one of these, or authorization fails.
export const SCOPES = [
  "canvases:read", "canvases:write",
  "channels:history", "channels:read", "channels:write",
  "chat:write", "emoji:read", "files:read", "files:write",
  "groups:history", "groups:read", "groups:write",
  "im:history", "im:read", "im:write",
  "lists:read", "lists:write",
  "mpim:history", "mpim:read", "mpim:write",
  "reactions:read", "reactions:write",
  "search:read.files", "search:read.im", "search:read.mpim",
  "search:read.private", "search:read.public", "search:read.users",
  "users:read", "users:read.email",
];

export type OAuthApp = { clientId: string; clientSecret?: string; redirectUri: string };
export type Token = { accessToken: string; refreshToken?: string; expiresAt?: number };
export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { title?: string; readOnlyHint?: boolean };
};
export type McpContent = { type: string; text?: string; [key: string]: unknown };
export type McpCallResult = { content?: McpContent[]; structuredContent?: unknown; isError?: boolean };

export class AuthError extends Error {}
class SessionExpired extends Error {}

const base64url = (buf: Buffer) => buf.toString("base64url");

// --- OAuth (authorization code + PKCE, loopback redirect) ---

export function authorizeUrl(app: OAuthApp, state: string, challenge: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: app.clientId,
    user_scope: SCOPES.join(","),
    redirect_uri: app.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export async function login(app: OAuthApp, openUrl: (url: string) => unknown): Promise<Token> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));
  const redirect = new URL(app.redirectUri);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", app.redirectUri);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404, { connection: "close" }).end();
        return;
      }
      const error = url.searchParams.get("error")
        ?? (url.searchParams.get("state") !== state ? "state mismatch" : undefined);
      const code = url.searchParams.get("code");
      res.writeHead(error || !code ? 400 : 200, { "content-type": "text/plain", connection: "close" })
        .end(error || !code ? `Slack login failed: ${error ?? "no code"}` : "Slack connected. You can close this tab.");
      finish(error || !code ? new Error(`Slack login failed: ${error ?? "no code"}`) : undefined, code ?? undefined);
    });
    const timer = setTimeout(() => finish(new Error("Timed out waiting for Slack authorization")), LOGIN_TIMEOUT_MS);
    let done = false;
    function finish(error?: Error, code?: string) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      if (error) reject(error);
      else resolve(code!);
    }
    server.on("error", (error) => finish(error));
    server.listen(Number(redirect.port) || 80, redirect.hostname, () => {
      Promise.resolve(openUrl(authorizeUrl(app, state, challenge))).catch((error) => finish(error));
    });
  });

  return tokenRequest(app, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: app.redirectUri,
  });
}

export async function refreshToken(app: OAuthApp, token: Token): Promise<Token> {
  if (!token.refreshToken) throw new AuthError("Slack token expired; run /slack-login");
  const fresh = await tokenRequest(app, { grant_type: "refresh_token", refresh_token: token.refreshToken });
  return { ...fresh, refreshToken: fresh.refreshToken ?? token.refreshToken };
}

async function tokenRequest(app: OAuthApp, params: Record<string, string>): Promise<Token> {
  const body = new URLSearchParams({ client_id: app.clientId, ...params });
  if (app.clientSecret) body.set("client_secret", app.clientSecret);
  const res = await fetch(TOKEN_URL, { method: "POST", body });
  const json = await res.json() as Record<string, any>;
  if (!json.ok) throw new AuthError(`Slack OAuth failed: ${json.error ?? `HTTP ${res.status}`}`);
  // Tolerate both the user-only shape and oauth.v2.access's authed_user shape.
  const t = json.access_token ? json : json.authed_user ?? {};
  if (typeof t.access_token !== "string") throw new AuthError("Slack OAuth response had no access token");
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
  };
}

// --- Token storage ---

export async function loadToken(file: string): Promise<Token | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function saveToken(file: string, token: Token): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(token), { mode: 0o600 });
}

export async function deleteToken(file: string): Promise<void> {
  await rm(file, { force: true });
}

// --- MCP client ---

export class McpClient {
  private url: string;
  private getToken: () => Promise<string>;
  private nextId = 1;
  private sessionId?: string;
  private protocolVersion?: string;

  constructor(url: string, getToken: () => Promise<string>) {
    this.url = url;
    this.getToken = getToken;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    this.sessionId = undefined;
    this.protocolVersion = undefined;
    const result = await this.send("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "pi-slack-mcp", version: "0.1.0" },
    }, signal) as { protocolVersion?: string };
    this.protocolVersion = result.protocolVersion ?? PROTOCOL_VERSION;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, signal);
  }

  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request("tools/list", cursor ? { cursor } : {}, signal) as { tools: McpTool[]; nextCursor?: string };
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<McpCallResult> {
    return await this.request("tools/call", { name, arguments: args ?? {} }, signal) as McpCallResult;
  }

  // Servers may drop sessions at any time; the spec says to start a new one.
  private async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    try {
      return await this.send(method, params, signal);
    } catch (error) {
      if (!(error instanceof SessionExpired)) throw error;
      await this.connect(signal);
      return await this.send(method, params, signal);
    }
  }

  private async send(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method, params }, signal);
    const message = await readMessage(res, id);
    if (message.error) throw new Error(`Slack MCP ${method} failed: ${message.error.message} (code ${message.error.code})`);
    return message.result;
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${await this.getToken()}`,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (this.protocolVersion) headers["mcp-protocol-version"] = this.protocolVersion;
    const res = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (res.status === 401) throw new AuthError("Slack rejected the token; run /slack-login");
    if (res.status === 404 && this.sessionId) throw new SessionExpired();
    if (!res.ok) throw new Error(`Slack MCP HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    this.sessionId = res.headers.get("mcp-session-id") ?? this.sessionId;
    return res;
  }
}

type JsonRpcMessage = { id?: number; result?: unknown; error?: { code: number; message: string } };

async function readMessage(res: Response, id: number): Promise<JsonRpcMessage> {
  const type = res.headers.get("content-type") ?? "";
  const messages = type.includes("text/event-stream")
    ? parseSse(await res.text())
    : [await res.json()].flat() as JsonRpcMessage[];
  const message = messages.find((m) => m.id === id);
  if (!message) throw new Error(`Slack MCP returned no response for request ${id}`);
  return message;
}

// POST responses are short-lived streams, so read to the end and split events.
export function parseSse(text: string): JsonRpcMessage[] {
  const messages: JsonRpcMessage[] = [];
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) messages.push(...[JSON.parse(data)].flat());
  }
  return messages;
}

export function resultText(result: McpCallResult): string {
  const parts = (result.content ?? []).map((c) => c.type === "text" && typeof c.text === "string" ? c.text : JSON.stringify(c));
  if (!parts.length && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  return parts.join("\n\n") || "(empty result)";
}
