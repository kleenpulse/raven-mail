import { describe, expect, test } from "bun:test";
import { checkRequest } from "./guard";

const PORT = 52731;
const TOKEN = "Zk3y1o8mQq0V8m3g5yS0bq1k7v3t4c9wX2r6p5n4m3l";
const good = { host: `127.0.0.1:${PORT}`, "x-raven-desktop": TOKEN };

describe("checkRequest", () => {
	test("the app's own requests pass", () => {
		expect(checkRequest(good, PORT, TOKEN)).toEqual({ ok: true });
	});

	test("a missing or wrong token is refused, whatever its length", () => {
		const noToken = { host: good.host };
		for (const headers of [noToken, { ...good, "x-raven-desktop": "" }, { ...good, "x-raven-desktop": TOKEN.slice(1) }, { ...good, "x-raven-desktop": `${TOKEN}x` }, { ...good, "x-raven-desktop": TOKEN.replace("Z", "Y") }]) {
			expect(checkRequest(headers, PORT, TOKEN)).toEqual({ ok: false, reason: "token" });
		}
	});

	test("any other Host is refused, even with the token (DNS rebinding)", () => {
		for (const host of ["evil.test", `evil.test:${PORT}`, `localhost:${PORT}`, `127.0.0.1:${PORT + 1}`, "127.0.0.1", undefined]) {
			expect(checkRequest({ ...good, host }, PORT, TOKEN)).toEqual({ ok: false, reason: "host" });
		}
	});

	test("the token is checked, not removed: Next re-sends these headers on server-action redirects", () => {
		const headers = { ...good };
		checkRequest(headers, PORT, TOKEN);
		expect(headers["x-raven-desktop"]).toBe(TOKEN);
	});
});
