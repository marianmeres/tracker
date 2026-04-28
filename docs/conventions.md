# Conventions

## File Organisation

- Public surface is exported only from [`src/mod.ts`](../src/mod.ts).
- Anything under [`src/internal/`](../src/internal/) is private — never import it from tests or examples that exercise the public API.
- One concern per test file under [`tests/`](../tests/) (`tracker.batching.test.ts`, `tracker.identify.test.ts`, ...). Add a new file rather than appending unrelated tests.

## Naming

- Types: `PascalCase` (`TrackedEvent`, `TrackerOptions`, `Enricher`).
- Methods: `camelCase` verbs (`track`, `identify`, `flush`, `drain`, `dispose`).
- Internal class fields: `#privateName` (ECMAScript private). Do not use TypeScript `private`.
- Generics: `M` for an event map inside internal helpers, `TEventMap` on the public class.

## Formatting

Enforced by `deno fmt` per [`deno.json`](../deno.json):

- Tabs (width 4).
- Line width 90.
- `proseWrap: preserve` — do not auto-rewrap markdown.

## Patterns

### Always synchronous `track()`

```ts
// ✅ Do
tracker.track("evt.name", { foo: 1 });

// ❌ Don't — never make track() async
await tracker.track("evt.name");
```

### Capture identity/context at track time

```ts
// ✅ Do — buildEnvelope clones context shallowly into the envelope.
return { ...identity.context };

// ❌ Don't — passing the live context reference would let later mutations
//          retroactively change queued events.
return identity.context;
```

### Transport return contract — mirror `@marianmeres/batch` exactly

```ts
// ✅ Do — preserve all four cases
const result = await options.transport(events);
return result === undefined ? true : result;
```

| return  | meaning                                  |
| ------- | ---------------------------------------- |
| `true`  | success — items consumed                 |
| `void`  | treated as `true`                        |
| `false` | handled failure — items dropped          |
| _throw_ | requeued at head, retried on next flush  |

### Runtime-detect browser globals

```ts
// ✅ Do
const addListener = (target as { addEventListener?: ... }).addEventListener;
if (typeof addListener !== "function") return () => {};

// ❌ Don't — module-scope reference to window/document/navigator breaks SSR.
window.addEventListener("pagehide", ...);
```

### `EventMap` + `TrackArgs` ergonomics

```ts
// ✅ Do — make data optional only when payload type includes undefined
type TrackArgs<T> = undefined extends T ? [data?: T] : [data: T];

// ❌ Don't — `T extends undefined` is the wrong direction and breaks
//   indexed-access types under strict mode.
type Bad<T> = T extends undefined ? [data?: T] : [data: T];
```

## Error Handling

- `Tracker` itself does not retry. Throw from your transport to requeue.
- Logger calls go through `this.#logger` so consumers can inject `silentLogger` in tests.
- `dispose()` does NOT flush — use `drain()` for clean shutdown. `dispose()` is for test cleanup where pending events are intentionally discarded.

## Anti-Patterns

| Don't                                              | Do instead                                              |
| -------------------------------------------------- | ------------------------------------------------------- |
| Make `track()` async                               | Keep enqueue synchronous                                |
| Mutate `envelope` in enrichers/middleware in place | Return a new object (`{ ...e, context: { ...e.context, k: v } }`) |
| Reference `window`/`document` at module scope      | Detect at call-site via `globalThis`                    |
| Add retry/backoff inside `Tracker`                 | Implement inside the consumer transport                 |
| Import from `src/internal/` outside the package    | Promote to a public export via `mod.ts` if needed       |
| Use TypeScript `private`                           | Use `#field` ECMAScript private                         |
| Add new options without a default                  | Every option has a default in the constructor           |

## Testing

- `Deno.test` with `@std/assert` and `@std/testing/time` (`FakeTime`).
- Always use [`createTransport()`](../tests/_shared.ts) and [`silentLogger`](../tests/_shared.ts) — don't reinvent fakes.
- Always pair every `new Tracker(...)` with `tracker.dispose()` (or `await tracker.drain()` then `dispose()`) at the end of the test, otherwise the interval timer leaks across tests.
- Threshold flushes are fire-and-forget — `await tracker.flush()` after the threshold is hit to settle the in-flight promise before asserting.
- Type-level assertions live in [`tests/tracker.types.test.ts`](../tests/tracker.types.test.ts) and rely on `// @ts-expect-error` comments. They never execute at runtime; `deno check` (run by `deno test`) validates them.

## Imports

Use bare specifiers from `deno.json` `imports` map. When adding a new dependency, also list it in [`scripts/build-npm.ts`](../scripts/build-npm.ts) inside `versionizeDeps([...])` so it's pinned in the generated `package.json`.

```ts
// ✅ Do
import { BatchFlusher } from "@marianmeres/batch";

// ❌ Don't — relative or absolute jsr URLs scattered through src
import { BatchFlusher } from "https://jsr.io/.../batch/...";
```
