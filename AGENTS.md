# @marianmeres/tracker — Agent Guide

## Quick Reference

- **Stack**: Deno + TypeScript, dnt-built npm package, JSR-published
- **Runtime**: Browser + Deno + Node (no DOM-only globals at module scope)
- **Test**: `deno task test` | **Watch**: `deno task test:watch`
- **Build npm**: `deno task npm:build` | **Publish**: `deno task publish`
- **Release**: `deno task rp` (patch) | `deno task rpm` (minor)

## What This Is

A framework-agnostic client for emitting application events and forwarding them
to a transport in batches. Wraps [`@marianmeres/batch`](https://jsr.io/@marianmeres/batch)
with identity, context, enrichment, middleware, and an opt-in browser unload
helper.

**Out of scope**: schema validation, page-view auto-tracking, retry/backoff
(layer in transport), framework adapters.

## Project Structure

```
/src
  mod.ts            — public exports
  tracker.ts        — Tracker class, types, options
  unload.ts         — attachUnloadFlush() browser helper
  /internal
    enrichers.ts    — buildEnvelope() (eventId, timestamp, identity stamp)
    uuid.ts         — UUID v4 with progressive fallbacks
/tests              — Deno test files, one per concern
/scripts/build-npm.ts — dnt build for npm publishing
```

## Critical Conventions

1. **Sync `track()`** — never await; envelope is built and enqueued in one synchronous call.
2. **Capture-at-track-time** — `eventId`, `timestamp`, `context`, and `traits` are snapshotted when `track()` runs, not at flush.
3. **Transport return semantics** — `true`/`void` = consumed; `false` = dropped; throw = requeued at head. Mirror `@marianmeres/batch` exactly.
4. **No DOM at module scope** — `attachUnloadFlush()` must remain a no-op in non-browser runtimes; runtime-detect `addEventListener`, `navigator.sendBeacon`, `document.visibilityState`.
5. **Permissive default `EventMap`** — `Tracker` without a generic argument (and explicitly `Tracker<EventMap>`, which `unload.ts` uses) must accept any string event name and arbitrary payload. "Permissive" means precisely **a map with a string index signature and _zero_ declared keys**. That is the load-bearing discriminator in `EventName<M>`: index signature **and** declared keys = a map opened by accident (`interface X extends EventMap`) and is rejected. Do not "simplify" the `DeclaredKeys` check away — without it there is no predicate that separates the sanctioned open map from the bug.
6. **Constrain event-map generics with `ValidEventMap<M>`** — never `M extends EventMap`. The structural form requires a string index signature, which a plain `interface` lacks; rejecting plain interfaces is what pushed consumers into `extends EventMap` in the first place. Every public generic (`Tracker`, `TrackerOptions`, `TrackedEvent`, `Enricher`, `Middleware`, `buildEnvelope`) must use the same constraint — a partial change still compiles here and only breaks in consumer code that names the type directly.
7. **Tabs, not spaces** — `deno.json` enforces `useTabs: true`, `indentWidth: 4`, `lineWidth: 90`.

## Before Making Changes

- [ ] Read [docs/architecture.md](./docs/architecture.md) for the event lifecycle
- [ ] Check [docs/conventions.md](./docs/conventions.md) for patterns/anti-patterns
- [ ] Run `deno task test` before and after
- [ ] Type tests live in [tests/tracker.types.test.ts](./tests/tracker.types.test.ts) — update them when changing the public type surface

## Documentation Index

- [Architecture](./docs/architecture.md) — event lifecycle, component map, data flow
- [Conventions](./docs/conventions.md) — code patterns, error handling, testing
- [Tasks](./docs/tasks.md) — adding options, middleware, releasing
- [Public API (human)](./API.md) — full reference for consumers
