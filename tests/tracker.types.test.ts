// Compile-time type tests. These never execute (the function is unused);
// the assertions live in the type system. `deno check` in the test command
// validates them.
import { Tracker } from "../src/mod.ts";
import type { EventMap, TrackedEvent } from "../src/mod.ts";

type Events = {
	"chat.mode.toggle": { from: "voice" | "text"; to: "voice" | "text" };
	"quiz.skip": { moduleId: string; questionId?: string };
	"menu.enter": { item: string } | undefined;
};

// A map declared as a plain interface — must be accepted WITHOUT `extends EventMap`.
interface InterfaceEvents {
	"a.b": { x: number };
}

// The bug this release fixes: an index signature inherited from `EventMap` opens
// the map, so `track()` silently accepts any string.
interface OpenByAccident extends EventMap {
	"a.b": { x: number };
}

// Deliberate ad-hoc namespace: closed catalog + one open prefix.
type HybridEvents =
	& { "a.b": { x: number } }
	& Record<`experiment.${string}`, Record<string, unknown> | undefined>;

// Reference the symbol so unused-import lint doesn't fire.
export const _typeFixture = (): Tracker<Events> | null => null;

// deno-lint-ignore no-unused-vars
function _typeChecks(tracker: Tracker<Events>): void {
	// deno-lint-ignore no-explicit-any
	const transport = async (_e: TrackedEvent<any>[]) => true;

	// ✅ Correct payload
	tracker.track("chat.mode.toggle", { from: "voice", to: "text" });

	// ✅ Optional payload event accepts no data arg
	tracker.track("menu.enter");
	tracker.track("menu.enter", { item: "settings" });

	// ✅ Default permissive event map (a map with NO declared keys stays open)
	const generic = new Tracker({ transport });
	generic.track("anything");
	generic.track("anything-with-data", { x: 1 });

	// ✅ ...and explicitly, as `unload.ts` spells it
	const explicitOpen = new Tracker<EventMap>({ transport });
	explicitOpen.track("anything");

	// ✅ A plain interface is a valid map — no `extends EventMap` required.
	const iface = new Tracker<InterfaceEvents>({ transport });
	iface.track("a.b", { x: 1 });

	// ✅ Deliberate namespaced hole
	const hybrid = new Tracker<HybridEvents>({ transport });
	hybrid.track("a.b", { x: 1 });
	hybrid.track("experiment.new-thing", { z: 1 });

	// ✅ Consumers may name the envelope type with any valid map
	type _Envelope = TrackedEvent<InterfaceEvents>;

	// @ts-expect-error wrong payload shape
	tracker.track("chat.mode.toggle", { from: "voice" });

	// @ts-expect-error unknown event name
	tracker.track("does.not.exist");

	// @ts-expect-error required-payload event called with no data
	tracker.track("quiz.skip");

	// @ts-expect-error unknown event name on an interface-declared map
	iface.track("a.TYPO", { x: 1 });

	// @ts-expect-error unknown name outside the deliberate namespace
	hybrid.track("a.TYPO", { x: 1 });

	// @ts-expect-error map has a string index signature (interface extends EventMap)
	new Tracker<OpenByAccident>({ transport }).track("a.b", { x: 1 });
}

Deno.test("type tests compile (presence test)", () => {
	// no-op runtime placeholder
});
