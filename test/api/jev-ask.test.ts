import { describe, expect, test } from "bun:test";
import { POST } from "@/app/api/jev/ask/route";
import type { AskAnswer, AskEvent } from "@/lib/jev/ask/types";
import { call, readJson, readNdjsonAll, req } from "../helpers/request";
import { answers, fakeJev } from "../helpers/jev";
import { makeSession } from "../helpers/session";

type Err = { ok: false; error: string; code: string };

function ask(json: unknown, opts: Parameters<typeof req>[1] = {}) {
	return call(POST, req("/api/jev/ask", { json, ...opts }));
}

async function answerOf(res: Response): Promise<{ events: AskEvent[]; answer: AskAnswer }> {
	const events = await readNdjsonAll<AskEvent>(res);
	const last = events.at(-1)!;
	expect(last.type).toBe("answer");
	return { events, answer: (last as Extract<AskEvent, { type: "answer" }>).answer };
}

/** Plan call gets structured answers; any other Jev call (ranking) fails and falls back. */
function jevPlans(map: Record<string, Record<string, unknown>>) {
	fakeJev.enabled = true;
	fakeJev.systemOne.mockImplementation(async (input: unknown) => {
		const questions = (input as { questions?: Record<string, unknown> }).questions ?? {};
		if ("intent" in questions) return answers(map);
		throw new Error("rank not mocked");
	});
}

describe("POST /api/jev/ask — streaming", () => {
	test("NDJSON content-type; stages then exactly one terminal answer", async () => {
		const question = "what needs a reply?";
		const res = await ask({ question, tz: "UTC" });
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		const { events, answer } = await answerOf(res);
		expect(events.slice(0, -1).every((e) => e.type === "stage")).toBe(true);
		expect(events.filter((e) => e.type === "answer" || e.type === "error")).toHaveLength(1);
		expect(events[0]).toMatchObject({ type: "stage", stage: "understand" });
		expect(answer.question).toBe(question);
		expect(typeof answer.headline).toBe("string");
		expect(Array.isArray(answer.evidence)).toBe(true);
		expect(answer.plan.source).toBe("heuristic");
		expect(answer.narration).toBeNull();
	});

	test("forcedIntent → plan source 'forced' with that intent", async () => {
		const { answer } = await answerOf(await ask({ question: "anything", forcedIntent: "security" }));
		expect(answer.plan).toMatchObject({ source: "forced", intent: "security" });
	});

	test("tz defaults to UTC when omitted", async () => {
		const res = await ask({ question: "how many emails did I get this week?" });
		expect(res.status).toBe(200);
		await answerOf(res);
	});

	test("context with folder + uid is accepted", async () => {
		const res = await ask({ question: "who is this from?", context: { folder: "INBOX", uid: "1" } });
		expect(res.status).toBe(200);
		await answerOf(res);
	});
});

describe("POST /api/jev/ask — guards", () => {
	test("401 without a session", async () => {
		const res = await ask({ question: "hi" }, { session: null });
		expect(res.status).toBe(401);
	});

	test("415 on text/plain", async () => {
		const res = await call(
			POST,
			req("/api/jev/ask", { body: JSON.stringify({ question: "hi" }), headers: { "content-type": "text/plain" } }),
		);
		expect(res.status).toBe(415);
		expect((await readJson<Err>(res)).code).toBe("unsupported_media_type");
	});

	test("415 with no content-type", async () => {
		const res = await call(POST, req("/api/jev/ask", { body: "{}" }));
		expect(res.status).toBe(415);
	});

	test("403 cross-origin", async () => {
		const res = await ask({ question: "hi" }, { origin: "https://evil.example" });
		expect(res.status).toBe(403);
		expect((await readJson<Err>(res)).code).toBe("forbidden");
	});

	test("403 on an unparseable Origin", async () => {
		const res = await ask({ question: "hi" }, { origin: "not a url" });
		expect(res.status).toBe(403);
	});

	test("400 malformed JSON", async () => {
		const res = await call(
			POST,
			req("/api/jev/ask", { body: "{not json", headers: { "content-type": "application/json" } }),
		);
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).error).toBe("Malformed JSON.");
	});

	test.each([
		["empty", ""],
		["whitespace only", "   \n\t "],
	])("400 on %s question", async (_name, question) => {
		const res = await ask({ question });
		expect(res.status).toBe(400);
		expect(await readJson(res)).toEqual({ ok: false, error: "Ask something.", code: "bad_request" });
	});

	test("400 on oversize question (501 chars)", async () => {
		const res = await ask({ question: "a".repeat(501) });
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).error).toBe("Keep it under 500 characters.");
	});

	test("500 chars is accepted", async () => {
		const res = await ask({ question: "a".repeat(500) });
		expect(res.status).toBe(200);
		await readNdjsonAll(res);
	});

	test("400 on unknown forcedIntent", async () => {
		const res = await ask({ question: "hi", forcedIntent: "summarize_everything" });
		expect(res.status).toBe(400);
	});

	test("400 on unknown time zone", async () => {
		const res = await ask({ question: "hi", tz: "Nowhere/Land" });
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).error).toBe("Unknown time zone.");
	});

	test("400 on bad context uid", async () => {
		const res = await ask({ question: "hi", context: { folder: "INBOX", uid: "x1" } });
		expect(res.status).toBe(400);
	});

	test("rate limit: 20 per minute per session, 21st → 429", async () => {
		const session = makeSession();
		for (let i = 0; i < 20; i++) {
			const res = await ask({ question: "what needs a reply?", forcedIntent: "help" }, { session });
			expect(res.status).toBe(200);
			await readNdjsonAll(res);
		}
		const res = await ask({ question: "what needs a reply?" }, { session });
		expect(res.status).toBe(429);
		const body = await readJson<Err>(res);
		expect(body.code).toBe("rate_limited");
		expect(body.error).toMatch(/try again in \d+s/);

		// A different mailbox has its own bucket.
		const other = await ask({ question: "what needs a reply?", forcedIntent: "help" });
		expect(other.status).toBe(200);
		await readNdjsonAll(other);
	});

	test("rejected requests (400/415) don't spend the rate limit", async () => {
		const session = makeSession();
		for (let i = 0; i < 25; i++) {
			const res = await ask({ question: "" }, { session });
			expect(res.status).toBe(400);
		}
		const res = await ask({ question: "hi", forcedIntent: "help" }, { session });
		expect(res.status).toBe(200);
		await readNdjsonAll(res);
	});
});

describe("POST /api/jev/ask — Jev planning", () => {
	test("Jev answers drive the plan (source 'jev')", async () => {
		jevPlans({
			intent: { choice: "urgent", confidence: 0.913, probabilities: { urgent: 0.913, needs_reply: 0.05, other: 0.03, security: 0.007 } },
			timeframe: { choice: "any", confidence: 0.8 },
			scope: { choice: "all", confidence: 0.7 },
			unreadOnly: { noul: 0.9 },
			sender: { choice: "none", confidence: 0.95 },
		});
		const { answer } = await answerOf(await ask({ question: "anything I should worry about?" }));
		expect(fakeJev.systemOne).toHaveBeenCalled();
		const planCall = fakeJev.systemOne.mock.calls.find(
			([input]) => "intent" in ((input as { questions?: object }).questions ?? {}),
		);
		expect(planCall).toBeDefined();
		expect((planCall![0] as { state: { question: string } }).state.question).toBe("anything I should worry about?");
		expect(answer.plan.source).toBe("jev");
		expect(answer.plan.intent).toBe("urgent");
		expect(answer.plan.intentConfidence).toBe(0.91);
		expect(answer.plan.scope).toBe("all");
		expect(answer.plan.unreadOnly).toBe(true);
		// "other" and the chosen intent never appear as alternatives; highest first.
		expect(answer.plan.alternatives.map((a) => a.intent)).toEqual(["needs_reply", "security"]);
		expect(answer.plan.alternatives[0]!.p).toBe(0.05);
	});

	test("awaiting_others forces scope 'sent'", async () => {
		jevPlans({
			intent: { choice: "awaiting_others", confidence: 0.8, probabilities: { awaiting_others: 0.8 } },
			timeframe: { choice: "last_7_days" },
			scope: { choice: "inbox" },
			unreadOnly: { noul: 0 },
		});
		const { answer } = await answerOf(await ask({ question: "who owes me an answer?" }));
		expect(answer.plan).toMatchObject({ source: "jev", intent: "awaiting_others", scope: "sent", unreadOnly: false });
	});

	test("an unknown Jev intent falls back to the heuristic intent but keeps source 'jev'", async () => {
		jevPlans({
			intent: { choice: "not_an_intent", confidence: 0.4, probabilities: {} },
			timeframe: { choice: "any" },
			scope: { choice: "inbox" },
			unreadOnly: { noul: 0 },
		});
		const heuristic = (await answerOf(await ask({ question: "any security alerts?", tz: "UTC" }))).answer.plan;
		expect(heuristic.source).toBe("jev");
		fakeJev.reset();
		const plain = (await answerOf(await ask({ question: "any security alerts?", tz: "UTC" }))).answer.plan;
		expect(plain.source).toBe("heuristic");
		expect(heuristic.intent).toBe(plain.intent);
	});

	test("Jev failure → heuristic plan, still a clean answer", async () => {
		fakeJev.enabled = true;
		fakeJev.systemOne.mockImplementation(async () => {
			throw new Error("jev down");
		});
		const { events, answer } = await answerOf(await ask({ question: "what needs a reply?" }));
		expect(fakeJev.systemOne).toHaveBeenCalled();
		expect(answer.plan.source).toBe("heuristic");
		expect(events.some((e) => e.type === "error")).toBe(false);
	});

	test("Jev disabled → systemOne never called", async () => {
		const { answer } = await answerOf(await ask({ question: "what needs a reply?" }));
		expect(fakeJev.systemOne).not.toHaveBeenCalled();
		expect(answer.plan.source).toBe("heuristic");
	});
});
