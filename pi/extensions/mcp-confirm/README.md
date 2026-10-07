# MCP confirm

Asks before pi runs any MCP tool that its server doesn't mark read-only
(`readOnlyHint`), and shows the call's arguments. Calls from codemode scripts
are gated too. Without a UI (print mode), those calls are blocked.

The hints are the server's claim, not verified. A tool without them counts as
a write.

`link.sh` links this directory to `~/.pi/agent/extensions/mcp-confirm`. Run
`/reload` in open sessions after linking.

## Slack

pi connects to Slack's hosted MCP server (`https://mcp.slack.com/mcp`) with its
built-in MCP support. Slack's search and read tools are marked read-only.
Sending, drafting, reacting, and editing canvases or lists ask first.

### Create the Slack app

Slack allows MCP access only from an internal or Marketplace app, and it
doesn't support dynamic client registration, so pi needs a registered app's
client ID. If you can't create apps, ask a workspace admin.

Create the app at <https://api.slack.com/apps> from this manifest (**From a
manifest**), then install it to the workspace:

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

With `pkce_enabled`, pi needs no client secret. Slack can't undo this setting
without a support request.

### Configure pi

Add the server to `~/.pi/agent/mcp.json`. The file isn't in this repo because
the client ID belongs to a work workspace, and pi doesn't expand variables in
`oauth.clientId`.

```json
{
  "mcpServers": {
    "slack": {
      "url": "https://mcp.slack.com/mcp",
      "description": "Search and read Slack messages, threads, channels, canvases, and users",
      "oauth": {
        "clientId": "<client ID from the app's Basic Information page>",
        "callbackUrl": "http://localhost:53682/callback"
      }
    }
  }
}
```

Set `callbackUrl` explicitly. It must match the app's redirect URL, and
`pi mcp add --oauth-callback-port` would use `127.0.0.1` instead of
`localhost`.

Then sign in and check the connection:

```sh
pi mcp login slack
pi mcp list
```

pi stores the tokens in `~/.pi/agent/mcp-auth.json`.

### Troubleshoot sign-in

- `redirect_uri` mismatch: make `callbackUrl` match a redirect URL on the app.
- `invalid_scope`: pi requests every scope Slack advertises. If the app has
  fewer, set `oauth.scope` to its user scopes, separated by spaces.
- Client secret errors: the app doesn't use PKCE. Add `oauth.clientSecret`,
  which accepts `${VAR}` or `!command`.
