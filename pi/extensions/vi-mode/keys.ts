// The NORMAL-mode command grammar, fed one key at a time:
//
//   [count] ["x] [count] ( motion
//                        | operator [count] ( motion | textobject | same-operator )
//                        | simple-command )
//
// Keys are single characters, except "<C-r>" for ctrl+r. The parser only
// parses; editor.ts runs the command.

const MOTIONS = ["h", "l", "j", "k", "0", "^", "$", "w", "b", "e", "W", "B", "E", "G", ";", ",", "%", "{", "}"] as const;
const G_MOTIONS = ["g", "e", "E"] as const; // gg ge gE
const CHAR_MOTIONS = ["f", "F", "t", "T"] as const;
const OPERATORS = ["d", "c", "y"] as const;
const SIMPLE = ["x", "X", "D", "C", "s", "S", "Y", "p", "P", "J", "~", "u", "<C-r>", "i", "a", "I", "A", "o", "O"] as const;
const OBJECTS = ["w", "W", "(", ")", "b", "{", "}", "B", "[", "]", "<", ">", '"', "'", "`", "p"] as const;

export type Operator = (typeof OPERATORS)[number];
export type CharMotionKey = (typeof CHAR_MOTIONS)[number];
export type MotionKey = (typeof MOTIONS)[number] | `g${(typeof G_MOTIONS)[number]}` | CharMotionKey;
export type SimpleKey = (typeof SIMPLE)[number] | "r"; // r takes a character first
export type ObjectKey = (typeof OBJECTS)[number];

// arg is the character f/F/t/T search for.
export type MotionSpec = { key: MotionKey; arg?: string };
export type ObjectSpec = { key: ObjectKey; inner: boolean };

// What an operator acts on: a motion, a text object, or (dd, cc, yy) lines.
export type Target = { motion: MotionSpec } | { object: ObjectSpec } | { line: true };

export type Command =
  | { type: "motion"; motion: MotionSpec; count: number | null }
  | {
      type: "operator";
      op: Operator;
      // null when neither count was given; counts multiply (2d3w = 6).
      count: number | null;
      register: string | null;
      target: Target;
    }
  // arg is the character r replaces with.
  | { type: "simple"; key: SimpleKey; count: number | null; register: string | null; arg?: string };

type Feed = { done: true; command: Command | null } | { done: false };

const isIn = <T extends string>(keys: readonly T[], key: string): key is T => (keys as readonly string[]).includes(key);

// A count can't start with 0: that's the line-start motion.
const isCountDigit = (key: string, digitsSoFar: string): boolean => /[1-9]/.test(key) || (key === "0" && digitsSoFar !== "");

// Each stage carries what it has collected beyond the counts and register.
type Stage =
  | { type: "start" } // counts and a register may still come
  | { type: "register" } // after "
  | { type: "g" } // after g, before an operator
  | { type: "char"; key: CharMotionKey | "r" } // f/F/t/T/r waiting for its character, before an operator
  | { type: "operator"; op: Operator } // after d/c/y
  | { type: "op-g"; op: Operator }
  | { type: "op-char"; op: Operator; key: CharMotionKey }
  | { type: "op-object"; op: Operator; inner: boolean }; // after d i / d a

const START: Stage = { type: "start" };

export class Parser {
  private stage: Stage = START;
  private count1 = "";
  private count2 = "";
  private register: string | null = null;
  private typed = "";

  // What's been typed of the current command, for the mode line.
  get pending(): string {
    return this.typed;
  }

  reset(): void {
    this.stage = START;
    this.count1 = this.count2 = "";
    this.register = null;
    this.typed = "";
  }

  feed(key: string): Feed {
    this.typed += key === "<C-r>" ? "^R" : key;
    const result = this.step(key);
    if (result.done) this.reset();
    return result;
  }

  private step(key: string): Feed {
    const stage = this.stage;
    switch (stage.type) {
      case "register":
        this.register = key;
        this.stage = START;
        return { done: false };

      case "start":
        if (isCountDigit(key, this.count1)) {
          this.count1 += key;
          return { done: false };
        }
        if (key === '"' && this.register === null) {
          this.stage = { type: "register" };
          return { done: false };
        }
        if (key === "g") {
          this.stage = { type: "g" };
          return { done: false };
        }
        if (isIn(CHAR_MOTIONS, key) || key === "r") {
          this.stage = { type: "char", key };
          return { done: false };
        }
        if (isIn(OPERATORS, key)) {
          this.stage = { type: "operator", op: key };
          return { done: false };
        }
        if (isIn(MOTIONS, key)) return this.done({ type: "motion", motion: { key }, count: this.count(this.count1) });
        if (isIn(SIMPLE, key)) return this.simple(key);
        return this.done(null);

      case "g":
        if (isIn(G_MOTIONS, key)) return this.done({ type: "motion", motion: { key: `g${key}` }, count: this.count(this.count1) });
        return this.done(null);

      case "char":
        if (stage.key === "r") return this.simple("r", key);
        return this.done({ type: "motion", motion: { key: stage.key, arg: key }, count: this.count(this.count1) });

      case "operator":
        if (isCountDigit(key, this.count2)) {
          this.count2 += key;
          return { done: false };
        }
        if (key === stage.op) return this.operator(stage.op, { line: true });
        if (key === "i" || key === "a") {
          this.stage = { type: "op-object", op: stage.op, inner: key === "i" };
          return { done: false };
        }
        if (key === "g") {
          this.stage = { type: "op-g", op: stage.op };
          return { done: false };
        }
        if (isIn(CHAR_MOTIONS, key)) {
          this.stage = { type: "op-char", op: stage.op, key };
          return { done: false };
        }
        if (isIn(MOTIONS, key)) return this.operator(stage.op, { motion: { key } });
        return this.done(null);

      case "op-g":
        if (isIn(G_MOTIONS, key)) return this.operator(stage.op, { motion: { key: `g${key}` } });
        return this.done(null);

      case "op-char":
        return this.operator(stage.op, { motion: { key: stage.key, arg: key } });

      case "op-object":
        if (isIn(OBJECTS, key)) return this.operator(stage.op, { object: { key, inner: stage.inner } });
        return this.done(null);
    }
  }

  private count(digits: string): number | null {
    return digits === "" ? null : Number(digits);
  }

  private done(command: Command | null): Feed {
    return { done: true, command };
  }

  private simple(key: SimpleKey, arg?: string): Feed {
    return this.done({ type: "simple", key, count: this.count(this.count1), register: this.register, ...(arg === undefined ? {} : { arg }) });
  }

  private operator(op: Operator, target: Target): Feed {
    const a = this.count(this.count1);
    const b = this.count(this.count2);
    const count = a === null && b === null ? null : (a ?? 1) * (b ?? 1);
    return this.done({ type: "operator", op, count, register: this.register, target });
  }
}
