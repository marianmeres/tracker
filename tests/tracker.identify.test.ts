import { assertEquals, assertNotEquals } from "@std/assert";
import { Tracker } from "../src/mod.ts";
import { createTransport, silentLogger } from "./_shared.ts";

Deno.test("identify() stamps userId/traits onto subsequent events", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		logger: silentLogger,
	});

	tracker.track("before");
	tracker.identify("u1", { plan: "pro" });
	tracker.track("after");

	await tracker.flush();
	const [a, b] = transport.flushes[0];
	assertEquals(a.userId, null);
	assertEquals(a.traits, null);
	assertEquals(b.userId, "u1");
	assertEquals(b.traits, { plan: "pro" });

	tracker.dispose();
});

Deno.test("reset() clears identity, rotates session, preserves super-properties", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		context: { app: "x" },
		user: { id: "u1", traits: { plan: "pro" } },
		sessionId: "s-fixed",
		logger: silentLogger,
	});

	tracker.track("a");
	tracker.reset();
	tracker.track("b");

	await tracker.flush();
	const [a, b] = transport.flushes[0];

	assertEquals(a.userId, "u1");
	assertEquals(a.sessionId, "s-fixed");

	assertEquals(b.userId, null);
	assertEquals(b.traits, null);
	assertNotEquals(b.sessionId, "s-fixed");
	// Super-properties survive reset.
	assertEquals(b.context, { app: "x" });

	tracker.dispose();
});

Deno.test("setContext() merge (default)", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		context: { a: 1, b: 2 },
		logger: silentLogger,
	});

	tracker.setContext({ b: 99, c: 3 });
	tracker.track("evt");
	await tracker.flush();

	assertEquals(transport.flushes[0][0].context, { a: 1, b: 99, c: 3 });
	tracker.dispose();
});

Deno.test("setContext() replace", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		context: { a: 1, b: 2 },
		logger: silentLogger,
	});

	tracker.setContext({ x: true }, "replace");
	tracker.track("evt");
	await tracker.flush();

	assertEquals(transport.flushes[0][0].context, { x: true });
	tracker.dispose();
});

Deno.test("context is snapshotted at track time, not at flush time", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		context: { route: "/a" },
		logger: silentLogger,
	});

	tracker.track("first");
	tracker.setContext({ route: "/b" });
	tracker.track("second");

	await tracker.flush();
	assertEquals(transport.flushes[0][0].context, { route: "/a" });
	assertEquals(transport.flushes[0][1].context, { route: "/b" });

	tracker.dispose();
});

Deno.test("pause/resume: track during pause is a no-op for the queue", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		logger: silentLogger,
	});

	tracker.track("pre");
	tracker.pause();
	tracker.track("paused");
	assertEquals(tracker.getState().size, 1);
	assertEquals(tracker.getState().isPaused, true);

	tracker.resume();
	assertEquals(tracker.getState().isPaused, false);
	tracker.track("post");

	await tracker.flush();
	assertEquals(transport.flushes[0].map((e) => e.name), ["pre", "post"]);

	tracker.dispose();
});
