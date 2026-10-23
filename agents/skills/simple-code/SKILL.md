---
name: simple-code
description: Audit and refactor code toward simplicity (Rich Hickey's "Simple Made Easy"), clean code, and idiomatic TypeScript or Go, without changing behavior. Use when asked whether code is clean, simple, or idiomatic, to "clean up", "simplify", or "tidy" a module or directory, or to review code for complexity rather than bugs.
---

# Simple code

Make code simpler without changing what it does. "Simple" here means Hickey's sense: one concern per piece, nothing *complected*, i.e. braided together. It doesn't mean "familiar" or "short." Judge code against [RUBRIC.md](RUBRIC.md). Read it before auditing.

The output is a behavior-preserving refactor that the project's own checks prove, and a short report. Bug fixes are allowed only when you can show the bug with a failing test, and you list each one separately.

## 1. Scope and baseline
- Pin down the target: a path, a directory, or "the X code." If it's a whole tree, list its units, such as one directory or module each, and their sizes.
- Read the project's `AGENTS.md`, README, and config files. Follow its conventions even where the rubric prefers something else. The codebase's idiom wins over a generic one.
- Find every check and run it once: tests, linter, formatter, typecheck, and any mutation or coverage gate. Write down what already fails **before** you touch anything, so you can tell your regressions from existing failures.
- **No typecheck?** If the code is TypeScript run by type stripping (Node, Bun, Deno) with no `tsconfig`, type errors are invisible. Build a throwaway config outside the repo, such as `/tmp/tsconfig.check.json` with `strict`, `noEmit`, `erasableSyntaxOnly` and `verbatimModuleSyntax`, plus `paths` pointing at the installed dependencies. Run `tsc -p` on it. Type errors it finds are real findings. Don't commit the config unless asked.
- **Go:** the baseline is `gofmt -l .` (or the project's formatter), `go vet ./...`, and `go test -race ./...`. Add `staticcheck ./...` or `golangci-lint run` when the project configures them or they're installed. Use the project's `Makefile` or `Taskfile` targets when they exist.

## 2. Audit
For each unit, list findings against the rubric. Give each one a `path:line`, the principle, and one line on why it's worth changing. Rank them by payoff:
1. Things complected together: state with logic, I/O with decisions, two concerns in one function.
2. Unsafe or dishonest types: in TypeScript `any`, unchecked casts and `!`; in Go `interface{}`/`any` where a concrete type fits, and unchecked type assertions. In either, types that allow states that can't happen.
3. Duplication, dead code, and unclear names.
4. Everything else.

Drop anything that is taste, churn, or a rewrite of code that is already simple. Small, honest code that breaks a "rule" is fine. Say so, and leave it alone.

If the user asked a question ("is this clean?"), answer it with the audit and stop. If they asked you to fix it ("make it so", "clean it up"), go on.

## 3. Refactor, one unit at a time
- Make the smallest change that removes each finding. Keep the surrounding style, and don't reformat lines you didn't change.
- Run the checks after every unit. They must stay green.
- Don't add dependencies, abstractions nobody asked for, or options "for later."
- Change tests only to follow a refactor, such as a renamed export or a moved helper. Never weaken an assertion.
- **Mutation gates:** a gate like `mutants.json` holds `from`/`to` text replacements against the source. If you move or rewrite code a mutant targets, update its `from` and `to` so it still expresses **the same fault**. Never delete a mutant to make the gate pass.
- Commit per unit if the user allows commits, with the subject in the imperative and the body giving the why.

**Large scope:** if the target spans several independent directories, split it into one task per directory and run them in parallel. Use a crew (`/crew`) or other workers if available. Budget about one worker per directory, and tell each one to read this skill. Never run two workers on the same files.

## 4. Watch for behavior drift
These are the refactors that looked safe and weren't. Check each one against the old code.

**Any language:**
- **Timers, intervals, listeners, goroutines:** any path that starts one must also run when the stop or shutdown path runs, and no path should start one after shutdown. A leak shows up as a test process that never exits, or in Go as a goroutine leak.
- **Reordered awaits or side effects:** watch persist-then-notify, check-then-act, and anything racing a cancellation.

**TypeScript:**
- **Code moved out of a `try`:** anything that could throw now escapes, and a throw inside an event or stream handler can crash the process. Keep it inside the guard, or show that it can't throw, even on hostile input such as `{ "toString": null }` from parsed JSON.
- **Throw ↔ return:** turning a thrown error into a returned `undefined` or empty value, or the reverse. Callers relied on the old contract.
- **`x ?? []` → `Array.isArray(x) ? x : []`:** this tightens behavior on wrong-typed input. That may be fine, but say so.
- **`str.replace(a, b)` with a string `b`:** `$&`, `$1` and `$$` are special in `b`. Switching to a function replacer changes the output.
- **Exhaustive `switch` with the fallback removed:** this is only safe when the union is truly closed at runtime, not just at compile time.

**Go:**
- **Typed nil in an interface:** returning a typed nil (`var p *MyErr; return p`) as an `error` or other interface makes `err != nil` true.
- **Error wrapping:** `%v` → `%w` makes `errors.Is`/`As` start matching, and `%w` → `%v` makes them stop. A changed sentinel or error type breaks callers' checks the same way.
- **Value vs. pointer receivers:** switching changes which types satisfy an interface, and a value receiver copies the struct, including any `sync.Mutex` in it (`go vet` copylocks).
- **Moving a `defer`:** a `defer` inside a loop runs at function end, not per iteration. Extracting the loop body into a function changes when it runs.
- **Loop variable capture:** before Go 1.22 each closure or goroutine shared one loop variable. Check the `go` version in `go.mod` before "simplifying" `v := v`.
- **Map iteration order** is random. Replacing a sorted slice with a map, or the reverse, changes output order.
- **Nil vs. empty slice:** `nil` encodes to JSON as `null` and `[]T{}` as `[]`, and `reflect.DeepEqual` tells them apart.
- **Context plumbing:** dropping a `ctx` parameter, or replacing it with `context.Background()`, breaks cancellation and deadlines.

## 5. Verify and review
- Run every check again. For any failure called "pre-existing", prove it by running the same check at the base commit; don't trust the claim.
- For a large change, run `/review-loop` on it if it exists, with the bar "any runtime behavior change that isn't an intended fix is a finding." Otherwise get one clean-context review against the same bar.

## 6. Report
- **Verdict:** the short answer to "is it clean?", before and after.
- **Changed:** per unit, the main simplifications.
- **Left alone on purpose:** each item with its reason.
- **Fixed bugs:** each one, with the failing test that proved it.
- **Risks:** behavior changes not covered by tests, and checks you couldn't run.
- **Follow-ups:** for example, "commit a typecheck config", or "these tests are flaky".
