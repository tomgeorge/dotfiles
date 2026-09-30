# Slack MCP

Exposes the tools from Slack's hosted MCP server (`https://mcp.slack.com/mcp`)
as Pi tools. It isn't a general MCP client: it handles one remote server over
Streamable HTTP, tools only (no resources, prompts, or sampling), and Slack's
OAuth.

## Install

`link.sh` links this directory to `~/.pi/agent/extensions/slack-mcp`. For just
this extension:

```sh
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/pi/extensions/slack-mcp" ~/.pi/agent/extensions/slack-mcp
```

The extension does nothing until `SLACK_MCP_CLIENT_ID` is set, so it's safe to
link on machines without Slack.

## Create the Slack app

Slack only allows MCP access from a registered internal or Marketplace app; it
doesn't support dynamic client registration. Create an app at
<https://api.slack.com/apps> from this manifest (**From a manifest**), then
install it to the workspace. Workspace admins may need to approve it.

```json
{
  "display_information": { "name": "pi" },
  "oauth_config": {
    "redirect_urls": ["http://localhost:53682/callback"],
    "scopes": {
      "user": [
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
        "users:read", "users:read.email"
      ]
    },
    "pkce_enabled": true
  },
  "settings": { "org_deploy_enabled": false, "socket_mode_enabled": false, "token_rotation_enabled": false }
}
```

With `pkce_enabled`, Pi is a public client and needs no client secret. Slack
can't undo this without a support request. To use a client secret instead,
drop `pkce_enabled` and set `SLACK_MCP_CLIENT_SECRET`. Pi still sends PKCE.

To request fewer scopes, remove them from both the manifest and `SCOPES` in
`mcp.ts`; the lists must match.

## Configure

| Variable | Required | Default |
| --- | --- | --- |
| `SLACK_MCP_CLIENT_ID` | Yes | none |
| `SLACK_MCP_CLIENT_SECRET` | Only without PKCE | none |
| `SLACK_MCP_REDIRECT_URI` | No | `http://localhost:53682/callback` |

The redirect URI must match one in the app's `redirect_urls`.

## Use

```text
/slack-login    # opens Slack in the browser, stores the token, loads tools
/slack-logout   # deletes the stored token
```

After login, the token is stored at `~/.pi/agent/slack-mcp/token.json` (mode
0600). Later sessions connect at startup and register the tools. If Slack
issues expiring tokens (token rotation), they refresh automatically.

Pi asks before running any tool that Slack doesn't mark read-only
(`readOnlyHint`), such as sending messages, reacting, or editing canvases,
and shows the arguments. Without a UI (print mode), those tools fail.

## Checks

```sh
node --test pi/extensions/slack-mcp/mcp.test.ts
```

Tests run against a local fake MCP server and a stubbed token endpoint, not
Slack.
