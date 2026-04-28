import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { Tracker } from "../src/mod.ts";
import { createTransport, silentLogger } from "./_shared.ts";

Deno.test("threshold flush: pushing N events triggers a transport call", async () => {
	const transport = createTransport();
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 3,
		logger: silentLogger,
	});

	tracker.track("a");
	tracker.track("b");
	assertEquals(transport.calls, 0);

	tracker.track("c"); // hits threshold, fires async flush
	// Threshold flush is fire-and-forget — wait for the in-flight promise.
	await tracker.flush();

	assertEquals(transport.calls, 1);
	assertEquals(transport.flushes[0].length, 3);
	assertEquals(tracker.getState().size, 0);
	tracker.dispose();
});

Deno.test("interval flush: with FakeTime, advancing past flushIntervalMs triggers transport", async () => {
	const time = new FakeTime();
	try {
		const transport = createTransport();
		const tracker = new Tracker({
			transport,
			flushIntervalMs: 1000,
			flushThreshold: 1000,
			logger: silentLogger,
		});

		tracker.track("a");
		tracker.track("b");
		assertEquals(transport.calls, 0);

		await time.tickAsync(1000);
		// allow microtasks to settle
		await time.runMicrotasks();

		assertEquals(transport.calls, 1);
		assertEquals(transport.flushes[0].length, 2);
		assertEquals(tracker.getState().size, 0);

		tracker.dispose();
	} finally {
		time.restore();
	}
});

Deno.test("timestamp is captured at track time, not flush time", async () => {
	const time = new FakeTime(new Date("2026-01-01T00:00:00.000Z"));
	try {
		const transport = createTransport();
		const tracker = new Tracker({
			transport,
			flushIntervalMs: 60_000,
			flushThreshold: 1000,
			logger: silentLogger,
		});

		tracker.track("a");
		const trackedAt = new Date().toISOString();

		await time.tickAsync(2000);
		await tracker.flush();

		const e = transport.flushes[0][0];
		assertEquals(e.timestamp, trackedAt);

		tracker.dispose();
	} finally {
		time.restore();
	}
});
