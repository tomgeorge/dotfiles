import { homedir } from "node:os";
import { join } from "node:path";
import { type Message, uuidv7 } from "@earendil-works/pi-ai";
import { convertToLlm, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  ADVISOR_SYSTEM_PROMPT, advisorPrompt, modelRef, parseModelRef, readConfig, serializeTranscript, textOf, trimTranscript,
  writeConfig, type AdvisorConfig,
} from "./advisor.ts";

const CONFIG = join(homedir(), ".pi", "agent", "advisor.json");
const MAX_TRANSCRIPT_CHARS = 600_000;
const TOOL = "advisor";

export default function (pi: ExtensionAPI) {
  let config: AdvisorConfig | undefined;

  function load(ctx?: ExtensionContext) {
    try {
      config = readConfig(CONFIG);
    } catch (error) {
      config = undefined;
      ctx?.ui.notify(`advisor: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
    // Declare the tool only when there's an advisor to call.
    const active = pi.getActiveTools().filter((t) => t !== TOOL);
    pi.setActiveTools(config ? [...active, TOOL] : active);
    if (ctx?.hasUI) ctx.ui.setStatus("advisor", config ? `advisor: ${config.model}` : undefined);
  }

  pi.registerTool({
    name: TOOL,
    label: "Advisor",
    description: "Consult a stronger, independently configured model that sees this entire conversation, including all tool calls and results. Returns its guidance. Costs a full-context model call, so use it at decision points, not routinely.",
    promptGuidelines: [
      "Call advisor before committing to an approach on a hard or ambiguous multi-step task, when the same error or failure has recurred twice, and before declaring a large or risky task done. Don't call it for routine steps.",
      "Weigh the advisor's guidance against the user's instructions and the evidence; it can be wrong. If it asks you to read something first, do that and ask again.",
    ],
    parameters: Type.Object({
      question: Type.String({ minLength: 1, description: "What you want advice on. Broad questions (\"what should I do next?\") work well." }),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      // Pin the config for this call so the reply is labelled with the model that gave it.
      const advisor = config;
      if (!advisor) throw new Error("No advisor configured. Ask the user to pick one with /advisor.");
      const model = ctx.modelRegistry.getAvailable().find((m) => m.provider === advisor.provider && m.id === advisor.model);
      if (!model) throw new Error(`Advisor model ${modelRef(advisor)} is unavailable. Ask the user to run /advisor.`);
      // Exactly the messages Pi sends the agent's model: compaction, context edits,
      // branch summaries, and custom messages applied the same way.
      const messages = ctx.sessionManager.buildSessionProjection().messages;
      const transcript = trimTranscript(serializeTranscript(convertToLlm(messages)), MAX_TRANSCRIPT_CHARS);
      const message: Message = {
        role: "user",
        content: [{ type: "text", text: advisorPrompt(transcript, params.question) }],
        timestamp: Date.now(),
      };
      const response = await ctx.modelRegistry.complete(model, { systemPrompt: ADVISOR_SYSTEM_PROMPT, messages: [message] },
        { signal, cacheRetention: "none", sessionId: uuidv7() });
      if (response.stopReason === "aborted") throw new Error("Advisor call cancelled");
      if (response.stopReason === "error") throw new Error(`Advisor failed: ${response.errorMessage ?? "unknown error"}`);
      const text = textOf(response.content).trim();
      if (!text) throw new Error("Advisor returned no text");
      return {
        content: [{ type: "text" as const, text: `Advisor (${modelRef(advisor)}):\n\n${text}` }],
        details: { provider: advisor.provider, model: advisor.model, cost: response.usage?.cost?.total },
      };
    },
  });

  pi.registerCommand("advisor", {
    description: "Choose the model the agent can consult with the advisor tool: /advisor [provider/model | off]",
    async handler(args, ctx) {
      const available = ctx.modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`);
      let choice = args.trim();
      if (!choice) {
        if (!ctx.hasUI) return console.log(modelRef(config));
        choice = (await ctx.ui.select(`Advisor model (now: ${modelRef(config)})`, ["off", ...available])) ?? "";
        if (!choice) return;
      }
      if (choice === "off") {
        writeConfig(CONFIG, undefined);
      } else {
        if (!available.includes(choice)) return ctx.ui.notify(`Unavailable model: ${choice}`, "error");
        writeConfig(CONFIG, parseModelRef(choice));
      }
      load(ctx);
      ctx.ui.notify(config ? `Advisor set to ${modelRef(config)}` : "Advisor off", "info");
    },
  });

  pi.on("session_start", (_event, ctx) => load(ctx));
  // /tree restores the tools recorded at the target entry, which may predate the last /advisor.
  pi.on("session_tree", (_event, ctx) => load(ctx));
}
