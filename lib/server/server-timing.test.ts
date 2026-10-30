import { describe, expect, test } from "bun:test";
import { serverTiming } from "./server-timing";

describe("serverTiming", () => {
	test("lists each phase in order, to a tenth of a millisecond", () => {
		expect(serverTiming({ wait: 0.04, connect: 212.456, open: 80 })).toBe("wait;dur=0, connect;dur=212.5, open;dur=80");
	});

	test("drops names a header can't carry and values that aren't times", () => {
		expect(serverTiming({ "bad name": 1, "a,b": 2, ok: Number.NaN, fine: 3 })).toBe("fine;dur=3");
	});

	test("never reports a negative time", () => {
		expect(serverTiming({ skew: -5 })).toBe("skew;dur=0");
	});
});
