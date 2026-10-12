import { describe, expect, mock, test } from "bun:test";
import { answers, fakeJev, testJev } from "@/test/helpers/jev";
import { planAsk } from "@/lib/jev/ask/plan";
import { forcePlan, heuristicPlan } from "@/lib/jev/ask/heuristic-plan";
import { DEFAULT_TIMEFRAME } from "@/lib/jev/ask/catalog";
import { INTENTS, TIMEFRAMES, type AskRequest } from "@/lib/jev/ask/types";
import type { PersonRef } from "@/lib/insights/types";

const senders: PersonRef[] = [
	{ name: "Maya Chen", address: "maya.chen@northwind.example" },
	{ name: "Priya Raman", address: "priya@fieldwork.example" },
	{ name: "Stripe", address: "receipts@stripe.example" },
];

type Loose = Record<string, unknown>;

/** A full, confident Jev answer; override any question's answer per test. */
function jev(over: Record<string, Loose> = {}) {
	return answers({
		intent: { choice: "find_topic", confidence: 0.9, probabilities: { find_topic: 0.9 } },
		timeframe: { choice: "any", confidence: 0.9 },
		scope: { choice: "inbox", confidence: 0.9 },
		unreadOnly: { noul: 0.1 },
		sender: { choice: "none", confidence: 0.9 },
		...over,
	});
}

function useJev(over: Record<string, Loose> = {}) {
	fakeJev.enabled = true;
	fakeJev.systemOne = mock(async () => jev(over));
	return fakeJev.systemOne;
}

type Call = { state: { question: string }; questions: Record<string, { type: string; criteria: Record<string, string> | null }> };

function firstCall(): [Call, { signal?: AbortSignal } | undefined] {
	return fakeJev.systemOne.mock.calls[0] as unknown as [Call, { signal?: AbortSignal } | undefined];
}

const ask = (question: string, extra: Partial<AskRequest> = {}): AskRequest => ({ question, ...extra });

describe("planAsk short-circuits", () => {
	test("forcedIntent returns forcePlan without calling Jev", async () => {
		fakeJev.enabled = true;
		const plan = await planAsk(ask("Emails from Maya this week", { forcedIntent: "from_person" }), senders, testJev());
		expect(fakeJev.systemOne).not.toHaveBeenCalled();
		expect(plan).toEqual(forcePlan("Emails from Maya this week", "from_person", senders));
		expect(plan.source).toBe("forced");
		expect(plan.intentConfidence).toBe(1);
	});

	test("disabled Jev falls back to the heuristic plan", async () => {
		const plan = await planAsk(ask("Receipts from this month"), senders, testJev());
		expect(fakeJev.systemOne).not.toHaveBeenCalled();
		expect(plan).toEqual(heuristicPlan("Receipts from this month", senders));
		expect(plan.source).toBe("heuristic");
	});

	test("systemOne throwing yields the heuristic plan", async () => {
		fakeJev.enabled = true;
		fakeJev.systemOne = mock(async () => {
			throw new Error("timeout");
		});
		const plan = await planAsk(ask("Who owes me a reply?"), senders, testJev());
		expect(fakeJev.systemOne).toHaveBeenCalledTimes(1);
		expect(plan).toEqual(heuristicPlan("Who owes me a reply?", senders));
	});

	test("a malformed response (no intent answer) yields the heuristic plan", async () => {
		fakeJev.enabled = true;
		fakeJev.systemOne = mock(async () => answers({ timeframe: { choice: "today" } }));
		const plan = await planAsk(ask("Any security alerts?"), senders, testJev());
		expect(plan).toEqual(heuristicPlan("Any security alerts?", senders));
	});
});

describe("planAsk questions sent to Jev", () => {
	test("question is the only state; signal is forwarded", async () => {
		useJev();
		const controller = new AbortController();
		await planAsk(ask("anything about pricing"), senders, testJev(), controller.signal);
		const [input, opts] = firstCall();
		expect(input.state).toEqual({ question: "anything about pricing" });
		expect(opts?.signal).toBe(controller.signal);
	});

	test("intent/timeframe/scope/unreadOnly questions cover every label", async () => {
		useJev();
		await planAsk(ask("anything about pricing"), senders, testJev());
		const [{ questions }] = firstCall();
		expect(Object.keys(questions).sort()).toEqual(["intent", "scope", "sender", "timeframe", "unreadOnly"]);
		expect(questions.intent!.type).toBe("choice");
		expect(Object.keys(questions.intent!.criteria!)).toEqual([...INTENTS]);
		expect(Object.keys(questions.timeframe!.criteria!)).toEqual([...TIMEFRAMES]);
		expect(Object.keys(questions.scope!.criteria!)).toEqual(["inbox", "sent", "all"]);
		expect(questions.unreadOnly!.type).toBe("noul");
	});

	test("contacts appear as sN labels plus none", async () => {
		useJev();
		await planAsk(ask("anything about pricing"), senders, testJev());
		const [{ questions }] = firstCall();
		expect(questions.sender!.criteria).toEqual({
			s0: "Maya Chen <maya.chen@northwind.example>",
			s1: "Priya Raman <priya@fieldwork.example>",
			s2: "Stripe <receipts@stripe.example>",
			none: "No specific contact is mentioned",
		});
	});

	test("sender pool is capped at 60", async () => {
		useJev();
		const many = Array.from({ length: 75 }, (_, i) => ({ name: `Person ${i}`, address: `p${i}@example.com` }));
		await planAsk(ask("anything about pricing"), many, testJev());
		const criteria = firstCall()[0].questions.sender!.criteria!;
		expect(Object.keys(criteria)).toHaveLength(61);
		expect(criteria.s59).toBe("Person 59 <p59@example.com>");
		expect(criteria.s60).toBeUndefined();
	});

	test("no senders → no sender question", async () => {
		useJev();
		await planAsk(ask("anything about pricing"), [], testJev());
		expect(firstCall()[0].questions.sender).toBeUndefined();
	});
});

describe("planAsk intent", () => {
	test("a valid Jev intent is used, with rounded confidence", async () => {
		useJev({ intent: { choice: "receipts", confidence: 0.876, probabilities: {} } });
		const plan = await planAsk(ask("anything about pricing"), senders, testJev());
		expect(plan.intent).toBe("receipts");
		expect(plan.intentConfidence).toBe(0.88);
		expect(plan.source).toBe("jev");
		expect(plan.keywords).toEqual(heuristicPlan("anything about pricing", senders).keywords);
	});

	test("missing confidence defaults to 0.5", async () => {
		useJev({ intent: { choice: "receipts" } });
		const plan = await planAsk(ask("anything about pricing"), senders, testJev());
		expect(plan.intentConfidence).toBe(0.5);
		expect(plan.alternatives).toEqual([]);
	});

	test("an unknown Jev intent falls back to the heuristic intent", async () => {
		useJev({ intent: { choice: "banana", confidence: 0.9 } });
		const plan = await planAsk(ask("Receipts from this month"), senders, testJev());
		expect(plan.intent).toBe("receipts");
		expect(plan.source).toBe("jev");
	});

	test("alternatives: top 3 by probability, excluding the chosen intent and other", async () => {
		useJev({
			intent: {
				choice: "find_topic",
				confidence: 0.4,
				probabilities: {
					find_topic: 0.4,
					other: 0.25,
					urgent: 0.12,
					security: 0.123,
					receipts: 0.1,
					meetings: 0.05,
				},
			},
		});
		const plan = await planAsk(ask("anything about pricing"), senders, testJev());
		expect(plan.alternatives).toEqual([
			{ intent: "security", p: 0.12 },
			{ intent: "urgent", p: 0.12 },
			{ intent: "receipts", p: 0.1 },
		]);
	});

	test("alternatives exclude the heuristic intent when Jev's choice was invalid", async () => {
		useJev({ intent: { choice: "nope", probabilities: { receipts: 0.6, urgent: 0.3 } } });
		const plan = await planAsk(ask("Receipts from this month"), senders, testJev());
		expect(plan.intent).toBe("receipts");
		expect(plan.alternatives).toEqual([{ intent: "urgent", p: 0.3 }]);
	});
});

describe("planAsk timeframe", () => {
	test("an explicit phrase in the question beats Jev", async () => {
		useJev({ timeframe: { choice: "this_month" } });
		expect((await planAsk(ask("what came in yesterday about pricing"), senders, testJev())).timeframe).toBe("yesterday");
	});

	test("explicit “ever” (any) still beats Jev", async () => {
		useJev({ intent: { choice: "receipts" }, timeframe: { choice: "this_month" } });
		expect((await planAsk(ask("all receipts ever"), senders, testJev())).timeframe).toBe("any");
	});

	test("Jev's range is used when the question names none", async () => {
		useJev({ timeframe: { choice: "last_30_days" } });
		expect((await planAsk(ask("anything about pricing"), senders, testJev())).timeframe).toBe("last_30_days");
	});

	test("Jev “any” → the intent's default range", async () => {
		useJev({ intent: { choice: "urgent" }, timeframe: { choice: "any" } });
		const plan = await planAsk(ask("anything pressing"), senders, testJev());
		expect(plan.timeframe).toBe(DEFAULT_TIMEFRAME.urgent);
		expect(plan.timeframe).toBe("last_7_days");
	});

	test("missing timeframe answer → the intent's default range", async () => {
		useJev({ intent: { choice: "unread_summary" }, timeframe: {} });
		expect((await planAsk(ask("catch-up please"), senders, testJev())).timeframe).toBe("today");
	});
});

describe("planAsk sender", () => {
	test("an exact-name heuristic match (≥0.95) wins over Jev", async () => {
		useJev({ intent: { choice: "from_person" }, sender: { choice: "s1", confidence: 0.99 } });
		const plan = await planAsk(ask("emails from Maya Chen"), senders, testJev());
		expect(plan.sender).toEqual(senders[0]!);
		expect(plan.senderConfidence).toBe(0.95);
	});

	test("Jev may override a weaker heuristic match when confident (≥0.5)", async () => {
		useJev({ intent: { choice: "from_person" }, sender: { choice: "s1", confidence: 0.5 } });
		const plan = await planAsk(ask("emails from Maya"), senders, testJev());
		expect(plan.sender).toEqual(senders[1]!);
		expect(plan.senderConfidence).toBe(0.5);
	});

	test("an unsure Jev sender (<0.5) keeps the heuristic match", async () => {
		useJev({ intent: { choice: "from_person" }, sender: { choice: "s1", confidence: 0.49 } });
		const plan = await planAsk(ask("emails from Maya"), senders, testJev());
		expect(plan.sender).toEqual(senders[0]!);
		expect(plan.senderConfidence).toBe(0.8);
	});

	test("Jev finds a contact the heuristic missed", async () => {
		useJev({ intent: { choice: "from_person" }, sender: { choice: "s2", confidence: 0.7 } });
		const plan = await planAsk(ask("what did the payments people send"), senders, testJev());
		expect(plan.sender).toEqual(senders[2]!);
		expect(plan.senderConfidence).toBe(0.7);
	});

	test("an out-of-range sender label is ignored", async () => {
		useJev({ sender: { choice: "s9", confidence: 0.9 } });
		const plan = await planAsk(ask("anything about pricing"), senders, testJev());
		expect(plan.sender).toBeUndefined();
	});

	test("the pool index maps into the capped pool", async () => {
		const many = Array.from({ length: 70 }, (_, i) => ({ name: `Person ${i}`, address: `p${i}@example.com` }));
		useJev({ sender: { choice: "s42", confidence: 0.8 } });
		const plan = await planAsk(ask("anything about pricing"), many, testJev());
		expect(plan.sender).toEqual(many[42]!);
	});

	test("“none” keeps a confident heuristic match", async () => {
		useJev({ sender: { choice: "none", confidence: 0.9 } });
		const plan = await planAsk(ask("pricing from Maya"), senders, testJev());
		expect(plan.sender).toEqual(senders[0]!);
	});

	test("a low-confidence (tied) heuristic match is dropped on the Jev path", async () => {
		const twins: PersonRef[] = [
			{ name: "Sam Okafor", address: "sam@okafor.example" },
			{ name: "Sam Lee", address: "slee@lee.example" },
		];
		// Heuristic: first-name tie → 0.8 × 0.6 = 0.48, kept by heuristicPlan itself…
		expect(heuristicPlan("emails from sam", twins).senderConfidence).toBeCloseTo(0.48);
		useJev({ intent: { choice: "from_person" }, sender: { choice: "none", confidence: 0.9 } });
		// …but Jev said none, and <0.5 is not enough to filter on.
		const plan = await planAsk(ask("emails from sam"), twins, testJev());
		expect(plan.sender).toBeUndefined();
		expect(plan.senderConfidence).toBeCloseTo(0.48);
	});
});

describe("planAsk scope + unreadOnly", () => {
	test("awaiting_others forces scope sent", async () => {
		useJev({ intent: { choice: "awaiting_others" }, scope: { choice: "inbox" } });
		expect((await planAsk(ask("anyone ghosting"), senders, testJev())).scope).toBe("sent");
	});

	test.each([
		["sent", "sent"],
		["all", "all"],
		["inbox", "inbox"],
		["weird", "inbox"],
		[undefined, "inbox"],
	] as const)("scope choice %p → %p", async (choice, scope) => {
		useJev({ scope: choice === undefined ? {} : { choice } });
		expect((await planAsk(ask("anything about pricing"), senders, testJev())).scope).toBe(scope);
	});

	test("unreadOnly when noul ≥ 0.6", async () => {
		useJev({ unreadOnly: { noul: 0.6 } });
		expect((await planAsk(ask("anything about pricing"), senders, testJev())).unreadOnly).toBe(true);
	});

	test("not unreadOnly when noul < 0.6", async () => {
		useJev({ unreadOnly: { noul: 0.59 } });
		expect((await planAsk(ask("anything about pricing"), senders, testJev())).unreadOnly).toBe(false);
	});

	test("the heuristic's unread cue survives a low noul", async () => {
		useJev({ unreadOnly: { noul: 0 } });
		expect((await planAsk(ask("unread pricing emails"), senders, testJev())).unreadOnly).toBe(true);
	});
});
