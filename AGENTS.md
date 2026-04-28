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
5. **Permissive default `EventMap`** — `Tracker` without a generic argument must accept any string event name and arbitrary payload.
6. **Tabs, not spaces** — `deno.json` enforces `useTabs: true`, `indentWidth: 4`, `lineWidth: 90`.

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
