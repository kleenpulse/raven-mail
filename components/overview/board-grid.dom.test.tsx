import { jsonResponse, setObservedWidth } from "@/test/dom";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BoardDoc } from "@/lib/overview-board/types";
import type { WidgetId } from "@/lib/overview-board/widgets";

const React = await import("react");
const { render, screen, fireEvent, act } = await import("@testing-library/react");
const { BoardGrid } = await import("./board-grid");
const { Toaster } = await import("@/components/ui/sonner");
const { initBoardState, useBoardStore } = await import("@/lib/overview-board/state");
const { seedLayouts } = await import("@/lib/overview-board/layout");
const { boardStorageKey } = await import("@/lib/overview-board/sync");
const { WIDGET_IDS } = await import("@/lib/overview-board/widgets");
const { endTour, startTour } = await import("@/components/tour/store");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const AT = "2026-11-18T10:00:00.000Z";

const tiles = Object.fromEntries(WIDGET_IDS.map((id) => [id, <section key={id}>card {id}</section>])) as Record<WidgetId, React.ReactNode>;

// No account database here: the board lives on the device, which is all these tests are about.
// The sync itself is covered in lib/overview-board/state.dom.test.tsx.
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => jsonResponse({ ok: true, data: null, db: false })) as unknown as typeof fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});

let run = 0;
let owner = "";

beforeEach(() => {
	// A new mailbox each test: the store keeps one board per mailbox.
	owner = `owner-${String(++run)}`;
	localStorage.clear();
	initBoardState(owner);
});

afterEach(() => {
	endTour();
	localStorage.clear();
});

/** Draws the board at a desktop width and waits out the grid's width debounce. */
async function draw(doc?: BoardDoc) {
	if (doc) useBoardStore.setState({ doc });
	setObservedWidth(1280);
	const view = render(
		<>
			<BoardGrid tiles={tiles} />
			<Toaster />
		</>,
	);
	await act(async () => {
		await sleep(90);
	});
	return view;
}

const order = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-widget]")].map((el) => el.dataset.widget);
const tile = (container: HTMLElement, id: WidgetId) => container.querySelector<HTMLElement>(`[data-widget="${id}"]`);
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const saved = () => useBoardStore.getState().doc;

async function click(el: Element) {
	await act(async () => {
		fireEvent.click(el);
		await sleep(20);
	});
}

describe("BoardGrid", () => {
	test("draws every card of the default board, with nothing to edit until asked", async () => {
		const { container } = await draw();
		expect(order(container)).toHaveLength(WIDGET_IDS.length);
		expect(container.querySelectorAll("[data-board-grip]")).toHaveLength(0);
		expect(container.querySelectorAll("[data-tile-body][inert]")).toHaveLength(0);
		expect(container.querySelector("[data-board]")?.hasAttribute("data-editing")).toBe(false);
		expect(saved()).toEqual({});
	});

	test("crossing board widths saves nothing: the grid re-packing itself is not an edit", async () => {
		const { container } = await draw();
		for (const width of [700, 400, 900, 1280]) {
			await act(async () => {
				setObservedWidth(width);
				await sleep(90);
			});
			expect(order(container)).toHaveLength(WIDGET_IDS.length);
		}
		expect(saved()).toEqual({});
		expect(localStorage.getItem(boardStorageKey(owner))).toBe("{}");
	});

	test("there is nothing to edit until the saved board is in", async () => {
		const { container } = await draw();
		await act(async () => {
			useBoardStore.setState({ ready: false });
		});
		expect(screen.queryByRole("button", { name: "Edit board" }) === null).toBe(true);
		expect(order(container)).toHaveLength(0);
		await act(async () => {
			useBoardStore.setState({ ready: true });
		});
		expect(order(container)).toHaveLength(WIDGET_IDS.length);
	});

	test("the status line says where an edit went", async () => {
		const { container } = await draw();
		const status = () => container.querySelector('p[aria-live="polite"]')?.textContent;
		expect(status()).toBe("Your board");
		await click(button("Edit board"));
		expect(status()).toBe("Drag to move, corner to resize");
		await click(button("Remove Volume"));
		expect(status()).toBe("Saved on this device");
		await click(button("Done"));
		expect(status()).toBe("Your board");
	});

	test("the tour anchors sit on the card, where the spotlight finds one child", async () => {
		const { container } = await draw();
		const anchor = container.querySelector('[data-tour="needs-reply"]');
		expect(anchor?.closest("[data-widget]")?.getAttribute("data-widget")).toBe("needs-reply");
		expect(anchor?.children).toHaveLength(1);
		expect(container.querySelector('[data-tour="orbit"]')?.closest("[data-widget]")?.getAttribute("data-widget")).toBe("orbit");
	});

	test("Edit board makes the cards inert and gives each a grip and a remove button; Done takes them away", async () => {
		const { container } = await draw();
		await click(button("Edit board"));
		expect(container.querySelector("[data-board]")?.hasAttribute("data-editing")).toBe(true);
		expect(container.querySelectorAll("[data-tile-body][inert]")).toHaveLength(WIDGET_IDS.length);
		expect(container.querySelectorAll("[data-board-grip]")).toHaveLength(WIDGET_IDS.length);
		expect(button("Done").getAttribute("aria-pressed")).toBe("true");
		// Looking is not editing: nothing is saved by entering the mode.
		expect(saved()).toEqual({});

		await click(button("Done"));
		expect(container.querySelectorAll("[data-board-grip]")).toHaveLength(0);
		expect(container.querySelectorAll("[data-tile-body][inert]")).toHaveLength(0);
	});

	test("arrow keys on a grip move the card, Shift+arrows resize it, and only that width is saved", async () => {
		const { container } = await draw();
		await click(button("Edit board"));
		const grip = tile(container, "orbit")?.querySelector<HTMLElement>("[data-board-grip]");
		expect(grip?.getAttribute("aria-label")).toContain("Move Your orbit");

		await act(async () => {
			fireEvent.keyDown(grip as HTMLElement, { key: "ArrowRight" });
		});
		const moved = saved().lg?.items?.find((i) => i.i === "orbit");
		const before = seedLayouts().lg.find((i) => i.i === "orbit");
		expect(moved?.x).toBe((before?.x ?? 0) + 1);
		expect(Object.keys(saved())).toEqual(["lg"]);

		await act(async () => {
			fireEvent.keyDown(grip as HTMLElement, { key: "ArrowDown", shiftKey: true });
		});
		expect(saved().lg?.items?.find((i) => i.i === "orbit")?.h).toBe((before?.h ?? 0) + 1);
		expect(container.querySelector('p[aria-live="assertive"]')?.textContent).toContain("Your orbit: column");
	});

	test("a card at the edge says so and saves nothing", async () => {
		const { container } = await draw();
		await click(button("Edit board"));
		const grip = tile(container, "needs-reply")?.querySelector<HTMLElement>("[data-board-grip]");
		await act(async () => {
			fireEvent.keyDown(grip as HTMLElement, { key: "ArrowLeft" });
		});
		expect(container.querySelector('p[aria-live="assertive"]')?.textContent).toBe("Needs reply can't move left.");
		expect(saved()).toEqual({});
	});

	test("removing a card saves only which cards are on, and Add card puts it back", async () => {
		const { container } = await draw();
		await click(button("Edit board"));
		await click(button("Remove Reply-zero streak"));
		expect(tile(container, "streak") === null).toBe(true);
		expect(Object.keys(saved())).toEqual(["widgets"]);
		expect(saved().widgets?.on).not.toContain("streak");
		// The removed card's button is gone: focus lands on the toolbar, not on <body>.
		await act(async () => {
			await sleep(40);
		});
		expect(document.activeElement?.textContent).toContain("Add card");

		await click(button("Add card"));
		await click(screen.getByRole("menuitem", { name: /Reply-zero streak/ }));
		expect(tile(container, "streak") !== null).toBe(true);
		expect(saved().widgets?.on).toContain("streak");
	});

	test("Reset puts the default board back, and Undo returns what was there", async () => {
		const custom: BoardDoc = { widgets: { on: ["volume", "orbit"], known: [...WIDGET_IDS], updatedAt: AT } };
		const { container } = await draw(custom);
		expect(order(container)).toHaveLength(2);
		await click(button("Edit board"));

		await click(button("Reset"));
		expect(order(container)).toHaveLength(WIDGET_IDS.length);
		expect(saved().widgets?.on).toBeNull();
		expect((button("Reset") as HTMLButtonElement).disabled).toBe(true);

		await click(button("Undo"));
		expect(order(container).sort()).toEqual(["orbit", "volume"]);
	});

	test("an emptied board offers a way back, and a card added to it is drawn", async () => {
		// The grid's width is only measured on a container that exists at mount, so the container must be there even now.
		const { container } = await draw({ widgets: { on: [], known: [...WIDGET_IDS], updatedAt: AT } });
		expect(screen.getByText("Your board is empty") !== null).toBe(true);
		expect(screen.queryByRole("button", { name: "Edit board" }) === null).toBe(true);

		await click(button("Add a card"));
		await click(screen.getByRole("menuitem", { name: /Volume/ }));
		expect(order(container)).toEqual(["volume"]);
		expect(Number.parseFloat(tile(container, "volume")?.style.width ?? "0")).toBeGreaterThan(100);
	});

	test("outside edit mode the cards are in reading order, so Tab follows the layout the user made", async () => {
		const lg = seedLayouts().lg.map((item) => (item.i === "reply-debt" ? { ...item, x: 0, y: 0 } : { ...item, y: item.y + 20 }));
		const { container } = await draw({ lg: { items: lg, updatedAt: AT } });
		expect(order(container)[0]).toBe("reply-debt");

		// While editing the order is frozen: moving the focused grip in the DOM would drop focus.
		await click(button("Edit board"));
		const grip = tile(container, "reply-debt")?.querySelector<HTMLElement>("[data-board-grip]");
		const frozen = order(container);
		await act(async () => {
			fireEvent.keyDown(grip as HTMLElement, { key: "ArrowDown" });
		});
		expect(order(container)).toEqual(frozen);

		await click(button("Done"));
		expect(order(container)[0]).not.toBe("reply-debt");
	});

	test("starting the tour ends edit mode", async () => {
		const { container } = await draw();
		await click(button("Edit board"));
		expect(container.querySelectorAll("[data-board-grip]")).toHaveLength(WIDGET_IDS.length);
		await act(async () => {
			startTour(0);
		});
		expect(container.querySelectorAll("[data-board-grip]")).toHaveLength(0);
		expect(container.querySelectorAll("[data-tile-body][inert]")).toHaveLength(0);
	});

	test("each mailbox on this browser keeps its own board", async () => {
		await draw();
		await click(button("Edit board"));
		await click(button("Remove Volume"));
		const mine = localStorage.getItem(boardStorageKey(owner));
		expect(mine).toContain('"widgets"');

		await act(async () => {
			initBoardState("another-mailbox");
		});
		expect(saved()).toEqual({});
		expect(localStorage.getItem(boardStorageKey(owner))).toBe(mine);
	});

	test("a board saved in another tab is adopted, part by part", async () => {
		const { container } = await draw();
		const theirs: BoardDoc = { widgets: { on: ["orbit"], known: [...WIDGET_IDS], updatedAt: AT } };
		await act(async () => {
			window.dispatchEvent(new StorageEvent("storage", { key: boardStorageKey(owner), newValue: JSON.stringify(theirs) }));
		});
		expect(order(container)).toEqual(["orbit"]);
	});
});
