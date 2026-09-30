import { join } from "node:path";
import { getAgentDir, truncateHead, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  deleteToken, loadToken, login, MCP_URL, McpClient, refreshToken, resultText, saveToken,
  type McpTool, type OAuthApp, type Token,
} from "./mcp.ts";

const DEFAULT_REDIRECT_URI = "http://localhost:53682/callback";
const tokenFile = () => join(getAgentDir(), "slack-mcp", "token.json");

export default function (pi: ExtensionAPI) {
  let client: McpClient | undefined;
  let refreshing: Promise<Token> | undefined;

  function app(): OAuthApp {
    const clientId = process.env.SLACK_MCP_CLIENT_ID;
    if (!clientId) throw new Error("Set SLACK_MCP_CLIENT_ID to your Slack app's client ID");
    return {
      clientId,
      clientSecret: process.env.SLACK_MCP_CLIENT_SECRET || undefined,
      redirectUri: process.env.SLACK_MCP_REDIRECT_URI || DEFAULT_REDIRECT_URI,
    };
  }

  async function accessToken(): Promise<string> {
    const token = await loadToken(tokenFile());
    if (!token) throw new Error("Not logged in to Slack; run /slack-login");
    if (!token.expiresAt || Date.now() < token.expiresAt - 60_000) return token.accessToken;
    // Refresh tokens rotate, so parallel tool calls must share one refresh.
    refreshing ??= refreshToken(app(), token)
      .then(async (fresh) => { await saveToken(tokenFile(), fresh); return fresh; })
      .finally(() => { refreshing = undefined; });
    return (await refreshing).accessToken;
  }

  function register(tool: McpTool) {
    // Slack's tools are already slack_-prefixed; guard against clashes with built-ins if not.
    const name = tool.name.startsWith("slack_") ? tool.name : `slack_${tool.name}`;
    const readOnly = tool.annotations?.readOnlyHint === true;
    pi.registerTool({
      name,
      label: tool.annotations?.title ?? tool.title ?? name,
      description: tool.description ?? name,
      parameters: (tool.inputSchema ?? { type: "object", properties: {} }) as never,
      executionMode: "parallel",
      async execute(_id, params, signal, _onUpdate, ctx) {
        if (!client) throw new Error("Slack MCP is not connected; run /slack-login");
        // Anything that can post or change Slack needs a human yes.
        if (!readOnly) await confirmWrite(ctx, name, params);
        const result = await client.callTool(tool.name, params, signal);
        const text = resultText(result);
        if (result.isError) throw new Error(text);
        const truncated = truncateHead(text);
        return {
          content: [{
            type: "text" as const,
            text: truncated.truncated ? `${truncated.content}\n\n[Output truncated to 2000 lines / 50 KiB]` : truncated.content,
          }],
          details: undefined,
        };
      },
    });
  }

  async function confirmWrite(ctx: ExtensionContext, name: string, params: unknown) {
    if (!ctx.hasUI) throw new Error(`${name} can modify Slack and needs confirmation, but no UI is available`);
    const ok = await ctx.ui.confirm(`Allow ${name}?`, JSON.stringify(params, null, 2));
    if (!ok) throw new Error(`User declined ${name}`);
  }

  async function connect(): Promise<number> {
    const next = new McpClient(MCP_URL, accessToken);
    await next.connect();
    const tools = await next.listTools();
    client = next;
    for (const tool of tools) register(tool);
    return tools.length;
  }

  pi.on("session_start", async (_event, ctx) => {
    // Tools stay registered across new/resume/fork; connect once per runtime.
    if (client || !process.env.SLACK_MCP_CLIENT_ID || !(await loadToken(tokenFile()))) return;
    try {
      await connect();
    } catch (error) {
      if (ctx.hasUI) ctx.ui.notify(`Slack MCP: ${error instanceof Error ? error.message : String(error)}`, "warning");
    }
  });

  pi.registerCommand("slack-login", {
    description: "Authorize pi with Slack and load the Slack MCP tools",
    async handler(_args, ctx) {
      try {
        const token = await login(app(), async (url) => {
          if (ctx.hasUI) ctx.ui.notify(`Opening Slack authorization in your browser:\n${url}`, "info");
          await pi.exec(process.platform === "darwin" ? "open" : "xdg-open", [url]);
        });
        await saveToken(tokenFile(), token);
        const count = await connect();
        if (ctx.hasUI) ctx.ui.notify(`Slack connected: ${count} tools`, "info");
      } catch (error) {
        if (!ctx.hasUI) throw error;
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("slack-logout", {
    description: "Forget the stored Slack token",
    async handler(_args, ctx) {
      await deleteToken(tokenFile());
      client = undefined;
      if (ctx.hasUI) ctx.ui.notify("Slack token removed. Slack tools stay listed until /reload.", "info");
    },
  });
}
