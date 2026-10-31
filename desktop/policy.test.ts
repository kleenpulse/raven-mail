import { describe, expect, test } from "bun:test";
import { classifyUrl } from "./policy";

const APP = "http://127.0.0.1:52731";

describe("classifyUrl", () => {
	test("pages and blobs from the local server stay in the app", () => {
		expect(classifyUrl(`${APP}/mail?folder=INBOX`, APP)).toEqual({ kind: "app" });
		expect(classifyUrl(`blob:${APP}/4b7f0c1e-1d2a-4a51-9a0e-6f1f7b0d9a11`, APP)).toEqual({ kind: "app" });
	});

	test("web, mail and phone links go to the OS", () => {
		expect(classifyUrl("https://example.com/a?b=1", APP)).toEqual({ kind: "external", url: "https://example.com/a?b=1" });
		expect(classifyUrl("http://example.com/", APP)).toEqual({ kind: "external", url: "http://example.com/" });
		expect(classifyUrl("mailto:someone@example.com", APP)).toEqual({ kind: "external", url: "mailto:someone@example.com" });
		expect(classifyUrl("tel:+15551234567", APP)).toEqual({ kind: "external", url: "tel:+15551234567" });
	});

	test("lookalikes of the app origin are not the app", () => {
		expect(classifyUrl("http://127.0.0.1:52732/mail", APP).kind).toBe("external");
		expect(classifyUrl("http://127.0.0.1.evil.test:52731/", APP).kind).toBe("external");
		expect(classifyUrl("https://127.0.0.1:52731/", APP).kind).toBe("external");
		expect(classifyUrl("http://localhost:52731/", APP).kind).toBe("external");
		expect(classifyUrl("blob:https://evil.test/4b7f0c1e", APP)).toEqual({ kind: "deny" });
	});

	test("script, file, data and unknown schemes are dropped", () => {
		for (const url of ["javascript:alert(1)", "file:///C:/Windows/win.ini", "data:text/html,<p>x</p>", "vscode://x", "ms-settings:", "not a url"]) {
			expect(classifyUrl(url, APP)).toEqual({ kind: "deny" });
		}
	});

	test("before the server is up, nothing counts as the app", () => {
		expect(classifyUrl(`${APP}/overview`, null).kind).toBe("external");
	});
});
