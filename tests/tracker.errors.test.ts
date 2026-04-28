import { assertEquals, assertRejects } from "@std/assert";
import { Tracker } from "../src/mod.ts";
import { createTransport, silentLogger } from "./_shared.ts";

Deno.test("transport throws → items requeued at head; second flush retries", async () => {
	let shouldThrow = true;
	const transport = createTransport(() => {
		if (shouldThrow) throw new Error("boom");
		return true;
	});

	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		logger: silentLogger,
	});

	tracker.track("a");
	tracker.track("b");

	await assertRejects(() => tracker.flush(), Error, "boom");
	assertEquals(transport.calls, 1);
	// Items requeued.
	assertEquals(tracker.getState().size, 2);

	shouldThrow = false;
	const ok = await tracker.flush();
	assertEquals(ok, true);
	assertEquals(transport.calls, 2);
	assertEquals(transport.flushes[1].length, 2);
	assertEquals(tracker.getState().size, 0);

	tracker.dispose();
});

Deno.test("transport returns false → items dropped (not requeued)", async () => {
	const transport = createTransport(() => false);
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		logger: silentLogger,
	});

	tracker.track("a");
	tracker.track("b");

	const result = await tracker.flush();
	assertEquals(result, false);
	assertEquals(transport.calls, 1);
	assertEquals(tracker.getState().size, 0);

	tracker.dispose();
});

Deno.test("transport returns void → treated as success", async () => {
	const transport = createTransport(() => undefined);
	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		logger: silentLogger,
	});

	tracker.track("a");
	const ok = await tracker.flush();
	assertEquals(ok, true);
	assertEquals(transport.calls, 1);
	assertEquals(tracker.getState().size, 0);
	tracker.dispose();
});
