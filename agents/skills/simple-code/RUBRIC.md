# Rubric: simple, clean, idiomatic

Use this as a lens, not a checklist to max out. A finding needs a reason that matters to the next reader or the next change.

## Simple vs. easy (Rich Hickey, "Simple Made Easy")
**Simple** means one fold: one role, one concept, one dimension. It is objective; you can point at the braid. **Easy** means near at hand, or familiar. Choose simple even when it's less familiar. Complexity is what you get when you *complect*, i.e. braid together, things that could be independent.

| Complects | What gets braided | Simpler alternative |
|---|---|---|
| Mutable state | value + time | Values: `const`, `readonly`, new objects instead of mutation; in Go, value types and returning new values instead of mutating through pointers |
| Objects/classes with state | state + identity + value + behavior | Plain data plus functions over it |
| Methods | function + state (+ namespace) | Module-level functions that take what they need |
| Inheritance | types with each other | Composition, and small interfaces or types |
| Conditionals and `switch` scattered over "kinds" | who + what, everywhere | A discriminated union handled in one place, or a lookup table |
| Positional arguments and ordered structures | meaning + order | Named fields: options objects, records, or a config struct in Go |
| Imperative loops | what + how | `map`/`filter`/`reduce` in TypeScript, or a named helper when that is clearer. In Go a plain `for` loop *is* the idiom; extract a named function instead of reaching for generic helpers |
| I/O inside logic | decisions + effects | A pure core that decides, with a thin shell doing the I/O |
| Hidden globals and singletons | every caller + one instance | Pass dependencies in as parameters; a factory argument is a fine seam |
| Ad-hoc string protocols | parsing + meaning + format | Typed data structures; parse once at the boundary |

**Questions to ask:**
- **Can I understand this piece without loading another piece into my head?** If not, find out what's braided.
- **Can I change one concern without touching another?**
- **Is this decision made in one place, or repeated wherever the data is used?**
- **Is this state needed, or is it a value computed from other values?** Derive it instead of storing and syncing it.

## Clean code
- **Names** say intent and role, at the level of the reader. They don't say type or mechanism. A name that needs a comment is the wrong name. Booleans read as predicates, such as `isActive` or `hasUI`.
- **Functions** do one thing at one level of abstraction. Split one when you can name the parts. Don't split just to hit a line count. Reading top to bottom should tell the story: high level first, helpers below or in a module.
- **Arguments:** three or more, or any boolean flag argument, usually means a missing named object or two functions.
- **Commands vs. queries:** a function either changes something or answers something. Hidden side effects in a "getter" are a finding.
- **Duplication:** extract on the third occurrence, or sooner if the copies must change together. Two similar-looking things that change for different reasons are not duplication.
- **Errors** are explicit. Never swallow one: no empty `catch`, and no `catch` that hides a different error than the one it was written for. Keep guard blocks tight around what can actually fail. Expected outcomes can be return values, and broken invariants throw. In Go, handle or return every `error` once; logging it *and* returning it means it gets reported twice.
- **Comments** say *why*: constraints, gotchas, links to outside behavior. Delete comments that say *what*, and fix the code instead.
- **Dead code**, unused exports, and commented-out code get deleted. Git remembers.
- **Magic values** get a name, unless the literal is clearer than the name, such as `0`, `1` or `""`.

## Composition over inheritance
- Build behavior by combining functions and plain objects, not by subclassing. Use a class when it fits real lifecycle or identity, such as a resource with open/close or a framework that requires one, or when it's the project's idiom.
- Depend on the smallest shape you use, such as `{ run(job): Promise<Result> }`, not on a concrete class.
- Inject collaborators through parameters, for example a factory's second argument `{ runWorker }`, so tests can substitute them without monkey-patching.
- Keep extension points to what's needed today. An interface with one implementation and no test seam is speculation.
- **Go:** struct embedding is composition, but it also promotes every method of the embedded type into your API. Embed only when you mean "is usable as"; otherwise use a named field.

## Idiomatic TypeScript
- **Make illegal states unrepresentable:** use discriminated unions (`{ kind: "ok", value } | { kind: "error", error }`) over bags of optional fields. Handle them with an exhaustive `switch`, ending in `const _exhaustive: never = x` when a fallback would be unreachable.
- **`unknown` at boundaries,** narrowed with type guards (`x is T`), instead of `any` or `as T`. Parse external data, like JSON, CLI arguments and env vars, once at the edge into typed values.
- **No `!`:** restructure so the type proves presence, with an early return, a guard, or a narrowed variable.
- **Immutable by default:** `const`, `readonly` fields and arrays, `as const` for literal tables, and `satisfies` to check a literal without widening it.
- **Derive types from data,** not the other way around: `keyof typeof TABLE`, `(typeof LIST)[number]`, `ReturnType<typeof f>`. One source of truth.
- **Literal unions over `enum`,** plain objects or modules over `namespace`, and explicit fields over parameter properties. These are required under type stripping (`erasableSyntaxOnly`), and they're simpler anyway.
- **Imports:** `import type` for type-only imports, and match the project's extension style (`./x.ts` under type stripping).
- **Async:** `async`/`await` over `.then` chains. Don't leave a promise floating: `await` it, return it, or `void` it with a comment saying why. Make cancellation flow through an `AbortSignal`.
- **Narrow return types:** functions return what they mean, such as `string | undefined`, rather than a sentinel like `""` or `-1` that needs a comment.

## Idiomatic Go
Go's own idiom is already close to Simple Made Easy: plain structs, functions, small interfaces, explicit errors. Most findings are places where code imported another language's habits.
- **Accept interfaces, return structs:** define interfaces where they're *consumed*, small, often one method (`io.Reader`). Don't create a `FooInterface` next to `Foo` "for mocking" unless a consumer needs it.
- **Errors are values:** return `error` last, and check it right away. Wrap with context using `fmt.Errorf("loading %s: %w", name, err)`, and match with `errors.Is`/`errors.As`, never by comparing strings. Use sentinels (`var ErrNotFound = errors.New(...)`) or typed errors only when callers branch on them. `panic` is for programmer errors, not for control flow.
- **Happy path on the left:** early returns, and no `else` after a `return`. Deep nesting is a finding.
- **Make the zero value useful,** so a struct works without a constructor where it can, like `sync.Mutex` or `bytes.Buffer`. Use a `NewX` function when there are invariants to establish.
- **Concurrency:** don't start a goroutine without knowing how it stops. Give it a `context.Context`, a `done` channel or a `sync.WaitGroup`/`errgroup`. Share memory by communicating, or guard it with a mutex that lives next to the data it protects. `ctx context.Context` is the first parameter, and is never stored in a struct.
- **Packages** are named for what they provide, short and lowercase, with no `util`, `common` or `helpers`. Avoid stutter (`log.Logger`, not `log.LogLogger`). Unexported by default; export what callers need.
- **Names:** short in small scopes (`i`, `r`, `buf`), descriptive in large ones. Receivers are one or two letters, consistent across the type's methods. Initialisms keep one case: `ID`, `URL`, `HTTP`.
- **Enums as typed constants:** `type State int` with an `iota` block, plus a `String()` method or `stringer` when the values are printed. Switches over them get a `default` that handles or reports unknown values.
- **Generics** are for real type-parametric code, like containers and algorithms over `T`. Don't use them for one or two call sites, or as a replacement for a small interface.
- **Options:** use a config struct for more than about three parameters. Functional options (`WithTimeout(...)`) are only for public APIs with many optional settings.
- **Tests:** table-driven tests with `t.Run` subtests, and `t.Helper()` in assertion helpers. Use fakes through small interfaces rather than mock frameworks, where the project allows.
