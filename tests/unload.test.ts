import { assertEquals } from "@std/assert";
import { attachUnloadFlush, Tracker } from "../src/mod.ts";
import { createTransport, silentLogger } from "./_shared.ts";

Deno.test("attachUnloadFlush: pagehide triggers a single flush; rearms after pageshow", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		logger: silentLogger,
	});

	const target = new EventTarget();
	const detach = attachUnloadFlush(tracker, { target, logger: silentLogger });

	tracker.track("a");
	target.dispatchEvent(new Event("pagehide"));
	target.dispatchEvent(new Event("pagehide")); // second one suppressed
	// Drain runs async; give it a microtask cycle.
	await new Promise((r) => setTimeout(r, 0));
	assertEquals(transport.calls, 1);

	// After pageshow, the guard rearms.
	target.dispatchEvent(new Event("pageshow"));
	tracker.track("b");
	target.dispatchEvent(new Event("pagehide"));
	await new Promise((r) => setTimeout(r, 0));
	assertEquals(transport.calls, 2);

	detach();
	tracker.dispose();
});

Deno.test("attachUnloadFlush: visibilitychange:hidden triggers flush; visible does not", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		logger: silentLogger,
	});

	const target = new EventTarget();
	let visibilityState = "visible";

	// Stand in a fake `document` on globalThis to drive the visibility check.
	const originalDoc = (globalThis as unknown as Record<string, unknown>).document;
	(globalThis as unknown as Record<string, unknown>).document = {
		get visibilityState() {
			return visibilityState;
		},
	};

	try {
		const detach = attachUnloadFlush(tracker, { target, logger: silentLogger });
		tracker.track("a");

		visibilityState = "visible";
		target.dispatchEvent(new Event("visibilitychange"));
		await new Promise((r) => setTimeout(r, 0));
		assertEquals(transport.calls, 0);

		visibilityState = "hidden";
		target.dispatchEvent(new Event("visibilitychange"));
		await new Promise((r) => setTimeout(r, 0));
		assertEquals(transport.calls, 1);

		detach();
	} finally {
		if (originalDoc === undefined) {
			delete (globalThis as unknown as Record<string, unknown>).document;
		} else {
			(globalThis as unknown as Record<string, unknown>).document = originalDoc;
		}
		tracker.dispose();
	}
});

Deno.test("attachUnloadFlush: beaconUrl path uses navigator.sendBeacon and clears the buffer", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		logger: silentLogger,
	});

	const beaconCalls: { url: string; body: BodyInit | null | undefined }[] = [];
	const originalNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	Object.defineProperty(globalThis, "navigator", {
		value: {
			sendBeacon: (url: string, body?: BodyInit | null) => {
				beaconCalls.push({ url, body });
				return true;
			},
		},
		writable: true,
		configurable: true,
	});

	try {
		const target = new EventTarget();
		const detach = attachUnloadFlush(tracker, {
			target,
			beaconUrl: "https://example.test/events",
			logger: silentLogger,
		});

		tracker.track("a");
		tracker.track("b");
		assertEquals(tracker.getState().size, 2);

		target.dispatchEvent(new Event("pagehide"));

		assertEquals(beaconCalls.length, 1);
		assertEquals(beaconCalls[0].url, "https://example.test/events");
		// Buffer was cleared rather than flushed via transport.
		assertEquals(transport.calls, 0);
		assertEquals(tracker.getState().size, 0);

		const parsed = JSON.parse(beaconCalls[0].body as string) as {
			events: { name: string }[];
		};
		assertEquals(parsed.events.map((e) => e.name), ["a", "b"]);

		detach();
	} finally {
		if (originalNav) {
			Object.defineProperty(globalThis, "navigator", originalNav);
		} else {
			delete (globalThis as unknown as Record<string, unknown>).navigator;
		}
		tracker.dispose();
	}
});

Deno.test("attachUnloadFlush: beacon returns false → falls back to drain()", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		logger: silentLogger,
	});

	const originalNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	Object.defineProperty(globalThis, "navigator", {
		value: { sendBeacon: () => false },
		writable: true,
		configurable: true,
	});

	try {
		const target = new EventTarget();
		const detach = attachUnloadFlush(tracker, {
			target,
			beaconUrl: "https://example.test/events",
			logger: silentLogger,
		});

		tracker.track("a");
		target.dispatchEvent(new Event("pagehide"));

		// Drain is async; let microtasks run.
		await new Promise((r) => setTimeout(r, 0));
		assertEquals(transport.calls, 1);
		assertEquals(transport.flushes[0].length, 1);

		detach();
	} finally {
		if (originalNav) {
			Object.defineProperty(globalThis, "navigator", originalNav);
		} else {
			delete (globalThis as unknown as Record<string, unknown>).navigator;
		}
		tracker.dispose();
	}
});

Deno.test("attachUnloadFlush: non-browser target without addEventListener is a no-op", () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		logger: silentLogger,
	});

	// EventTarget-shaped object that lacks addEventListener.
	const fakeTarget = {} as EventTarget;
	const detach = attachUnloadFlush(tracker, {
		target: fakeTarget,
		logger: silentLogger,
	});

	tracker.track("a");
	// Should not throw, should not flush.
	detach();
	assertEquals(transport.calls, 0);
	assertEquals(tracker.getState().size, 1);
	tracker.dispose();
});
