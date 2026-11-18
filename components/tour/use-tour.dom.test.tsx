import { jsonResponse, setObservedWidth } from "@/test/dom";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BoardDoc } from "@/lib/overview-board/types";
import type { WidgetId } from "@/lib/overview-board/widgets";

const React = await import("react");
const { render, act } = await import("@testing-library/react");
const { cardIsOff, pollUntilVisibleWithTimeout } = await import("./use-tour");
const { TOUR_STEPS } = await import("./tour.config");
const { WIDGET_TOUR_TARGET, tourSelector } = await import("./anchors");
const { BoardGrid } = await import("@/components/overview/board-grid");
const { initBoardState, useBoardStore } = await import("@/lib/overview-board/state");
const { WIDGET_IDS } = await import("@/lib/overview-board/widgets");

// The tour against the real board: it reads the page, so the page is drawn.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const AT = "2026-11-18T10:00:00.000Z";
const without = (id: WidgetId): BoardDoc => ({
	widgets: { on: WIDGET_IDS.filter((other) => other !== id), known: [...WIDGET_IDS], updatedAt: AT },
});
const tiles = Object.fromEntries(WIDGET_IDS.map((id) => [id, <section key={id}>card {id}</section>])) as Record<WidgetId, React.ReactNode>;

const realFetch = globalThis.fetch;
globalThis.fetch = (async () => jsonResponse({ ok: true, data: null, db: false })) as unknown as typeof fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});

let run = 0;

beforeEach(() => {
	localStorage.clear();
	initBoardState(`tour-owner-${String(++run)}`);
});

afterEach(() => {
	localStorage.clear();
});

async function draw(doc: BoardDoc = {}) {
	useBoardStore.setState({ doc });
	setObservedWidth(1280);
	const view = render(<BoardGrid tiles={tiles} />);
	await act(async () => {
		await sleep(90);
	});
	return view;
}

describe("tour steps that point at an Overview card", () => {
	test("each one names its card, and the card carries that step's anchor", () => {
		const onCards = TOUR_STEPS.filter((step) => step.widget);
		expect(onCards.map((step) => step.id)).toEqual(["needs-reply", "orbit"]);
		for (const step of onCards) {
			const anchor = step.widget ? WIDGET_TOUR_TARGET[step.widget] : undefined;
			expect(anchor && tourSelector(anchor)).toBe(step.selector);
		}
	});

	test("a card on the board is not off, and a step with no card never is", async () => {
		await draw();
		expect(cardIsOff("orbit")).toBe(false);
		expect(cardIsOff(undefined)).toBe(false);
	});

	test("a card the user removed is off", async () => {
		await draw(without("orbit"));
		expect(cardIsOff("orbit")).toBe(true);
		expect(cardIsOff("needs-reply")).toBe(false);
	});

	test("every card is off an emptied board", async () => {
		await draw({ widgets: { on: [], known: [...WIDGET_IDS], updatedAt: AT } });
		expect(cardIsOff("needs-reply")).toBe(true);
	});

	test("nothing is off where there is no board, or before the saved board is drawn", async () => {
		expect(cardIsOff("orbit")).toBe(false);
		await draw(without("orbit"));
		await act(async () => {
			useBoardStore.setState({ ready: false });
		});
		expect(cardIsOff("orbit")).toBe(false);
	});

	test("the wait for a removed card ends at once instead of running out its 12 seconds", async () => {
		await draw(without("orbit"));
		const started = performance.now();
		const found = await pollUntilVisibleWithTimeout(tourSelector("orbit"), 12_000, () => cardIsOff("orbit"));
		expect(found === null).toBe(true);
		expect(performance.now() - started).toBeLessThan(500);
	});

	test("the wait ends as soon as the saved board is drawn and shows the card is gone", async () => {
		await draw(without("orbit"));
		await act(async () => {
			useBoardStore.setState({ ready: false });
		});
		const started = performance.now();
		const waiting = pollUntilVisibleWithTimeout(tourSelector("orbit"), 12_000, () => cardIsOff("orbit"));
		await act(async () => {
			await sleep(60);
			useBoardStore.setState({ ready: true });
			await sleep(60);
		});
		expect((await waiting) === null).toBe(true);
		expect(performance.now() - started).toBeLessThan(1500);
	});
});
