/**
 * Browser unload-flush helper. Flushes a {@link Tracker} on `pagehide` /
 * `visibilitychange:hidden`, optionally via `navigator.sendBeacon`.
 *
 * @module
 */
import { createClog } from "@marianmeres/clog";
import type { EventMap, TrackedEvent, Tracker } from "./tracker.ts";

const defaultLogger = createClog("tracker:unload");

/** Options for {@link attachUnloadFlush}. */
export interface AttachUnloadFlushOptions {
	/**
	 * Beacon endpoint URL. If provided, on `pagehide`/`visibilitychange:hidden`
	 * the buffered queue is POSTed via `navigator.sendBeacon(url, body)` and
	 * the regular transport is skipped for that batch. Optional.
	 */
	beaconUrl?: string;

	/**
	 * Custom serializer for the beacon payload.
	 * @default (events) => JSON.stringify({ events })
	 */
	serialize?: (events: TrackedEvent[]) => BodyInit;

	/**
	 * Listener target. @default globalThis (i.e. `window` in browsers).
	 * The hook is a silent no-op when `addEventListener` is unavailable.
	 */
	target?: EventTarget;

	/**
	 * Optional logger override. @default `createClog("tracker:unload")`
	 */
	logger?: Pick<Console, "warn">;
}

interface NavigatorWithBeacon {
	sendBeacon?: (url: string, data?: BodyInit | null) => boolean;
}

/**
 * Wires `pagehide` + `visibilitychange` listeners to flush the tracker on tab
 * close / hide. Returns a detach function. Safe to call in non-browser
 * runtimes — becomes a no-op when `addEventListener` is unavailable.
 *
 * Why both events: `pagehide` is the modern recommendation, but Safari has
 * historically only fired `visibilitychange:hidden` reliably on tab switch.
 * A `hasFiredOnce` guard prevents double-flush; it resets on `pageshow`.
 */
export function attachUnloadFlush(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	tracker: Tracker<EventMap> | Tracker<any>,
	options: AttachUnloadFlushOptions = {},
): () => void {
	const target = options.target ?? (globalThis as unknown as EventTarget);
	const logger = options.logger ?? defaultLogger;

	const addListener = (
		target as { addEventListener?: EventTarget["addEventListener"] }
	).addEventListener;
	const removeListener = (
		target as { removeEventListener?: EventTarget["removeEventListener"] }
	).removeEventListener;

	if (typeof addListener !== "function" || typeof removeListener !== "function") {
		return () => {};
	}

	let hasFiredOnce = false;

	const serialize =
		options.serialize ??
		((events: TrackedEvent[]): BodyInit => JSON.stringify({ events }));

	const fire = (): void => {
		if (hasFiredOnce) return;
		hasFiredOnce = true;

		const events = (tracker as Tracker<EventMap>).dump();
		const url = options.beaconUrl;

		if (url && events.length > 0) {
			const nav = (globalThis as { navigator?: NavigatorWithBeacon }).navigator;
			if (nav?.sendBeacon) {
				let ok = false;
				try {
					ok = nav.sendBeacon(url, serialize(events));
				} catch (e) {
					logger.warn("sendBeacon threw", e);
					ok = false;
				}
				if (ok) {
					(tracker as Tracker<EventMap>).clear();
					return;
				}
				logger.warn(
					"sendBeacon returned false (payload too large?), falling back to drain()",
				);
			}
		}

		// Fallback: best-effort drain via the regular transport.
		void (tracker as Tracker<EventMap>).drain();
	};

	const onVisibility = (): void => {
		const doc = (globalThis as { document?: { visibilityState?: string } })
			.document;
		if (doc?.visibilityState === "hidden") fire();
	};

	const onPageHide = (): void => fire();

	const onPageShow = (): void => {
		hasFiredOnce = false;
	};

	target.addEventListener("pagehide", onPageHide);
	target.addEventListener("visibilitychange", onVisibility);
	target.addEventListener("pageshow", onPageShow);

	return () => {
		target.removeEventListener("pagehide", onPageHide);
		target.removeEventListener("visibilitychange", onVisibility);
		target.removeEventListener("pageshow", onPageShow);
	};
}
