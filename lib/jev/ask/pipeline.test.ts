import { describe, expect, mock, test } from "bun:test";
import { answers, fakeJev } from "@/test/helpers/jev";
import { makeSession } from "@/test/helpers/session";
import { runAsk } from "@/lib/jev/ask/pipeline";
import { getSnapshot } from "@/lib/mail/snapshot";
import { enrichSnapshot, person } from "@/lib/insights/metrics";
import type { AskAnswer, AskEvent, AskRequest } from "@/lib/jev/ask/types";
import type { MailSession } from "@/lib/session";

/* Runs against the offline dev mailbox (makeSession() is a dev session): no IMAP, no network. */

type Call = { questions: Record<string, { criteria: Record<string, string> }> };

async function collect(request: AskRequest, { session = makeSession(), signal }: { session?: MailSession; signal?: AbortSignal } = {}) {
	const events: AskEvent[] = [];
	for await (const e of runAsk(session, request, { tz: "UTC", signal })) events.push(e);
	return events;
}

const stages = (events: AskEvent[]) => events.map((e) => (e.type === "stage" ? e.stage : e.type));
const detailOf = (events: AskEvent[], stage: string) =>
	events.filter((e): e is Extract<AskEvent, { type: "stage" }> => e.type === "stage" && e.stage === stage).map((e) => e.detail);

function answerOf(events: AskEvent[]): AskAnswer {
	const last = events[events.length - 1];
	if (last?.type !== "answer") throw new Error(`expected a terminal answer, got ${JSON.stringify(last)}`);
	return last.answer;
}

const PLAN_ANSWER = answers({
	intent: { choice: "find_topic", confidence: 0.9, probabilities: { find_topic: 0.9 } },
	timeframe: { choice: "any" },
	scope: { choice: "inbox" },
	unreadOnly: { noul: 0 },
	sender: { choice: "none", confidence: 0.9 },
});

/** Jev on: planning answers find_topic; ranking delegates to `rank` with the label criteria. */
function jevWith(rank: (criteria: Record<string, string>) => Promise<Record<string, unknown>> | Record<string, unknown>) {
	fakeJev.enabled = true;
	fakeJev.systemOne = mock(async (input: unknown) => {
		const { questions } = input as Call;
		if (questions.best) return answers({ best: await rank(questions.best.criteria) });
		return PLAN_ANSWER;
	});
}

describe("runAsk (Jev off)", () => {
	test("understand → understand → search → answer; no rank stage", async () => {
		const events = await collect({ question: "anything about the roadmap" });
		expect(stages(events)).toEqual(["understand", "understand", "search", "answer"]);
		expect(detailOf(events, "understand")).toEqual(["Reading your question", "Find a topic · 45% via keyword match"]);
		expect(detailOf(events, "search")).toEqual(["Searching your mailbox for “roadmap”"]);
		expect(detailOf(events, "rank")).toEqual([]);
		const answer = answerOf(events);
		expect(answer.plan.source).toBe("heuristic");
		expect(answer.question).toBe("anything about the roadmap");
		expect(answer.empty).toBe(false);
		expect(answer.evidence.length).toBeGreaterThan(0);
		expect(answer.narration).toBeNull();
		expect(fakeJev.systemOne).not.toHaveBeenCalled();
	});

	test("non-topical intents scan the snapshot", async () => {
		const events = await collect({ question: "What's urgent?" });
		expect(detailOf(events, "search")[0]).toMatch(/^Scanning [\d,]+ messages · last 7 days$/);
		expect(answerOf(events).plan.intent).toBe("urgent");
	});

	test("“needs my reply today” means as of today, not arrived today", async () => {
		expect(answerOf(await collect({ question: "What needs my reply today?" })).plan.timeframe).toBe("any");
		expect(answerOf(await collect({ question: "Who owes me a reply today?" })).plan.timeframe).toBe("any");
		expect(answerOf(await collect({ question: "What's urgent today?" })).plan.timeframe).toBe("today");
	});

	test("a forced intent is reported as a suggestion", async () => {
		const events = await collect({ question: "Receipts from this month", forcedIntent: "receipts" });
		expect(detailOf(events, "understand")[1]).toBe("Receipts · 100% via suggestion");
		expect(answerOf(events).plan.source).toBe("forced");
	});
});

describe("runAsk (Jev on)", () => {
	test("ranks rankable candidates with Jev and uses its order", async () => {
		let labels: Record<string, string> = {};
		jevWith((criteria) => {
			labels = criteria;
			const last = `m${Object.keys(criteria).length - 2}`;
			return { choice: last, probabilities: { [last]: 0.9 } };
		});
		const events = await collect({ question: "anything about the roadmap" });
		expect(stages(events)).toEqual(["understand", "understand", "search", "rank", "answer"]);
		expect(detailOf(events, "understand")[1]).toBe("Find a topic · 90% via Jev");

		const pool = Object.keys(labels).length - 1;
		expect(pool).toBeGreaterThan(1);
		expect(detailOf(events, "rank")).toEqual([`Ranking ${pool} candidates with Jev`]);
		expect(fakeJev.systemOne).toHaveBeenCalledTimes(2);

		const answer = answerOf(events);
		expect(answer.plan.source).toBe("jev");
		// Everything under 10% of the top was dropped; the one survivor is the label Jev picked.
		expect(answer.evidence).toHaveLength(1);
		expect(answer.evidence[0]!.score).toBe(0.9);
		expect(labels[`m${pool - 1}`]).toContain(answer.evidence[0]!.subject);
		expect(answer.headline).toBe("1 email about “roadmap”");
	});

	test("a failed rank falls back to the heuristic order", async () => {
		jevWith(() => {
			throw new Error("rank timeout");
		});
		const events = await collect({ question: "anything about the roadmap" });
		expect(detailOf(events, "rank")).toHaveLength(1);
		const answer = answerOf(events);
		expect(answer.evidence.length).toBeGreaterThan(1);
		expect(answer.evidence.every((e) => e.score === undefined)).toBe(true);
	});

	test("no rank stage for non-rankable intents", async () => {
		fakeJev.enabled = true;
		const events = await collect({ question: "What can you do?", forcedIntent: "help" });
		expect(detailOf(events, "rank")).toEqual([]);
		expect(fakeJev.systemOne).not.toHaveBeenCalled();
		expect(answerOf(events).headline).toBe("Here’s what I can find");
	});
});

describe("runAsk context", () => {
	test("the open message's sender fills in a person-scoped question", async () => {
		const session = makeSession();
		const { rows } = enrichSnapshot(await getSnapshot(session, { days: 30 }), { now: Date.now(), tz: "UTC" });
		const open = rows.find((r) => r.folder === "inbox" && r.bucket === "people")!;
		expect(open).toBeDefined();
		const events = await collect(
			{ question: "How fast do they reply?", context: { folder: open.path, uid: String(open.uid) } },
			{ session },
		);
		const { plan } = answerOf(events);
		expect(plan.intent).toBe("response_time");
		expect(plan.sender).toEqual(person(open.from));
		expect(plan.senderConfidence).toBe(1);
	});

	test("a Sent message contributes its first recipient", async () => {
		const session = makeSession();
		const { rows } = enrichSnapshot(await getSnapshot(session, { days: 30 }), { now: Date.now(), tz: "UTC" });
		const open = rows.find((r) => r.folder === "sent" && r.to.length > 0)!;
		expect(open).toBeDefined();
		const events = await collect(
			{ question: "How fast do they reply?", context: { folder: open.path, uid: String(open.uid) } },
			{ session },
		);
		expect(answerOf(events).plan.sender).toEqual(person(open.to[0]!));
	});

	test("other intents ignore the open message", async () => {
		const session = makeSession();
		const { rows } = enrichSnapshot(await getSnapshot(session, { days: 30 }), { now: Date.now(), tz: "UTC" });
		const open = rows.find((r) => r.folder === "inbox" && r.bucket === "people")!;
		const events = await collect(
			{ question: "Anything urgent?", context: { folder: open.path, uid: String(open.uid) } },
			{ session },
		);
		expect(answerOf(events).plan.sender).toBeUndefined();
	});

	test("an unknown uid changes nothing", async () => {
		const events = await collect({ question: "How fast do they reply?", context: { folder: "INBOX", uid: "999999" } });
		expect(answerOf(events).plan.sender).toBeUndefined();
	});
});

describe("runAsk abort", () => {
	test("an already-aborted signal stops after understanding, with no answer", async () => {
		const controller = new AbortController();
		controller.abort();
		const events = await collect({ question: "anything about the roadmap" }, { signal: controller.signal });
		expect(stages(events)).toEqual(["understand", "understand"]);
	});

	test("aborting during the rank stage drops the answer", async () => {
		const controller = new AbortController();
		jevWith(() => {
			controller.abort();
			return { choice: "m0", probabilities: { m0: 1 } };
		});
		const events = await collect({ question: "anything about the roadmap" }, { signal: controller.signal });
		expect(stages(events)).toEqual(["understand", "understand", "search", "rank"]);
	});

	test("Jev receives the caller's signal", async () => {
		const controller = new AbortController();
		jevWith(() => ({ choice: "m0", probabilities: { m0: 1 } }));
		await collect({ question: "anything about the roadmap" }, { signal: controller.signal });
		for (const call of fakeJev.systemOne.mock.calls) expect((call[1] as { signal?: AbortSignal }).signal).toBe(controller.signal);
	});
});
