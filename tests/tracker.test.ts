import { assertEquals, assertExists } from "@std/assert";
import { Tracker } from "../src/mod.ts";
import { createTransport, silentLogger } from "./_shared.ts";

Deno.test("track() enqueues; transport not called", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 100,
		logger: silentLogger,
	});

	tracker.track("a");
	tracker.track("b");

	assertEquals(transport.calls, 0);
	assertEquals(tracker.getState().size, 2);

	await tracker.drain();
	tracker.dispose();
});

Deno.test("manual flush resolves and empties the buffer", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		logger: silentLogger,
	});

	tracker.track("a");
	tracker.track("b");
	const ok = await tracker.flush();

	assertEquals(ok, true);
	assertEquals(transport.calls, 1);
	assertEquals(transport.flushes[0].length, 2);
	assertEquals(tracker.getState().size, 0);

	tracker.dispose();
});

Deno.test("envelope shape: eventId, timestamp, sessionId, userId, traits, context", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		context: { app: "test" },
		user: { id: "u1", traits: { plan: "pro" } },
		sessionId: "s-fixed",
		logger: silentLogger,
	});

	tracker.track("evt", { foo: 1 });
	await tracker.flush();

	const e = transport.flushes[0][0];
	assertExists(e.eventId);
	assertEquals(typeof e.eventId, "string");
	assertEquals(e.name, "evt");
	assertEquals(e.data, { foo: 1 });
	assertEquals(e.sessionId, "s-fixed");
	assertEquals(e.userId, "u1");
	assertEquals(e.traits, { plan: "pro" });
	assertEquals(e.context, { app: "test" });
	// ISO-8601 surface check
	assertEquals(typeof e.timestamp, "string");
	assertEquals(new Date(e.timestamp).toISOString(), e.timestamp);

	tracker.dispose();
});

Deno.test("drain() flushes and stops; subsequent track() still enqueues but no timer fires", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 50,
		flushThreshold: 1000,
		logger: silentLogger,
	});

	tracker.track("a");
	await tracker.drain();
	assertEquals(transport.calls, 1);
	assertEquals(tracker.getState().isRunning, false);

	tracker.track("b");
	assertEquals(tracker.getState().size, 1);

	// Wait past two interval cycles; with the timer stopped, no extra flush.
	await new Promise((r) => setTimeout(r, 150));
	assertEquals(transport.calls, 1);

	await tracker.flush();
	assertEquals(transport.calls, 2);
	tracker.dispose();
});
