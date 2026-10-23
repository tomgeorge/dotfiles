import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { BOXES, type Box, BUBBLE_WHEN, buildArgs, MAX_IDS, type Op, runHey, summarize } from "./hey.ts";

// The hey MCP server can't label or collect, and its write domains also send
// and trash mail. These tools expose only the organizing subcommands of the
// hey CLI, and ask before each write.

const ids = (description: string) =>
  Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: MAX_IDS, description });
const postingIds = ids(
  "Posting (box item) IDs: `postings[].id` from mcp__hey__hey_boxes get_imbox/get_feedbox/... — not topic IDs",
);

const namespace = {
  name: "hey_organize",
  description: "Organize HEY mail: move to the Feed, Paper Trail, or Set Aside, bubble up, add labels, add to collections, mark seen",
  instructions: [
    "Posting IDs are `postings[].id` from the mcp__hey__hey_boxes box listings.",
    "Thread IDs are topic IDs: the number in a posting's app_url, https://app.hey.com/topics/<id>.",
    "Look up label and collection IDs with hey_list_labels and hey_list_collections.",
    "Each write asks the user once, so batch IDs into one call (up to 100) instead of one call per email.",
  ].join("\n"),
};

async function confirmed(op: Op, ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) throw new Error("HEY writes need confirmation, but no UI is available");
  if (!(await ctx.ui.confirm("Allow HEY change?", summarize(op)))) throw new Error("User declined the HEY change");
}

function result(op: Op, data: unknown) {
  return {
    content: [{ type: "text" as const, text: `${summarize(op)}: done\n${JSON.stringify(data)}` }],
    details: undefined,
  };
}

async function confirmAndRun(op: Op, signal: AbortSignal | undefined, ctx: ExtensionContext) {
  await confirmed(op, ctx);
  return result(op, await runHey(buildArgs(op), signal));
}

export default function (pi: ExtensionAPI) {
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const read = { readOnlyHint: true, openWorldHint: true };

  pi.registerTool({
    name: "hey_move",
    label: "HEY move",
    description: "Move HEY emails to the Feed, the Paper Trail, or Set Aside (or back to the Imbox to undo).",
    exposure: "codemode",
    namespace,
    annotations: write,
    parameters: Type.Object({ postingIds, to: StringEnum(Object.keys(BOXES) as Box[]) }),
    async execute(_id, { postingIds, to }, signal, _onUpdate, ctx) {
      const op: Op = { kind: "move", postingIds, to };
      return confirmAndRun(op, signal, ctx);
    },
  });

  pi.registerTool({
    name: "hey_label_add",
    label: "HEY add label",
    description: "Add an existing HEY label to emails. Find label IDs with hey_list_labels.",
    exposure: "codemode",
    namespace,
    annotations: write,
    parameters: Type.Object({ postingIds, labelId: Type.Integer({ minimum: 1 }) }),
    async execute(_id, { postingIds, labelId }, signal, _onUpdate, ctx) {
      const op: Op = { kind: "label", postingIds, labelId };
      return confirmAndRun(op, signal, ctx);
    },
  });

  pi.registerTool({
    name: "hey_collection_add",
    label: "HEY add to collection",
    description: "Add HEY threads to an existing collection. Takes thread (topic) IDs. Find collection IDs with hey_list_collections.",
    exposure: "codemode",
    namespace,
    annotations: write,
    parameters: Type.Object({
      threadIds: ids("Thread (topic) IDs: the number in a posting's app_url, https://app.hey.com/topics/<id>"),
      collectionId: Type.Integer({ minimum: 1 }),
    }),
    async execute(_id, { threadIds, collectionId }, signal, _onUpdate, ctx) {
      const op: Op = { kind: "collection", threadIds, collectionId };
      return confirmAndRun(op, signal, ctx);
    },
  });

  pi.registerTool({
    name: "hey_seen",
    label: "HEY mark seen",
    description: "Mark HEY emails as seen.",
    exposure: "codemode",
    namespace,
    annotations: write,
    parameters: Type.Object({ postingIds }),
    async execute(_id, { postingIds }, signal, _onUpdate, ctx) {
      const op: Op = { kind: "seen", postingIds };
      return confirmAndRun(op, signal, ctx);
    },
  });

  pi.registerTool({
    name: "hey_bubble",
    label: "HEY bubble up",
    description:
      "Bubble HEY emails up to the top of the Imbox: now, tomorrow morning, Saturday morning (weekend), Monday morning (next-week), or on a date (when=on with on=YYYY-MM-DD).",
    exposure: "codemode",
    namespace,
    annotations: write,
    parameters: Type.Object({
      postingIds,
      when: StringEnum([...BUBBLE_WHEN]),
      on: Type.Optional(Type.String({ description: "YYYY-MM-DD; required when when=on" })),
    }),
    async execute(_id, { postingIds, when, on }, signal, _onUpdate, ctx) {
      const op: Op = { kind: "bubble", postingIds, when, on };
      // Validate before asking, so the user isn't prompted for a call that can't run.
      const args = buildArgs(op);
      await confirmed(op, ctx);
      return result(op, await runHey(args, signal));
    },
  });

  pi.registerTool({
    name: "hey_bubble_pop",
    label: "HEY cancel bubble-up",
    description: "Cancel the bubble-up on HEY emails.",
    exposure: "codemode",
    namespace,
    annotations: write,
    parameters: Type.Object({ postingIds }),
    async execute(_id, { postingIds }, signal, _onUpdate, ctx) {
      const op: Op = { kind: "bubble-pop", postingIds };
      return confirmAndRun(op, signal, ctx);
    },
  });

  for (const [name, kind, what] of [
    ["hey_list_labels", "list-labels", "labels"],
    ["hey_list_collections", "list-collections", "collections"],
  ] as const) {
    pi.registerTool({
      name,
      label: `HEY ${what}`,
      description: `List HEY ${what} with their IDs.`,
      exposure: "codemode",
      namespace,
      annotations: read,
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        const data = await runHey(buildArgs({ kind }), signal);
        return { content: [{ type: "text", text: JSON.stringify(data) }], details: undefined };
      },
    });
  }
}
