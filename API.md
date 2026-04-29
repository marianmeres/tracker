# API

Public surface of `@marianmeres/tracker`. All exports come from the package
root.

```ts
import {
    Tracker,
    attachUnloadFlush,
    type EventMap,
    type TrackedEvent,
    type Enricher,
    type Middleware,
    type TrackerOptions,
    type TrackerState,
    type AttachUnloadFlushOptions,
} from "@marianmeres/tracker";
```

---

## Classes

### `Tracker<TEventMap>`

Buffers events, runs them through enrichers + middleware, and forwards
batches to a transport. `TEventMap` is optional — when provided, `track()`
autocompletes event names and enforces payload shapes.

#### `new Tracker<TEventMap>(options)`

**Parameters:**

- `options` ([`TrackerOptions<TEventMap>`](#trackeroptionsteventmap)) — see below.

**Example:**

```ts
type Events = {
    "chat.toggle": { from: "voice" | "text"; to: "voice" | "text" };
    "menu.enter": { item: string } | undefined;
};

const tracker = new Tracker<Events>({
    transport: async (events) => {
        await fetch("/api/events", {
            method: "POST",
            body: JSON.stringify({ events }),
        });
    },
    flushIntervalMs: 1000,
    flushThreshold: 50,
    context: { appVersion: "1.2.3" },
});
```

#### Methods

##### `track(name, data?)`

Enqueue an event. Synchronous — returns immediately after enqueue.

**Parameters:**

- `name` (`keyof TEventMap & string`) — event name.
- `data` (`TEventMap[name]`, optional when the payload type includes `undefined`) — payload.

**Returns:** `void`

**Example:**

```ts
tracker.track("chat.toggle", { from: "voice", to: "text" });
tracker.track("menu.enter"); // payload optional because type includes undefined
```

##### `identify(id, traits?)`

Attach a user identity. Future events carry `userId` + `traits`. Does not
affect already-queued events.

**Parameters:**

- `id` (`string`) — user identifier.
- `traits` (`Record<string, unknown>`, optional) — arbitrary user attributes.

**Returns:** `void`

##### `reset()`

Clear user identity and rotate `sessionId`. Does NOT flush queued events
(they keep the previous identity already stamped on them) and does NOT
clear super-properties.

**Returns:** `void`

##### `setContext(patch, mode?)`

Replace or extend super-properties merged into every event.

**Parameters:**

- `patch` (`Record<string, unknown>`) — keys to set.
- `mode` (`"merge" | "replace"`, optional) — default: `"merge"`. `"replace"` wipes the existing context first.

**Returns:** `void`

**Example:**

```ts
tracker.setContext({ route: "/foo" });            // shallow merge
tracker.setContext({ ab: { variant: "B" } }, "replace"); // wipe-and-set
```

##### `flush()`

Force an immediate flush.

**Returns:** `Promise<boolean>` — resolves to the underlying batch flush result (`true` consumed, `false` dropped). Throws if the transport throws.

##### `drain()`

Flush and stop the auto-flush timer. Use for shutdown / page unload paths.

**Returns:** `Promise<void>`

##### `pause()` / `resume()`

While paused, `track()` is a no-op for the queue (debug logging still fires). Already-queued events are unaffected. State subscribers are notified on toggle.

**Returns:** `void`

##### `subscribe(fn)`

Subscribe to state changes. Callback fires immediately with the current state, then on every subsequent change.

**Parameters:**

- `fn` (`(state: TrackerState) => void`)

**Returns:** `() => void` — unsubscribe.

##### `getState()`

Synchronous snapshot of `TrackerState`.

**Returns:** [`TrackerState`](#trackerstate)

##### `dump()`

Snapshot the buffered events without flushing. Useful for beacon paths or diagnostics.

**Returns:** `TrackedEvent<TEventMap>[]`

##### `clear()`

Drop the buffer without flushing.

**Returns:** `void`

##### `dispose()`

Tear down internal subscriptions and stop the auto-flush timer WITHOUT flushing. Use in test cleanup; for production shutdown prefer `drain()`.

**Returns:** `void`

#### Properties

##### `sessionId`

Read-only current session id. Rotates on `reset()`.

**Type:** `string`

---

## Functions

### `attachUnloadFlush(tracker, options?)`

Wires `pagehide` and `visibilitychange:hidden` listeners that flush the
tracker when the tab closes or hides. Returns a detach function. Safe to
call in non-browser runtimes — becomes a no-op when `addEventListener` is
unavailable.

**Parameters:**

- `tracker` (`Tracker<any>`) — the tracker to flush.
- `options` ([`AttachUnloadFlushOptions`](#attachunloadflushoptions), optional)

**Returns:** `() => void` — detach the listeners.

**Behavior:**

When `beaconUrl` is set and `navigator.sendBeacon` is available, the
buffered queue is POSTed via beacon and the regular transport is skipped
(the buffer is then cleared). If `sendBeacon` returns `false` (typically
because the payload exceeds the ~64KB browser limit), the helper falls
back to a best-effort `tracker.drain()`.

A `pageshow` listener resets the internal `hasFiredOnce` guard so
back-forward cache restores can re-arm the flush.

**Example:**

```ts
const detach = attachUnloadFlush(tracker, {
    beaconUrl: "/api/events/beacon",
});

// later
detach();
```

---

## Types

### `EventMap`

```ts
type EventMap = Record<string, Record<string, unknown> | undefined>;
```

Map of event name → payload type. Pass as a generic to `Tracker<MyEvents>`
to get autocomplete + payload enforcement. Without a generic argument,
`Tracker` accepts any string name and arbitrary payload.

### `TrackedEvent<M>`

```ts
interface TrackedEvent<M extends EventMap = EventMap> {
    eventId: string;
    name: keyof M & string;
    data: M[keyof M & string];
    timestamp: string;       // ISO-8601, captured at track time
    sessionId: string;
    userId: string | null;
    traits: Record<string, unknown> | null;
    context: Record<string, unknown>;
}
```

The fully-built envelope passed to enrichers, middleware, and transport.

### `Enricher<M>`

```ts
type Enricher<M extends EventMap = EventMap> =
    (e: TrackedEvent<M>) => TrackedEvent<M>;
```

Synchronous transformer applied to every event after envelope construction
and before middleware. Run in declaration order.

### `Middleware<M>`

```ts
type Middleware<M extends EventMap = EventMap> =
    (e: TrackedEvent<M>) => TrackedEvent<M> | null;
```

Like `Enricher` but may return `null` to drop the event silently. Run in
declaration order, after enrichers.

### `TrackerOptions<TEventMap>`

| Field             | Type                                                  | Default       | Notes                                                                 |
| ----------------- | ----------------------------------------------------- | ------------- | --------------------------------------------------------------------- |
| `transport`       | `(events: TrackedEvent<TEventMap>[]) => Promise<boolean \| void>` | _required_ | See [Transport contract](#transport-contract)                          |
| `flushIntervalMs` | `number`                                              | `1000`        | Auto-flush cadence                                                    |
| `flushThreshold`  | `number`                                              | `50`          | Flush immediately at N items                                          |
| `maxBatchSize`    | `number`                                              | `500`         | Drop oldest when buffer exceeds this                                  |
| `debug`           | `boolean`                                             | `false`       | Tee every event through `logger.log` at track time                    |
| `logger`          | `Pick<Console, "log" \| "warn" \| "error">`           | `console`     | Used for debug + internal warnings                                    |
| `enrichers`       | `Enricher<TEventMap>[]`                               | `[]`          | Sync transformers, run in declaration order                           |
| `middleware`      | `Middleware<TEventMap>[]`                             | `[]`          | Like enrichers; may return `null` to drop                             |
| `context`         | `Record<string, unknown>`                             | `{}`          | Initial super-properties                                              |
| `user`            | `{ id: string; traits?: Record<string, unknown> }`    | _none_        | Same as calling `identify(user.id, user.traits)` after construction   |
| `sessionId`       | `string`                                              | random UUID   | Stable session id; rotates on `reset()`                               |

### `TrackerState`

```ts
interface TrackerState {
    size: number;          // queued events
    isFlushing: boolean;   // a transport call is in flight
    isRunning: boolean;    // auto-flush timer active
    isPaused: boolean;     // pause() called
    droppedCount: number;  // cumulative dropped items
}
```

### `AttachUnloadFlushOptions`

| Field        | Type                                                | Default                                | Notes                                                          |
| ------------ | --------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| `beaconUrl`  | `string`                                            | _none_                                 | When set, posts via `navigator.sendBeacon`                     |
| `serialize`  | `(events: TrackedEvent[]) => BodyInit`              | `(events) => JSON.stringify({events})` | Custom payload encoder for the beacon body                     |
| `target`     | `EventTarget`                                       | `globalThis`                           | Where the listeners attach                                     |
| `logger`     | `Pick<Console, "warn">`                             | `console`                              | Used for the beacon-failure warning                            |

---

## Transport contract

```ts
transport: (events: TrackedEvent<TEventMap>[]) => Promise<boolean | void>
```

| return  | meaning                                            |
| ------- | -------------------------------------------------- |
| `true`  | success — items consumed                           |
| `void`  | treated as `true`                                  |
| `false` | handled failure — items dropped                    |
| _throw_ | items requeued at head, retried on next flush      |

There is no built-in retry/backoff. Layer it inside your transport for
exponential backoff or max-attempts.

---

## Recipes

### PII scrubber middleware

```ts
import type { Middleware } from "@marianmeres/tracker";

const scrubEmail: Middleware = (e) => ({
    ...e,
    data: e.data && Object.fromEntries(
        Object.entries(e.data).map(([k, v]) =>
            k === "email" ? [k, "[redacted]"] : [k, v]
        ),
    ),
});
```

### Allow-list (typo guard)

```ts
const allowed = new Set(["chat.mode.toggle", "quiz.skip"]);
const guard: Middleware = (e) =>
    allowed.has(e.name) ? e : (console.warn("unknown event", e.name), null);
```

### Consent gate

```ts
let consentGranted = false;
const consent: Middleware = (e) => (consentGranted ? e : null);
```
