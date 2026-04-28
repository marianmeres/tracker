# @marianmeres/tracker

[![JSR](https://jsr.io/badges/@marianmeres/tracker)](https://jsr.io/@marianmeres/tracker)
[![NPM](https://img.shields.io/npm/v/@marianmeres/tracker)](https://www.npmjs.com/package/@marianmeres/tracker)
[![License](https://img.shields.io/npm/l/@marianmeres/tracker)](LICENSE)

A small, framework-agnostic client for emitting **application events**
(user/session/UI signals) and forwarding them to a transport in **batches**.

Built on top of [`@marianmeres/batch`](https://jsr.io/@marianmeres/batch). The
package is vanilla — no Svelte/React glue, no automatic page-view tracking,
no schema validation. Consumers wire those in if they want them.

## Installation

```bash
deno add jsr:@marianmeres/tracker
# or
npm install @marianmeres/tracker
```

## Usage

```ts
import { Tracker, attachUnloadFlush } from "@marianmeres/tracker";

type Events = {
    "chat.mode.toggle": { from: "voice" | "text"; to: "voice" | "text" };
    "quiz.skip":        { moduleId: string; questionId?: string };
    "menu.enter":       { item: string } | undefined;
};

const tracker = new Tracker<Events>({
    transport: async (events) => {
        await fetch("/api/events", {
            method: "POST",
            body: JSON.stringify({ events }),
        });
    },
    flushIntervalMs: 5000,
    flushThreshold: 50,
    context: { appVersion: "1.2.3" },
});

tracker.identify("user-123", { plan: "pro" });
tracker.track("chat.mode.toggle", { from: "voice", to: "text" });
tracker.track("quiz.skip", { moduleId: "m1" });
tracker.track("menu.enter"); // payload optional because the type includes `undefined`

// Browser only: flush queued events on tab close.
attachUnloadFlush(tracker, { beaconUrl: "/api/events/beacon" });
```

## Features

- **Type-safe event map** — declare a `TEventMap` and `track()` autocompletes event names + enforces payload shape. Without a map the API stays permissive.
- **Batching** — interval + threshold-based, with a hard `maxBatchSize` cap.
- **Transport contract** — `true` consumed, `false` dropped, throw to requeue at head. No built-in retry/backoff (layer it inside your transport).
- **Enrichers + middleware** — synchronous transformers / drop hooks for PII scrubbing, allow-lists, consent gates, etc.
- **Identify / reset / setContext** — userId, traits, and super-properties stamped onto every event at `track()` time.
- **Pause / resume** — useful during opt-out flows; queued events survive.
- **Reactive subscription** — Svelte-store-shaped `subscribe(state => ...)`.
- **Browser unload helper** — opt-in `attachUnloadFlush()` flushes via `navigator.sendBeacon` (when `beaconUrl` is provided) or falls back to a best-effort `drain()` on `pagehide` / `visibilitychange:hidden`.

## API

See [API.md](API.md) for the complete API reference.

## License

[MIT](LICENSE)
