// Compile-time type tests. These never execute (the function is unused);
// the assertions live in the type system. `deno check` in the test command
// validates them.
import { Tracker } from "../src/mod.ts";

type Events = {
	"chat.mode.toggle": { from: "voice" | "text"; to: "voice" | "text" };
	"quiz.skip": { moduleId: string; questionId?: string };
	"menu.enter": { item: string } | undefined;
};

// Reference the symbol so unused-import lint doesn't fire.
export const _typeFixture = (): Tracker<Events> | null => null;

// deno-lint-ignore no-unused-vars
function _typeChecks(tracker: Tracker<Events>): void {
	// ✅ Correct payload
	tracker.track("chat.mode.toggle", { from: "voice", to: "text" });

	// ✅ Optional payload event accepts no data arg
	tracker.track("menu.enter");
	tracker.track("menu.enter", { item: "settings" });

	// ✅ Default permissive event map
	const generic = new Tracker({ transport: async () => true });
	generic.track("anything");
	generic.track("anything-with-data", { x: 1 });

	// @ts-expect-error wrong payload shape
	tracker.track("chat.mode.toggle", { from: "voice" });

	// @ts-expect-error unknown event name
	tracker.track("does.not.exist");

	// @ts-expect-error required-payload event called with no data
	tracker.track("quiz.skip");
}

Deno.test("type tests compile (presence test)", () => {
	// no-op runtime placeholder
});
