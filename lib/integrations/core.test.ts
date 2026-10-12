import { describe, expect, test } from "bun:test";
import { deliver } from "@/lib/integrations/deliver";
import { IntegrationError } from "@/lib/integrations/errors";
import { maskUrl, parseHttpUrl, parseRetryAfter, type HttpResult } from "@/lib/integrations/http";
import { classifyImapError, classifySmtpError } from "@/lib/integrations/diagnostics/classify";
import { netErrorCode } from "@/lib/integrations/net-errors";
import { FAILURE_LIMIT, nextHealth, type ConnectionHealth } from "@/lib/integrations/status";
import { runSteps, type Step } from "@/lib/integrations/steps";
import type { StepEvent } from "@/lib/integrations/types";

const ok: HttpResult = { status: 200, headers: {}, body: "ok", ms: 40 };
const judge = (r: HttpResult) =>
	r.status === 200
		? null
		: r.status === 429
			? new IntegrationError("rate_limited", { retryAfterMs: Number(r.headers["retry-after"]) * 1000 })
			: r.status >= 500
				? new IntegrationError("upstream_error")
				: new IntegrationError("revoked");

function fakeClock() {
	let t = 0;
	const waits: number[] = [];
	return {
		now: () => t,
		sleep: async (ms: number) => {
			waits.push(ms);
			t += ms;
		},
		waits,
	};
}

describe("deliver", () => {
	test("retries transient failures then succeeds", async () => {
		const clock = fakeClock();
		const answers = [{ ...ok, status: 503 }, { ...ok, status: 502 }, ok];
		const result = await deliver(async () => answers.shift()!, judge, { ...clock, random: () => 0.5 });
		expect(result.ok).toBe(true);
		expect(result.attempts).toBe(3);
		expect(clock.waits).toEqual([500, 1500]);
	});

	test("fails fast on errors retrying can't fix", async () => {
		const clock = fakeClock();
		let calls = 0;
		const result = await deliver(async () => (calls++, { ...ok, status: 404 }), judge, clock);
		expect(result.ok).toBe(false);
		expect(calls).toBe(1);
		if (!result.ok) expect(result.error.code).toBe("revoked");
	});

	test("honours short Retry-After, gives up on long ones", async () => {
		const clock = fakeClock();
		const answers: HttpResult[] = [{ ...ok, status: 429, headers: { "retry-after": "2" } }, ok];
		const short = await deliver(async () => answers.shift()!, judge, clock);
		expect(short.ok).toBe(true);
		expect(clock.waits).toEqual([2000]);

		const long = await deliver(async () => ({ ...ok, status: 429, headers: { "retry-after": "30" } }), judge, fakeClock());
		expect(long.ok).toBe(false);
		if (!long.ok) expect(long.error.retryAfterMs).toBe(30_000);
	});

	test("network throws count as retryable attempts", async () => {
		const clock = fakeClock();
		let n = 0;
		const result = await deliver(
			async () => {
				if (n++ === 0) throw new IntegrationError("network");
				return ok;
			},
			judge,
			clock,
		);
		expect(result.ok).toBe(true);
		expect(result.attempts).toBe(2);
	});
});

describe("nextHealth", () => {
	const active = { status: "active" as const, failureStreak: 0 };
	test("attention errors flag at once, transient ones after a streak", () => {
		expect(nextHealth(active, { ok: false, error: new IntegrationError("revoked") }).status).toBe("error");
		let health: ConnectionHealth = active;
		for (let i = 0; i < FAILURE_LIMIT - 1; i++) health = nextHealth(health, { ok: false, error: new IntegrationError("timeout") });
		expect(health).toEqual({ status: "active", failureStreak: FAILURE_LIMIT - 1 });
		expect(nextHealth(health, { ok: false, error: new IntegrationError("timeout") }).status).toBe("error");
		expect(nextHealth({ status: "error", failureStreak: 7 }, { ok: true })).toEqual(active);
	});

	test("our own bad payloads and paused connections don't move the needle", () => {
		expect(nextHealth(active, { ok: false, error: new IntegrationError("payload_rejected") })).toEqual(active);
		const paused = { status: "paused" as const, failureStreak: 1 };
		expect(nextHealth(paused, { ok: true })).toEqual(paused);
	});
});

describe("runSteps", () => {
	test("announces the plan, times steps, skips, and finishes", async () => {
		let t = 0;
		const steps: Step<{ n: number }>[] = [
			{ id: "a", label: "A", run: async (ctx) => ((t += 5), (ctx.n += 1), "one") },
			{ id: "b", label: "B", skip: () => "not needed", run: async () => {} },
			{ id: "c", label: "C", run: async (ctx) => void (ctx.n += 1) },
		];
		const events: StepEvent[] = [];
		for await (const e of runSteps(steps, { n: 0 }, (ctx) => ctx.n, { now: () => t })) events.push(e);
		expect(events[0]).toEqual({ type: "plan", steps: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }] });
		expect(events).toContainEqual({ type: "step", id: "a", status: "ok", ms: 5, detail: "one" });
		expect(events).toContainEqual({ type: "step", id: "b", status: "skipped", detail: "not needed" });
		expect(events.at(-1)).toEqual({ type: "done", result: 2 });
	});

	test("stops at the first failure and names the step", async () => {
		const steps: Step<object>[] = [
			{ id: "reach", label: "Reach", run: async () => { throw new IntegrationError("dns_failed"); } },
			{ id: "never", label: "Never", run: async () => "x" },
		];
		const events: StepEvent[] = [];
		for await (const e of runSteps(steps, {}, () => null)) events.push(e);
		expect(events.some((e) => e.type === "step" && e.id === "never")).toBe(false);
		expect(events.at(-1)).toMatchObject({ type: "error", code: "dns_failed", step: "reach", retryable: true });
	});
});

describe("http helpers", () => {
	const prod = { allowLoopback: false, allowPrivate: false };
	test("blocks private literal IPs and plain http in production", () => {
		for (const url of ["https://10.0.0.5/x", "https://[::1]/x", "https://169.254.169.254/latest", "http://api.acme.io/x"]) {
			expect(() => parseHttpUrl(url, prod)).toThrow(IntegrationError);
		}
		expect(parseHttpUrl("https://api.acme.io/x#frag", prod).toString()).toBe("https://api.acme.io/x");
	});

	test("Retry-After seconds and dates; masked URLs", () => {
		expect(parseRetryAfter("3")).toBe(3000);
		expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6_000);
		expect(parseRetryAfter("soon")).toBeUndefined();
		expect(maskUrl(new URL("https://hooks.zapier.com/hooks/catch/123/abc/?x=1"))).toBe("hooks.zapier.com/hooks/catch/••••");
	});
});

describe("error classification", () => {
	test("socket and TLS codes", () => {
		expect(netErrorCode({ code: "ENOTFOUND" })).toBe("dns_failed");
		expect(netErrorCode({ message: "x", cause: { code: "CERT_HAS_EXPIRED" } })).toBe("cert_invalid");
		expect(netErrorCode({ code: "ERR_SSL_WRONG_VERSION_NUMBER" })).toBe("tls_failed");
		expect(netErrorCode({ name: "TimeoutError" })).toBe("timeout");
		expect(netErrorCode(new Error("plain"))).toBeNull();
	});

	test("imapflow and nodemailer failures, with provider hints", () => {
		const auth = classifyImapError({ authenticationFailed: true, message: "Authentication failed" }, "gmail");
		expect(auth.code).toBe("imap_auth_failed");
		expect(auth.hint).toContain("app password");
		expect(classifyImapError({ code: "CONNECT_TIMEOUT" }).code).toBe("timeout");
		expect(classifyImapError({ code: "ECONNREFUSED" }).code).toBe("imap_unreachable");
		expect(classifySmtpError({ code: "EAUTH", responseCode: 535 }, "icloud").hint).toContain("app-specific");
		expect(classifySmtpError({ code: "EREQUIRETLS" }).code).toBe("tls_required");
		expect(classifySmtpError({ code: "ECONNECTION" }).code).toBe("smtp_unreachable");
	});
});
