/**
 * Lightweight, dependency-light client-side event tracker with pluggable
 * transport, enrichers, middleware, batching, and an optional unload-flush
 * helper for browser environments.
 */
export { Tracker } from "./tracker.ts";
export type {
	Enricher,
	EventMap,
	Middleware,
	TrackedEvent,
	TrackerOptions,
	TrackerState,
} from "./tracker.ts";
export { attachUnloadFlush } from "./unload.ts";
export type { AttachUnloadFlushOptions } from "./unload.ts";
