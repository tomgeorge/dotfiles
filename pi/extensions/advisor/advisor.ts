import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface AdvisorConfig { provider: string; model: string }

export function readConfig(path: string): AdvisorConfig | undefined {
  if (!existsSync(path)) return undefined;
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AdvisorConfig>;
  if (Object.keys(raw).length === 0) return undefined; // "off"
  if (typeof raw.provider !== "string" || typeof raw.model !== "string" || !raw.provider || !raw.model) {
    throw new Error(`${path} must contain {"provider": "...", "model": "..."}`);
  }
  return { provider: raw.provider, model: raw.model };
}

export function writeConfig(path: string, config: AdvisorConfig | undefined): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config ?? {}, null, 2)}\n`);
}

/**
 * Keep the start (the task and early decisions) and the recent end of a long
 * transcript, dropping the middle. Sharing the whole context is Cognition's
 * 80/20 for a "smart friend"; this only bounds the extreme case.
 */
export function trimTranscript(text: string, max: number, head = Math.floor(max * 0.1)): string {
  if (text.length <= max) return text;
  const tail = max - head;
  const dropped = text.length - head - tail;
  return `${text.slice(0, head)}\n\n[... ${dropped} characters of the middle of the conversation omitted ...]\n\n${text.slice(-tail)}`;
}

// Cognition: tell the advisor to send the agent to look rather than theorize, and to
// look beyond the narrow question ("over-scoped smart friend").
export const ADVISOR_SYSTEM_PROMPT = `You are a senior engineer advising a coding agent mid-task. You see its full conversation: the user's requests, its reasoning, every tool call and result.

Answer its question, then add anything important it didn't ask about: a wrong assumption, a simpler approach, a risk, a step it skipped, or a reason it's not actually done.

Rules:
- Be decisive and specific. Name files, functions, and commands. Recommend one path, not a menu.
- Disagree with the agent or its plan when the evidence warrants it.
- If answering depends on something not in the transcript, such as a file it never read, say exactly what to read or run, and to ask you again. Don't guess.
- Respect the user's instructions in the transcript, even where you'd choose differently.
- Keep it short: a few paragraphs or bullets. No preamble.`;

