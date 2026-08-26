/**
 * Core tracker types and class. See {@link Tracker} for the main entry point.
 *
 * @module
 */
import { BatchFlusher, type BatchFlusherState } from "@marianmeres/batch";
import { createClog } from "@marianmeres/clog";
import { createPubSub } from "@marianmeres/pubsub";
import { buildEnvelope } from "./internal/enrichers.ts";
import { uuid } from "./internal/uuid.ts";

const defaultLogger = createClog("tracker");

/** A single event's payload. `undefined` means the event takes no data. */
export type EventPayload = Record<string, unknown> | undefined;

/**
 * The permissive default event map: any name, any payload.
 *
 * This is the *open* map — it is what `new Tracker({...})` gets when no generic
 * argument is supplied, and it is the explicit spelling of "I have no catalog".
 *
 * **Do not `extends` it.** An `interface MyEvents extends EventMap {...}`
 * inherits its string index signature, which silently re-opens the map: every
 * event name compiles, including typos, while autocomplete keeps working so
 * nothing looks wrong. Declare your catalog as a `type` alias or a plain
 * `interface` instead — see {@link ValidEventMap}. `track()` rejects a map that
 * has both an index signature and declared keys, so the mistake is caught, but
 * only at the call site.
 */
export type EventMap = Record<string, EventPayload>;

/**
 * Constraint for a consumer-supplied event map: every value of `M` must be an
 * {@link EventPayload}.
 *
 * Deliberately self-referential (`M extends ValidEventMap<M>`) rather than the
 * structural `M extends EventMap`, because the latter demands a string index
 * signature — which a plain `interface` does not have. That rejection is what
 * used to push people into writing `extends EventMap` (see {@link EventMap}),
 * so the constraint itself manufactured the footgun. This form accepts type
 * aliases and plain interfaces alike, and reports a bad payload type at the
 * declaration site.
 *
 * ```ts
 * type Events = { "a.b": { x: number } };      // ✅
 * interface Events2 { "a.b": { x: number } }   // ✅ (no `extends` needed)
 * ```
 */
export type ValidEventMap<M> = { [K in keyof M]: EventPayload };

/**
 * `keyof T` with index signatures stripped — i.e. only explicitly declared keys.
 * Load-bearing for {@link EventName}: it is the only thing that distinguishes
 * the deliberate open map (index signature, no declared keys) from a map that
 * was opened by accident (index signature *and* declared keys).
 */
type DeclaredKeys<T> = keyof {
	[K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/**
 * The legal event names for map `M`:
 *
 * - no index signature       → the literal key union (a closed catalog)
 * - index signature, no keys → `string` (the deliberate permissive default)
 * - index signature AND keys → an error object, i.e. the map is disqualified
 *
 * NOTE: the error object type is written INLINE on purpose. Extracting it to a
 * named alias makes TS print `not assignable to parameter of type
 * 'OpenEventMapError'` and the explanation is lost unless the reader hovers it.
 * Inline, the whole sentence appears in the error text. Do not "tidy" this.
 *
 * The `[…] extends […]` tuple wrapping is also required: it prevents the
 * conditional from distributing over `never`, which would take the wrong branch.
 */
export type EventName<M> = string extends keyof M
	? [DeclaredKeys<M>] extends [never] ? string
	: {
		__trackerError:
			"Event map must not have a string index signature; declare it as a `type` alias or plain `interface`, never `extends EventMap`.";
	}
	: keyof M & string;

/** Fully-built event envelope passed to enrichers, middleware, and transport. */
export interface TrackedEvent<M extends ValidEventMap<M> = EventMap> {
	/** Random per-event UUID. Stable across enrichment/middleware/flush. */
	eventId: string;
	/** Event name (key of {@link EventMap}). */
	name: keyof M & string;
	/** Event payload as declared on {@link EventMap}. */
	data: M[keyof M & string];
	/** ISO 8601 timestamp captured at `track()` call time, not flush time. */
	timestamp: string;
	/** Stable session id; rotates on `Tracker.reset()`. */
	sessionId: string;
	/** Current user id, or `null` if anonymous. */
	userId: string | null;
	/** User traits supplied via `identify()`, or `null` if not set. */
	traits: Record<string, unknown> | null;
	/** Snapshot of super-properties at track time. */
	context: Record<string, unknown>;
}

/** Synchronous transformer applied to every event before it enters the queue. */
export type Enricher<M extends ValidEventMap<M> = EventMap> = (
	e: TrackedEvent<M>,
) => TrackedEvent<M>;

/** Like Enricher but may return `null` to drop the event silently. */
export type Middleware<M extends ValidEventMap<M> = EventMap> = (
	e: TrackedEvent<M>,
) => TrackedEvent<M> | null;

/** Construction options for {@link Tracker}. */
export interface TrackerOptions<
	TEventMap extends ValidEventMap<TEventMap> = EventMap,
> {
	/**
	 * Receives a batch of fully-enriched events.
	 * Return value follows @marianmeres/batch semantics:
	 *   - resolves `true`  → success, items consumed
	 *   - resolves `false` → handled failure, items dropped
	 *   - resolves `void`  → treated as success
	 *   - throws           → items requeued at head (retry on next flush)
	 */
	transport: (events: TrackedEvent<TEventMap>[]) => Promise<boolean | void>;

	/** Batch flush cadence in ms. @default 1000 */
	flushIntervalMs?: number;
	/** Flush immediately when buffer reaches N items. @default 50 */
	flushThreshold?: number;
	/** Hard cap to prevent unbounded growth. @default 500 */
	maxBatchSize?: number;

	/**
	 * If true, every event is also logged at track() time,
	 * regardless of transport. @default false
	 */
	debug?: boolean;

	/** Optional logger override. @default `createClog("tracker")` */
	logger?: Pick<Console, "log" | "warn" | "error" | "debug">;

	/**
	 * Run in order at track() time AFTER built-in envelope construction but
	 * BEFORE middleware. Each receives the envelope and returns a (possibly
	 * mutated) envelope.
	 */
	enrichers?: Enricher<TEventMap>[];

	/**
	 * Run in order at track() time AFTER enrichers. Returning `null` drops
	 * the event silently. Use for PII scrubbing, allow/block lists, etc.
	 */
	middleware?: Middleware<TEventMap>[];

	/**
	 * Initial super-properties merged into `context` of every event.
	 * Replaceable via `setContext()`.
	 */
	context?: Record<string, unknown>;

	/** Initial user identity. Equivalent to calling `identify()` right away. */
	user?: { id: string; traits?: Record<string, unknown> };

	/** Stable session id. If omitted, a UUID is generated on first track. */
	sessionId?: string;
}

/** Snapshot of tracker state, broadcast to subscribers. */
export interface TrackerState {
	/** Number of events currently buffered (not yet flushed). */
	size: number;
	/** True while a transport call is in flight. */
	isFlushing: boolean;
	/** True while the auto-flush timer is active. */
	isRunning: boolean;
	/** True while `pause()` is in effect. */
	isPaused: boolean;
	/** Cumulative count of events dropped due to overflow / handled failure. */
	droppedCount: number;
}

/**
 * Map an event payload type to the variadic args of `track()`. If the payload
 * type includes `undefined`, the data argument is optional; otherwise it's
 * required. Using `undefined extends T` (rather than `T extends undefined`)
 * matches the standard "is T optional?" pattern and works correctly with
 * indexed-access types under strict mode.
 */
type TrackArgs<T> = undefined extends T ? [data?: T] : [data: T];

type Logger = Pick<Console, "log" | "warn" | "error" | "debug">;

/**
 * Client-side event tracker with pluggable transport, enrichers, middleware,
 * and batched flushing.
 *
 * Typical usage:
 * ```ts
 * const tracker = new Tracker<MyEvents>({
 *   transport: async (events) => {
 *     await fetch("/api/events", { method: "POST", body: JSON.stringify(events) });
 *   },
 * });
 * tracker.identify("user-123");
 * tracker.track("page.view", { path: "/" });
 * ```
 *
 * Pass a typed `EventMap` for autocompletion + payload type-checking on `track()`.
 */
export class Tracker<TEventMap extends ValidEventMap<TEventMap> = EventMap> {
	#options: TrackerOptions<TEventMap>;
	#logger: Logger;
	#enrichers: Enricher<TEventMap>[];
	#middleware: Middleware<TEventMap>[];

	#sessionId: string;
	#userId: string | null = null;
	#traits: Record<string, unknown> | null = null;
	#context: Record<string, unknown>;

	#paused = false;
	#batch: BatchFlusher<TrackedEvent<TEventMap>>;

	#pubsub = createPubSub<{ state: TrackerState }>();
	#unsubscribeBatch: () => void;
	#lastBatchState: BatchFlusherState;

	/** Construct a new tracker. See {@link TrackerOptions} for configuration. */
	constructor(options: TrackerOptions<TEventMap>) {
		this.#options = options;
		this.#logger = options.logger ?? defaultLogger;
		this.#enrichers = options.enrichers ? [...options.enrichers] : [];
		this.#middleware = options.middleware ? [...options.middleware] : [];
		this.#sessionId = options.sessionId ?? uuid();
		this.#context = options.context ? { ...options.context } : {};

		if (options.user) {
			this.#userId = options.user.id;
			this.#traits = options.user.traits ? { ...options.user.traits } : null;
		}

		this.#batch = new BatchFlusher<TrackedEvent<TEventMap>>(
			async (events): Promise<boolean> => {
				if (options.debug) {
					this.#logger.debug("flushing batch", events.length);
				}
				// `transport` may resolve to `boolean | void`. Treat anything
				// other than literal `false` (incl. `undefined`/`void`) as success.
				return (await options.transport(events)) !== false;
			},
			{
				flushIntervalMs: options.flushIntervalMs ?? 1000,
				flushThreshold: options.flushThreshold ?? 50,
				maxBatchSize: options.maxBatchSize ?? 500,
				onFlushError: (items, err) => {
					this.#logger.warn(
						"flush failed, requeued",
						items.length,
						err,
					);
				},
				onDrop: (items) => {
					this.#logger.warn("dropped", items.length);
				},
			},
		);

		// Seed last state and subscribe; notify own subscribers when batch state changes.
		this.#lastBatchState = {
			size: 0,
			isFlushing: false,
			isRunning: true,
		};
		this.#unsubscribeBatch = this.#batch.subscribe((state) => {
			this.#lastBatchState = state;
			this.#notify();
		});
	}

	/** Emit an event. Synchronous; returns immediately after enqueue. */
	track<K extends EventName<TEventMap>>(
		name: K,
		...args: TrackArgs<TEventMap[K & keyof TEventMap]>
	): void {
		// `K` is constrained by `EventName<TEventMap>` rather than by
		// `keyof TEventMap`, so the compiler cannot see the (guaranteed) narrowing
		// back to a real key and both of these have to be asserted. `data` goes
		// via `unknown` because TS 5.8 (the version dnt/tsc uses for the npm
		// build) rejects the direct assertion between the two indexed accesses as
		// non-overlapping, even though Deno's newer tsc accepts it.
		const eventName = name as keyof TEventMap & string;
		const data = args[0] as unknown as TEventMap[keyof TEventMap & string];

		if (this.#paused) {
			if (this.#options.debug) {
				this.#logger.debug("track (paused, dropped)", name, data);
			}
			return;
		}

		let envelope: TrackedEvent<TEventMap> = buildEnvelope<TEventMap>(
			eventName,
			data,
			{
				sessionId: this.#sessionId,
				userId: this.#userId,
				traits: this.#traits,
				context: this.#context,
			},
		);

		for (const fn of this.#enrichers) {
			envelope = fn(envelope);
		}

		if (this.#options.debug) {
			this.#logger.debug("track", envelope);
		}

		for (const fn of this.#middleware) {
			const out = fn(envelope);
			if (out === null) return; // dropped
			envelope = out;
		}

		this.#batch.add(envelope);
	}

	/** Attach user identity. Future events carry this userId + traits. */
	identify(id: string, traits?: Record<string, unknown>): void {
		this.#userId = id;
		this.#traits = traits ? { ...traits } : null;
	}

	/**
	 * Clear user identity and rotate sessionId. Does NOT flush queued events
	 * (they keep the previous identity already stamped on them) and does NOT
	 * clear super-properties.
	 */
	reset(): void {
		this.#userId = null;
		this.#traits = null;
		this.#sessionId = uuid();
	}

	/** Replace or extend super-properties merged into every event. */
	setContext(
		patch: Record<string, unknown>,
		mode: "merge" | "replace" = "merge",
	): void {
		if (mode === "replace") {
			this.#context = { ...patch };
		} else {
			this.#context = { ...this.#context, ...patch };
		}
	}

	/** Force an immediate flush. Resolves to underlying batch flush result. */
	flush(): Promise<boolean> {
		return this.#batch.flush();
	}

	/** Flush + stop. Use in shutdown / page unload paths. */
	async drain(): Promise<void> {
		await this.#batch.drain();
	}

	/** Pause queueing. While paused, `track()` is a no-op (debug still logs). */
	pause(): void {
		if (this.#paused) return;
		this.#paused = true;
		this.#notify();
	}

	/** Resume queueing. Already-queued events are unaffected. */
	resume(): void {
		if (!this.#paused) return;
		this.#paused = false;
		this.#notify();
	}

	/**
	 * Subscribe to state changes. Callback fires immediately with current
	 * state, then on every subsequent change. Returns an unsubscribe fn.
	 */
	subscribe(fn: (state: TrackerState) => void): () => void {
		const unsub = this.#pubsub.subscribe("state", fn);
		fn(this.getState());
		return unsub;
	}

	/** Current snapshot. */
	getState(): TrackerState {
		return {
			size: this.#lastBatchState.size,
			isFlushing: this.#lastBatchState.isFlushing,
			isRunning: this.#lastBatchState.isRunning,
			isPaused: this.#paused,
			droppedCount: this.#batch.droppedCount,
		};
	}

	/** Current sessionId. Useful for diagnostics; rotates on `reset()`. */
	get sessionId(): string {
		return this.#sessionId;
	}

	/** Snapshot the buffered events without flushing (for e.g. beacon paths). */
	dump(): TrackedEvent<TEventMap>[] {
		return this.#batch.dump();
	}

	/** Clear the buffer without flushing. */
	clear(): void {
		this.#batch.reset();
	}

	/**
	 * Tear down internal subscriptions and stop the auto-flush timer WITHOUT
	 * flushing. Useful in test cleanup; for shutdown paths prefer `drain()`.
	 */
	dispose(): void {
		this.#batch.stop();
		this.#unsubscribeBatch();
		this.#pubsub.unsubscribeAll();
	}

	#notify(): void {
		this.#pubsub.publish("state", this.getState());
	}
}
