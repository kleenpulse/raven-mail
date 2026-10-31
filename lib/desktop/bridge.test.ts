import { describe, expect, test } from "bun:test";
import { isAppPath, MAX_NOTIFY, newMailForDesktop } from "@/lib/desktop/bridge";

const arrival = (uid: string, name = "Ada", address = "ada@example.test", subject = "Hi") => ({ uid, subject, from: { name, address } });

describe("newMailForDesktop", () => {
	test("hands over sender and subject while Raven isn't in focus", () => {
		expect(newMailForDesktop([arrival("7"), arrival("6", "", "grace@example.test", "Re: x")], { enabled: true, focused: false })).toEqual([
			{ uid: "7", from: "Ada", subject: "Hi" },
			{ uid: "6", from: "grace@example.test", subject: "Re: x" },
		]);
	});

	test("nothing when Raven is in focus, the setting is off, or nothing arrived", () => {
		expect(newMailForDesktop([arrival("7")], { enabled: true, focused: true })).toBeNull();
		expect(newMailForDesktop([arrival("7")], { enabled: false, focused: false })).toBeNull();
		expect(newMailForDesktop([], { enabled: true, focused: false })).toBeNull();
	});

	test("caps the batch at what the desktop app accepts", () => {
		const many = Array.from({ length: MAX_NOTIFY + 5 }, (_, i) => arrival(String(i + 1)));
		expect(newMailForDesktop(many, { enabled: true, focused: false })).toHaveLength(MAX_NOTIFY);
	});
});

describe("isAppPath", () => {
	test("same-app paths only", () => {
		expect(isAppPath("/mail?uid=1")).toBe(true);
		for (const bad of ["//evil.test", "https://evil.test", "/\\evil.test", "/\t/evil.test", "/\n/evil.test", "mail"]) expect(isAppPath(bad)).toBe(false);
	});
});
