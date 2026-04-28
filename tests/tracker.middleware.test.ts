import { assertEquals } from "@std/assert";
import { Tracker, type Enricher, type Middleware } from "../src/mod.ts";
import { createTransport, silentLogger } from "./_shared.ts";

Deno.test("enrichers run after built-ins, in declaration order", async () => {
	const transport = createTransport();
	const e1: Enricher = (e) => ({ ...e, context: { ...e.context, e1: 1 } });
	const e2: Enricher = (e) => ({ ...e, context: { ...e.context, e2: 2, e1: 99 } });

	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		enrichers: [e1, e2],
		context: { base: true },
		logger: silentLogger,
	});

	tracker.track("evt");
	await tracker.flush();

	const ctx = transport.flushes[0][0].context;
	assertEquals(ctx, { base: true, e1: 99, e2: 2 });
	tracker.dispose();
});

Deno.test("middleware returning null drops the event", async () => {
	const transport = createTransport();
	const drop: Middleware = (e) => (e.name === "drop-me" ? null : e);

	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		middleware: [drop],
		logger: silentLogger,
	});

	tracker.track("keep");
	tracker.track("drop-me");
	tracker.track("keep");

	assertEquals(tracker.getState().size, 2);
	await tracker.flush();
	assertEquals(transport.flushes[0].length, 2);
	assertEquals(transport.flushes[0].map((e) => e.name), ["keep", "keep"]);

	tracker.dispose();
});

Deno.test("middleware can mutate envelope before enqueue", async () => {
	const transport = createTransport();
	const scrub: Middleware = (e) => ({
		...e,
		data: e.data && Object.fromEntries(
			Object.entries(e.data).map(([k, v]) =>
				k === "email" ? [k, "[redacted]"] : [k, v]
			),
		),
	});

	const tracker = new Tracker({
		transport,
		flushIntervalMs: 60_000,
		flushThreshold: 1000,
		middleware: [scrub],
		logger: silentLogger,
	});

	tracker.track("signup", { email: "user@example.com", plan: "pro" });
	await tracker.flush();

	assertEquals(transport.flushes[0][0].data, {
		email: "[redacted]",
		plan: "pro",
	});

	tracker.dispose();
});
