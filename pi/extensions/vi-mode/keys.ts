// The NORMAL-mode command grammar, fed one key at a time:
//
//   [count] ["x] [count] ( motion
//                        | operator [count] ( motion | textobject | same-operator )
//                        | simple-command )
//
// Keys are single characters, except "<C-r>" for ctrl+r. The parser only
// parses; editor.ts runs the command.

export type Operator = "d" | "c" | "y";
export type MotionSpec = { key: string; arg?: string };
export type ObjectSpec = { key: string; inner: boolean };

export type Command =
  | { type: "motion"; motion: MotionSpec; count: number | null }
  | {
      type: "operator";
      op: Operator;
      // null when neither count was given; counts multiply (2d3w = 6).
      count: number | null;
      register: string | null;
      target: { motion: MotionSpec } | { object: ObjectSpec } | { line: true };
    }
  | { type: "simple"; key: string; count: number | null; register: string | null; arg?: string };

export type Feed = { done: true; command: Command | null } | { done: false };

const MOTIONS = new Set(["h", "l", "j", "k", "0", "^", "$", "w", "b", "e", "W", "B", "E", "G", ";", ",", "%", "{", "}"]);
const G_MOTIONS = new Set(["g", "e", "E"]); // gg ge gE
const CHAR_MOTIONS = new Set(["f", "F", "t", "T"]);
const OPERATORS = new Set(["d", "c", "y"]);
const SIMPLE = new Set(["x", "X", "D", "C", "s", "S", "Y", "p", "P", "J", "~", "u", "<C-r>", "i", "a", "I", "A", "o", "O"]);
const OBJECTS = new Set(["w", "W", "(", ")", "b", "{", "}", "B", "[", "]", "<", ">", '"', "'", "`", "p"]);

type Stage =
  | "start" // counts and a register may still come
  | "register" // after "
  | "g" // after g, before an operator
  | "char" // f/F/t/T/r waiting for its character, before an operator
  | "operator" // after d/c/y
  | "op-g"
  | "op-char"
  | "op-object"; // after d i / d a

export class Parser {
  private stage: Stage = "start";
  private count1 = "";
  private count2 = "";
  private register: string | null = null;
  private op: Operator | null = null;
  private charKey = "";
  private inner = false;
  private typed = "";

  // What's been typed of the current command, for the mode line.
  get pending(): string {
    return this.typed;
  }

  reset(): void {
    this.stage = "start";
    this.count1 = this.count2 = "";
    this.register = this.op = null;
    this.charKey = "";
    this.typed = "";
  }

  feed(key: string): Feed {
    this.typed += key === "<C-r>" ? "^R" : key;
    const result = this.step(key);
    if (result.done) this.reset();
    return result;
  }

  private step(key: string): Feed {
    switch (this.stage) {
      case "register":
        this.register = key;
        this.stage = "start";
        return { done: false };

      case "start":
        if (/[1-9]/.test(key) || (key === "0" && this.count1 !== "")) {
          this.count1 += key;
          return { done: false };
        }
        if (key === '"' && this.register === null) {
          this.stage = "register";
          return { done: false };
        }
        if (key === "g") {
          this.stage = "g";
          return { done: false };
        }
        if (CHAR_MOTIONS.has(key) || key === "r") {
          this.charKey = key;
          this.stage = "char";
          return { done: false };
        }
        if (OPERATORS.has(key)) {
          this.op = key as Operator;
          this.stage = "operator";
          return { done: false };
        }
        if (MOTIONS.has(key)) return this.done({ type: "motion", motion: { key }, count: this.count(this.count1) });
        if (SIMPLE.has(key)) return this.simple(key);
        return this.done(null);

      case "g":
        if (G_MOTIONS.has(key)) return this.done({ type: "motion", motion: { key: "g" + key }, count: this.count(this.count1) });
        return this.done(null);

      case "char":
        if (this.charKey === "r") return this.simple("r", key);
        return this.done({ type: "motion", motion: { key: this.charKey, arg: key }, count: this.count(this.count1) });

      case "operator":
        if (/[1-9]/.test(key) || (key === "0" && this.count2 !== "")) {
          this.count2 += key;
          return { done: false };
        }
        if (key === this.op) return this.operator({ line: true });
        if (key === "i" || key === "a") {
          this.inner = key === "i";
          this.stage = "op-object";
          return { done: false };
        }
        if (key === "g") {
          this.stage = "op-g";
          return { done: false };
        }
        if (CHAR_MOTIONS.has(key)) {
          this.charKey = key;
          this.stage = "op-char";
          return { done: false };
        }
        if (MOTIONS.has(key)) return this.operator({ motion: { key } });
        return this.done(null);

      case "op-g":
        if (G_MOTIONS.has(key)) return this.operator({ motion: { key: "g" + key } });
        return this.done(null);

      case "op-char":
        return this.operator({ motion: { key: this.charKey, arg: key } });

      case "op-object":
        if (OBJECTS.has(key)) return this.operator({ object: { key, inner: this.inner } });
        return this.done(null);
    }
  }

  private count(digits: string): number | null {
    return digits === "" ? null : Number(digits);
  }

  private done(command: Command | null): Feed {
    return { done: true, command };
  }

  private simple(key: string, arg?: string): Feed {
    return this.done({ type: "simple", key, count: this.count(this.count1), register: this.register, ...(arg === undefined ? {} : { arg }) });
  }

  private operator(target: { motion: MotionSpec } | { object: ObjectSpec } | { line: true }): Feed {
    const a = this.count(this.count1);
    const b = this.count(this.count2);
    const count = a === null && b === null ? null : (a ?? 1) * (b ?? 1);
    return this.done({ type: "operator", op: this.op!, count, register: this.register, target });
  }
}
