# Tasks

Common procedures for working in this repo.

---

## Add a new `TrackerOptions` field

### Steps

1. Add the field (with `?:` and JSDoc default) to `TrackerOptions` in [`src/tracker.ts`](../src/tracker.ts).
2. Apply a default in the constructor (`options.foo ?? defaultValue`).
3. Wire it into the relevant code path (constructor, `track()`, batch options).
4. Add a focused test under `tests/` — copy an existing file as a template.
5. If it changes the public surface, update [API.md](../API.md) and the `## API` table in [README.md](../README.md).

### Checklist

- [ ] Default documented in JSDoc (`@default ...`)
- [ ] Falls through to a no-op when omitted
- [ ] Test pairs `new Tracker(...)` with `dispose()`
- [ ] [API.md](../API.md) updated

---

## Add a new `Tracker` method

### Steps

1. Add the method to the `Tracker` class in [`src/tracker.ts`](../src/tracker.ts) with a single-line JSDoc summary.
2. If it touches batch state (size, flushing, running), call `this.#notify()` so subscribers see the change.
3. Add a test file or extend an existing one — see [tests/tracker.test.ts](../tests/tracker.test.ts).
4. Re-export type if relevant from [`src/mod.ts`](../src/mod.ts).
5. Update [API.md](../API.md) under `## Methods`.

### Template

```ts
/** [One-line description.] */
foo(arg: ArgType): ReturnType {
    // ...
    this.#notify(); // only if state changed
}
```

### Checklist

- [ ] JSDoc one-liner
- [ ] Test asserts both happy path and dispose path
- [ ] [README.md](../README.md) usage section updated if user-facing

---

## Add a new public export

### Steps

1. Add the export to its source file in `src/`.
2. Add the re-export line to [`src/mod.ts`](../src/mod.ts) — separate `export { ... }` and `export type { ... }`.
3. Run `deno task test` (which `deno check`s `src/mod.ts` transitively).
4. Document in [API.md](../API.md).

### Checklist

- [ ] Re-exported from [`src/mod.ts`](../src/mod.ts)
- [ ] Listed in [API.md](../API.md)
- [ ] Doesn't accidentally export from `src/internal/`

---

## Run tests

```bash
deno task test           # one-shot
deno task test:watch     # watch mode
```

`deno test` runs `deno check` on all imported modules, so type-level errors
in [tests/tracker.types.test.ts](../tests/tracker.types.test.ts) fail the suite.

---

## Build npm package

```bash
deno task npm:build      # builds into ./.npm-dist
```

The build is driven by [scripts/build-npm.ts](../scripts/build-npm.ts) using
`@marianmeres/npmbuild` (a dnt wrapper). `versionizeDeps([...], denoJson)`
pins runtime dependencies — keep that array in sync with new runtime
dependencies (NOT dev/test ones).

---

## Release

| Bump  | Command              |
| ----- | -------------------- |
| Patch | `deno task rp`       |
| Minor | `deno task rpm`      |

Both run `@marianmeres/deno-release` (which writes the new version to
`deno.json` and creates a git tag) followed by `deno publish` (JSR) and
`npm publish` (after `npm:build`).

### Pre-release checklist

- [ ] All tests pass (`deno task test`)
- [ ] [README.md](../README.md) and [API.md](../API.md) reflect the surface
- [ ] CHANGELOG (if any) updated
- [ ] No `tmp/` debris committed

See `/Users/mm/projects/@marianmeres/agents/mm-local-docs/PRE_RELEASE_DOCS_UPDATE.md` for the full pre-release docs sweep.

---

## Trace what flushes a batch

Three triggers, in priority order:

1. **Threshold** — `batch.add()` synchronously fires a flush when buffer length reaches `flushThreshold`. Fire-and-forget; `await tracker.flush()` in tests to settle.
2. **Interval** — `BatchFlusher`'s internal `setInterval` ticks every `flushIntervalMs`. Use `FakeTime` from `@std/testing/time` to drive it deterministically.
3. **Manual** — `tracker.flush()` (one-shot) or `tracker.drain()` (flush + stop the timer).

Inspect without flushing: `tracker.dump()` returns the buffered envelopes.
Discard without flushing: `tracker.clear()`.
