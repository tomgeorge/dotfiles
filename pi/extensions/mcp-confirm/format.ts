export type Row = [key: string, value: string];
/** Terminal columns a string occupies. Pi's visibleWidth in the TUI; code points elsewhere. */
export type Measure = (text: string) => number;

const codePoints: Measure = (text) => [...text].length;

/** The dialog's heading: server and tool, plus the first line of the tool's description. */
export function describeTool(toolName: string, description?: string): { title: string; summary?: string } {
  const [, server, ...rest] = toolName.split("__");
  const name = server && rest.length > 0 ? `${server} › ${rest.join("__")}` : toolName;
  const summary = description?.trim().split("\n")[0]?.trim();
  return { title: `Allow ${name}?`, summary: summary || undefined };
}

/**
 * The call's arguments as key/value rows. Nested objects flatten to dotted
 * keys so every value the tool will receive stays visible; nothing is
 * truncated, because the point is to see exactly what gets sent.
 */
export function argRows(input: unknown): Row[] {
  return flatten(input, "");
}

/**
 * A boxed two-column table that fits in `width` columns, wrapping long keys
 * and values inside their cells.
 */
export function boxTable(rows: Row[], width: number, measure: Measure = codePoints): string[] {
  if (rows.length === 0) return ["(no arguments)"];
  // Borders and padding: "│ " + " │ " + " │" = 7 columns.
  const inner = Math.max(2, width - 7);
  const longestKey = Math.max(...rows.map(([k]) => measure(k)));
  const keyWidth = Math.max(1, Math.min(longestKey, Math.floor(inner / 3)));
  const valueWidth = Math.max(1, inner - keyWidth);
  const longestValue = Math.max(...rows.flatMap(([, v]) => v.split("\n").map(measure)));
  const valueCol = Math.min(valueWidth, Math.max(1, longestValue));

  const rule = (l: string, m: string, r: string) => `${l}${"─".repeat(keyWidth + 2)}${m}${"─".repeat(valueCol + 2)}${r}`;
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - measure(s)));
  const lines = [rule("┌", "┬", "┐")];
  rows.forEach(([key, value], i) => {
    if (i > 0) lines.push(rule("├", "┼", "┤"));
    const keys = wrap(key, keyWidth, measure);
    const values = wrap(value, valueCol, measure);
    for (let j = 0; j < Math.max(keys.length, values.length); j++) {
      lines.push(`│ ${pad(keys[j] ?? "", keyWidth)} │ ${pad(values[j] ?? "", valueCol)} │`);
    }
  });
  lines.push(rule("└", "┴", "┘"));
  return lines;
}

/** Word-wraps each line of `text` to `width`, breaking words longer than a line. */
export function wrap(text: string, width: number, measure: Measure = codePoints): string[] {
  return text.split("\n").flatMap((line) => {
    const out: string[] = [];
    let current = "";
    for (const word of line.split(/(?<= )/)) {
      if (measure(current + word.trimEnd()) <= width) {
        current += word;
        continue;
      }
      if (current) out.push(current.trimEnd());
      current = "";
      for (const ch of word) {
        if (measure(current + ch) > width && current) {
          out.push(current);
          current = "";
        }
        current += ch;
      }
    }
    out.push(current.trimEnd());
    return out;
  });
}

function flatten(value: unknown, path: string): Row[] {
  if (Array.isArray(value)) {
    if (value.every(isScalar)) return [[path || "(value)", value.length === 0 ? "[]" : value.map(scalar).join(", ")]];
    return value.flatMap((v, i) => flatten(v, `${path}[${i}]`));
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return path ? [[path, "{}"]] : [];
    return entries.flatMap(([k, v]) => flatten(v, path ? `${path}.${clean(k)}` : clean(k)));
  }
  return [[path || "(value)", scalar(value)]];
}

function isScalar(value: unknown): boolean {
  return typeof value !== "object" || value === null;
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value === "" ? '""' : clean(value);
  if (value === undefined) return "undefined";
  return JSON.stringify(value) ?? String(value);
}

// Arguments come from the model, so control characters (ANSI escapes, carriage
// returns) could hide or rewrite what the dialog shows. Show them escaped.
function clean(text: string): string {
  return text.replace(/\t/g, "  ").replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
