# Architecture

## Overview

`Tracker` is a thin orchestration layer over `@marianmeres/batch`. It owns
identity (`userId`, `traits`, `sessionId`) and super-properties (`context`),
builds canonical event envelopes, runs enrichers + middleware, then hands
envelopes to a `BatchFlusher` for batched delivery.

## Component Map

```
┌──────────────────────────────────────────────────────────────────┐
│ Tracker<TEventMap>                                               │
│                                                                  │
│  identity:    sessionId, userId, traits, context                 │
│  pipeline:    buildEnvelope → enrichers → middleware → batch.add │
│  controls:    pause, resume, dispose                             │
│  state:       size, isFlushing, isRunning, isPaused, dropped     │
│                                                                  │
│   ┌────────────────┐         ┌─────────────────────────────┐     │
│   │ buildEnvelope  │         │ BatchFlusher (@marianmeres) │     │
│   │ (internal)     │  ──▶    │  — interval/threshold flush │     │
│   │ stamps id+ts   │         │  — requeue / drop / pubsub  │     │
│   └────────────────┘         └──────────────┬──────────────┘     │
│                                             │                    │
└─────────────────────────────────────────────┼────────────────────┘
                                              ▼
                              transport(events) → boolean | void

┌────────────────────────────────────────────────────────────────┐
│ attachUnloadFlush(tracker, opts?)   [browser-only, opt-in]     │
│                                                                │
│  pagehide / visibilitychange:hidden                            │
│   ├─ if beaconUrl + sendBeacon available → POST + tracker.clear│
│   └─ else                                  → tracker.drain()   │
│  pageshow → reset hasFiredOnce guard                           │
└────────────────────────────────────────────────────────────────┘
```

## Data Flow: A Single `track()` Call

```
track(name, data)
    │
    ▼
[1] paused?  ── yes ──▶ debug-log + return
    │ no
    ▼
[2] buildEnvelope(name, data, identity)
        eventId = uuid()
        timestamp = new Date().toISOString()
        sessionId, userId, traits cloned
        context cloned (shallow)
    │
    ▼
[3] enrichers run in declaration order (each: TrackedEvent → TrackedEvent)
    │
    ▼
[4] debug? log enriched envelope
    │
    ▼
[5] middleware runs in declaration order (each: TrackedEvent → TrackedEvent | null)
        any returns null → drop, return
    │
    ▼
[6] batch.add(envelope)
        — may trigger threshold-based fire-and-forget flush
        — interval timer eventually flushes
    │
    ▼
transport(events) when batch fires
        true / void → consumed
        false       → dropped (BatchFlusher onDrop)
        throw       → requeued at head (BatchFlusher onFlushError)
```

## Time-Capture Invariants

| Field        | Captured at | Reason                                      |
| ------------ | ----------- | ------------------------------------------- |
| `eventId`    | track time  | stable identity for dedup/correlation       |
| `timestamp`  | track time  | preserves order despite flush latency       |
| `context`    | track time  | mutations after `track()` don't retroactive |
| `traits`     | track time  | snapshot of identity at the moment of event |
| `sessionId`  | track time  | rotates on `reset()`                        |

Shallow clones are used. Nested mutations *can* leak into queued events; this
is documented behavior, not a bug.

## State Subscription

`Tracker` exposes a Svelte-store-shaped `subscribe()` whose payload is a flat
`TrackerState`:

| Field          | Source                               |
| -------------- | ------------------------------------ |
| `size`         | `BatchFlusher` queue length          |
| `isFlushing`   | `BatchFlusher` in-flight flag        |
| `isRunning`    | `BatchFlusher` timer running         |
| `isPaused`     | `Tracker` own flag                   |
| `droppedCount` | `BatchFlusher.droppedCount` getter   |

Internally the tracker subscribes to `BatchFlusher` once, caches the last
state, and re-emits via its own `pubsub` whenever batch state changes OR
`pause/resume` toggles.

## External Dependencies

| Package                  | Why                                                |
| ------------------------ | -------------------------------------------------- |
| `@marianmeres/batch`     | Buffer + interval/threshold flush + requeue logic  |
| `@marianmeres/pubsub`    | Tiny pub/sub for `subscribe()`                     |
| `@marianmeres/npmbuild`  | dnt wrapper used by `scripts/build-npm.ts` (build) |
| `@std/assert` / testing  | Test-only                                          |

## Key Files

| File                            | Purpose                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| `src/mod.ts`                    | Public re-exports — keep this in sync with new exports     |
| `src/tracker.ts`                | `Tracker` class, all option/state/event types              |
| `src/unload.ts`                 | `attachUnloadFlush` browser helper                         |
| `src/internal/enrichers.ts`     | `buildEnvelope` — the canonical envelope shape lives here  |
| `src/internal/uuid.ts`          | UUID v4 with `crypto.randomUUID` → `getRandomValues` → Math.random fallbacks |
| `tests/_shared.ts`              | `createTransport()` test double + `silentLogger`           |

## Boundary Notes

- **Never throw from `track()`**: enrichers/middleware bugs propagate; this is intentional. Transports may throw to trigger requeue.
- **No retry policy in tracker**: requeue-at-head comes from `@marianmeres/batch` on transport throw. Backoff/max-attempts must live inside the consumer transport.
- **Beacon path is browser-only**: `attachUnloadFlush` runtime-detects `addEventListener`, `navigator.sendBeacon`, `document`. In Deno/Node it returns a no-op detach.
