import { describe, expect, test } from "bun:test";
import { readLastSeen, whatsNewAction, writeLastSeen } from "@/lib/changelog/seen";

describe("whatsNewAction", () => {
	test("nothing recorded: seed silently, no card", () => {
		expect(whatsNewAction(null, "0.2.0")).toBe("seed");
	});

	test("an upgrade since the last dismissal shows the card", () => {
		expect(whatsNewAction("0.1.0", "0.2.0")).toBe("show");
	});

	test("already seen: nothing", () => {
		expect(whatsNewAction("0.2.0", "0.2.0")).toBe("none");
	});
});

// No DOM here, so no localStorage: the same path as blocked site data.
describe("last seen storage without localStorage", () => {
	test("reads as never seen and writes without throwing", () => {
		expect(readLastSeen()).toBeNull();
		expect(() => writeLastSeen("0.2.0")).not.toThrow();
	});
});
