import { createClog } from "@marianmeres/clog";
import {
	attachUnloadFlush,
	type Middleware,
	Tracker,
} from "../../src/mod.ts";

const clog = createClog("tracker:example", { color: "auto" });

type Events = {
	"page.view": { path: string };
	"button.click": { id: string; label?: string };
	"form.submit": { form: string; email: string };
	"menu.enter": { item: string };
	"demo.custom": Record<string, unknown> | undefined;
};

// Example middleware: redact `email` fields before they hit the transport.
const scrubEmail: Middleware<Events> = (e) => {
	const d = e.data as Record<string, unknown> | undefined;
	if (!d || typeof d.email !== "string") return e;
	return { ...e, data: { ...d, email: "[redacted]" } as Events[typeof e.name] };
};

const tracker = new Tracker<Events>({
	// Demo transport: log via clog. In production you'd POST to /api/events.
	transport: (events) => {
		clog(`[transport] flushing ${events.length} event(s)`, events);
		return Promise.resolve(true);
	},
	logger: clog,
	flushIntervalMs: 5000,
	flushThreshold: 10,
	debug: true,
	middleware: [scrubEmail],
	context: { appVersion: "1.0.0", build: "demo" },
});

tracker.identify("user-123", { plan: "pro" });
attachUnloadFlush(tracker);

// Strategy 2: data-* delegation. Any element with `data-track="event.name"`
// emits that event on click. Optional `data-track-payload` is parsed as JSON.
document.addEventListener("click", (event) => {
	const target = event.target as HTMLElement | null;
	const el = target?.closest<HTMLElement>("[data-track]");
	if (!el) return;
	const name = el.dataset.track as keyof Events & string;
	let payload: unknown;
	const raw = el.dataset.trackPayload;
	if (raw) {
		try {
			payload = JSON.parse(raw);
		} catch {
			payload = raw;
		}
	}
	// deno-lint-ignore no-explicit-any
	(tracker as any).track(name, payload);
});

// Live queue size + state readout in the UI.
tracker.subscribe((s) => {
	const el = document.getElementById("state");
	if (el) el.textContent = JSON.stringify(s, null, 2);
});

// Expose globally so inline onclick handlers (Strategy 1) can reach it.
// deno-lint-ignore no-explicit-any
(globalThis as any).tracker = tracker;
// deno-lint-ignore no-explicit-any
(globalThis as any).clog = clog;

// Initial page view.
tracker.track("page.view", { path: location.pathname });
