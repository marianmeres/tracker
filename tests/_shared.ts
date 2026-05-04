import type { EventMap, TrackedEvent } from "../src/mod.ts";

/**
 * Test transport that captures every flushed batch and exposes a `flushes`
 * array for assertions. Behavior is configurable per-call.
 */
export interface FakeTransport {
	(events: TrackedEvent<EventMap>[]): Promise<boolean | void>;
	flushes: TrackedEvent<EventMap>[][];
	allEvents: () => TrackedEvent<EventMap>[];
	calls: number;
}

export function createTransport(
	behavior: () => boolean | void | Promise<boolean | void> = () => true,
): FakeTransport {
	const transport = async (
		events: TrackedEvent<EventMap>[],
	): Promise<boolean | void> => {
		transport.flushes.push(events);
		transport.calls++;
		return await behavior();
	};
	transport.flushes = [] as TrackedEvent<EventMap>[][];
	transport.calls = 0;
	transport.allEvents = (): TrackedEvent<EventMap>[] =>
		transport.flushes.flatMap((b) => b);
	return transport as FakeTransport;
}

/** Silent logger to keep test output quiet. */
export const silentLogger = {
	log: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
};
