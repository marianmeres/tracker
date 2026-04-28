import { uuid } from "./uuid.ts";
import type { EventMap, TrackedEvent } from "../tracker.ts";

/**
 * Builds the canonical envelope for a tracked event. Captures `timestamp` and
 * `eventId` at call time (NOT at flush time) so latency between enqueue and
 * flush does not skew event ordering.
 *
 * Performs a shallow clone of `context` so subsequent `setContext()` mutations
 * do not retroactively change already-queued events.
 */
export function buildEnvelope<M extends EventMap>(
	name: keyof M & string,
	data: M[keyof M & string],
	identity: {
		sessionId: string;
		userId: string | null;
		traits: Record<string, unknown> | null;
		context: Record<string, unknown>;
	},
): TrackedEvent<M> {
	return {
		eventId: uuid(),
		name,
		data,
		timestamp: new Date().toISOString(),
		sessionId: identity.sessionId,
		userId: identity.userId,
		traits: identity.traits ? { ...identity.traits } : null,
		context: { ...identity.context },
	};
}
