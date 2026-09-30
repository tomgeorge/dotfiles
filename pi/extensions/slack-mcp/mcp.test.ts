import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { AuthError, loadToken, login, McpClient, parseSse, resultText, saveToken } from "./mcp.ts";

// Fake Streamable HTTP MCP server: JSON for initialize, SSE for everything else,
// and it can forget sessions to exercise re-initialization.
const seen: { method?: string; session?: string; auth?: string }[] = [];
let sessions = new Set<string>();
let nextSession = 1;

function handle(req: IncomingMessage, res: ServerResponse) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const msg = JSON.parse(body);
    const session = req.headers["mcp-session-id"] as string | undefined;
    seen.push({ method: msg.method, session, auth: req.headers.authorization });
    if (req.headers.authorization !== "Bearer good") return void res.writeHead(401).end();
    if (msg.method === "initialize") {
      const id = `s${nextSession++}`;
      sessions.add(id);
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": id });
      return void res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } }));
    }
    if (!session || !sessions.has(session)) return void res.writeHead(404).end();
    if (msg.method === "notifications/initialized") return void res.writeHead(202).end();
    let result: unknown;
    if (msg.method === "tools/list") {
      result = msg.params.cursor
        ? { tools: [{ name: "slack_send_message" }] }
        : { tools: [{ name: "slack_search", annotations: { readOnlyHint: true } }], nextCursor: "p2" };
    } else if (msg.method === "tools/call") {
      result = { content: [{ type: "text", text: `called ${msg.params.name} with ${JSON.stringify(msg.params.arguments)}` }] };
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })}\n\n`
      + `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`);
  });
}

const server = createServer(handle);
let url = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("no address");
  url = `http://127.0.0.1:${address.port}/mcp`;
});
after(() => server.close());

test("initializes, pages tools/list, and calls tools over SSE", async () => {
  const client = new McpClient(url, async () => "good");
  await client.connect();
  const tools = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["slack_search", "slack_send_message"]);
  const result = await client.callTool("slack_search", { query: "hi" });
  assert.equal(resultText(result), 'called slack_search with {"query":"hi"}');
  assert.ok(seen.filter((s) => s.method !== "initialize").every((s) => s.session === "s1"));
});

test("re-initializes when the server drops the session", async () => {
  const client = new McpClient(url, async () => "good");
  await client.connect();
  sessions = new Set();
  const result = await client.callTool("slack_search", {});
  assert.match(resultText(result), /called slack_search/);
});

test("maps 401 to AuthError", async () => {
  const client = new McpClient(url, async () => "bad");
  await assert.rejects(client.connect(), AuthError);
});

test("parseSse handles multi-line data and CRLF", () => {
  const text = 'data: {"id":1,\r\ndata: "result":{}}\r\n\r\n: comment\n\n';
  assert.deepEqual(parseSse(text), [{ id: 1, result: {} }]);
});

test("resultText falls back to structured content", () => {
  assert.equal(resultText({ structuredContent: { a: 1 } }), '{"a":1}');
  assert.equal(resultText({ content: [] }), "(empty result)");
});

test("login runs PKCE through the loopback redirect", async () => {
  const realFetch = globalThis.fetch;
  let tokenBody: URLSearchParams | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== "https://slack.com/api/oauth.v2.user.access") return realFetch(input, init);
    tokenBody = new URLSearchParams(String(init?.body));
    return Response.json({ ok: true, access_token: "xoxp-1", refresh_token: "xoxe-1", expires_in: 3600 });
  }) as typeof fetch;
  try {
    const redirectUri = "http://127.0.0.1:53999/callback";
    const token = await login({ clientId: "123.456", redirectUri }, async (authorize) => {
      const params = new URL(authorize).searchParams;
      assert.equal(params.get("code_challenge_method"), "S256");
      assert.equal(params.get("redirect_uri"), redirectUri);
      // Play the browser: Slack redirects back with the code and our state.
      const res = await realFetch(`${redirectUri}?code=abc&state=${params.get("state")}`);
      assert.equal(res.status, 200);
    });
    assert.equal(token.accessToken, "xoxp-1");
    assert.equal(token.refreshToken, "xoxe-1");
    assert.equal(tokenBody?.get("code"), "abc");
    assert.equal(tokenBody?.get("client_secret"), null);
    assert.ok(tokenBody?.get("code_verifier"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("login rejects a callback with the wrong state", async () => {
  const redirectUri = "http://127.0.0.1:53998/callback";
  await assert.rejects(
    login({ clientId: "123.456", redirectUri }, async () => {
      await fetch(`${redirectUri}?code=abc&state=forged`);
    }),
    /state mismatch/,
  );
});

test("tokens are stored owner-only", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "slack-mcp-")), "nested", "token.json");
  await saveToken(file, { accessToken: "xoxp-1" });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await loadToken(file), { accessToken: "xoxp-1" });
  assert.equal(await loadToken(`${file}.missing`), undefined);
});
