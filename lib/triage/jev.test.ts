import { describe, expect, mock, test } from "bun:test";
import { answers, fakeJev } from "@/test/helpers/jev";
import { jevTriage } from "@/lib/triage/jev";
import { heuristicTriage } from "@/lib/triage/heuristic";

const input = {
	subject: "Can you review the contract today?",
	from: "maya@northwind.example",
	snippet: "Need your sign-off",
	body: "Please take a look.",
};

type Loose = Record<string, unknown>;

function respond(over: Record<string, Loose> = {}) {
	fakeJev.enabled = true;
	fakeJev.systemOne = mock(async () =>
		answers({
			category: { choice: "primary", confidence: 0.83 },
			urgency: { score: 2, confidence: 0.6 },
			needsReply: { noul: 0.9 },
			...over,
		}),
	);
}

type Call = { state: Record<string, string>; questions: Record<string, { type: string; criteria: unknown }> };
const firstCall = () => fakeJev.systemOne.mock.calls[0] as unknown as [Call, { signal?: AbortSignal }];

describe("jevTriage", () => {
	test("disabled → heuristic result, no Jev call", async () => {
		expect(await jevTriage(input)).toEqual(heuristicTriage(input));
		expect(fakeJev.systemOne).not.toHaveBeenCalled();
	});

	test("maps category, urgency score/3, needsReply, confidence", async () => {
		respond();
		expect(await jevTriage(input)).toEqual({
			category: "primary",
			urgency: 2 / 3,
			needsReply: true,
			confidence: 0.83,
			source: "jev",
		});
	});

	test("email text goes in state only, truncated; signal forwarded", async () => {
		respond();
		const controller = new AbortController();
		await jevTriage(
			{ subject: "Hi", snippet: "s".repeat(1500), body: "b".repeat(2500) },
			{ signal: controller.signal },
		);
		const [call, opts] = firstCall();
		expect(opts.signal).toBe(controller.signal);
		expect(call.state).toEqual({ subject: "Hi", from: "", snippet: "s".repeat(1200), body: "b".repeat(2000) });
		expect(Object.keys(call.questions)).toEqual(["category", "urgency", "needsReply"]);
		expect(call.questions.category!.type).toBe("choice");
		expect(Object.keys(call.questions.category!.criteria as object)).toEqual([
			"primary",
			"updates",
			"receipts",
			"promotions",
			"newsletters",
			"social",
			"other",
		]);
		expect(call.questions.urgency!.type).toBe("score");
		expect(call.questions.urgency!.criteria).toHaveLength(4);
		expect(call.questions.needsReply!.type).toBe("noul");
		expect(JSON.stringify(call.questions)).not.toContain("Hi");
	});

	test.each([
		[0, 0],
		[3, 1],
		[5, 1],
		[-1, 0],
	])("urgency score %p → %p (clamped)", async (score, urgency) => {
		respond({ urgency: { score } });
		expect((await jevTriage(input)).urgency).toBe(urgency);
	});

	test("needsReply threshold is noul ≥ 0.6", async () => {
		respond({ needsReply: { noul: 0.6 } });
		expect((await jevTriage(input)).needsReply).toBe(true);
		respond({ needsReply: { noul: 0.59 } });
		expect((await jevTriage(input)).needsReply).toBe(false);
	});

	test("confidence falls back to urgency confidence, then 0.7", async () => {
		respond({ category: { choice: "receipts" }, urgency: { score: 1, confidence: 0.42 } });
		expect((await jevTriage(input)).confidence).toBe(0.42);
		respond({ category: { choice: "receipts" }, urgency: { score: 1 } });
		const result = await jevTriage(input);
		expect(result.confidence).toBe(0.7);
		expect(result.category).toBe("receipts");
	});

	test("systemOne throws → heuristic result", async () => {
		fakeJev.enabled = true;
		fakeJev.systemOne = mock(async () => {
			throw new Error("rate limited");
		});
		expect(await jevTriage(input)).toEqual(heuristicTriage(input));
	});

	test("a malformed response → heuristic result", async () => {
		fakeJev.enabled = true;
		fakeJev.systemOne = mock(async () => answers({ category: { choice: "primary" } }));
		const result = await jevTriage(input);
		expect(result).toEqual(heuristicTriage(input));
		expect(result.source).toBe("heuristic");
	});
});
