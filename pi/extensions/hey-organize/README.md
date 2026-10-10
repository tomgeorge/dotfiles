# hey-organize

Codemode tools that let pi organize HEY mail through the `hey` CLI:

| Tool | Does | Takes |
|---|---|---|
| `hey_move` | Move emails to the Feed, Paper Trail, or Set Aside, or back to the Imbox | posting IDs, `feed`/`trail`/`aside`/`imbox` |
| `hey_bubble` | Bubble emails up now, tomorrow, Saturday, Monday, or on a date | posting IDs, `now`/`tomorrow`/`weekend`/`next-week`/`on` (+ `YYYY-MM-DD`) |
| `hey_bubble_pop` | Cancel a bubble-up | posting IDs |
| `hey_label_add` | Add an existing label | posting IDs, label ID |
| `hey_collection_add` | Add to an existing collection | thread (topic) IDs, collection ID |
| `hey_seen` | Mark emails seen | posting IDs |
| `hey_list_labels`, `hey_list_collections` | List IDs (read-only) | — |

## Why not the hey MCP server

`hey mcp` has no label or collection actions. Its write mode is per domain, so
turning on `move_topic` also turns on sending, replying, and emptying Trash.
These tools run fixed `hey` subcommands with validated integer IDs, without a
shell, so the model can't reach anything else in the CLI.

Each write asks for confirmation and shows the IDs, once per call; the tools
take up to 100 IDs so a batch is one prompt. Without a UI (print mode), writes
are refused. Creating or deleting labels and collections isn't exposed.

## IDs

- Posting IDs: `postings[].id` from `mcp__hey__hey_boxes` (`get_imbox`, ...).
- Thread IDs: the number in a posting's `app_url`, `https://app.hey.com/topics/<id>`.

## Install

`link.sh` links this directory to `~/.pi/agent/extensions/hey-organize`. Run
`/reload` in open sessions. It uses the `hey` binary and login that
`pi/mcp.json` uses.

## Test

```sh
node --test pi/extensions/hey-organize/*.test.ts
```
