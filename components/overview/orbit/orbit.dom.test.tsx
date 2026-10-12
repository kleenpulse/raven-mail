import { setObservedWidth } from "@/test/dom";
import { beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { SenderStat } from "@/lib/insights/types";
import type { OrbitVocab } from "./vocab";

const { act, fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
const { Orbit } = await import("./orbit");
const { orbitFixtures } = await import("./fixtures");
const { MAIL_VOCAB } = await import("./vocab");

const NOW = Date.parse("2026-09-25T12:00:00.000Z");
const FX = orbitFixtures(NOW);

const TEST_VOCAB: OrbitVocab = {
	...MAIL_VOCAB,
	sun: "Suite",
	unit: ["test", "tests"],
	node: ["file", "files"],
	period: null,
	legend: { person: "Unit files", machine: "Route files", ring: "Ring: tests per run", hint: "Select a file to focus" },
	empty: { title: "No test files yet", body: "Run the suite to see files here." },
};

beforeEach(() => {
	setSystemTime(NOW);
});

/** Orbit renders a placeholder until its container has been measured. */
async function renderOrbit(props: Partial<React.ComponentProps<typeof Orbit>> = {}, width = 1024) {
	setObservedWidth(width);
	const utils = render(<Orbit senders={FX.senders} categories={FX.categories} {...props} />);
	await waitFor(() => {
		const measured = utils.container.querySelector("[data-orbit-row], ul[aria-label='Legend'], [data-orbit-sender]");
		if (!measured) throw new Error("not measured yet");
	});
	return utils;
}

const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-orbit-row]")];

describe("Orbit — mail vocabulary (default)", () => {
	test("readout counts emails, senders and categories", async () => {
		await renderOrbit();
		const readout = screen.getByText(/emails ·/);
		expect(readout.textContent).toContain(`${FX.senders.length} senders`);
		expect(readout.textContent).toMatch(/\d+ categories/);
	});

	test("legend names people and services; time-range toggle is offered", async () => {
		await renderOrbit();
		const legend = screen.getByRole("list", { name: "Legend" });
		expect(within(legend).getByText("People")).toBeTruthy();
		expect(within(legend).getByText("Services")).toBeTruthy();
		expect(within(legend).getByText("Unread")).toBeTruthy();
		expect(screen.getByRole("group", { name: "Time range" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Week 4, the most recent" })).toBeTruthy();
	});

	test("wide container defaults to the constellation (no list rows)", async () => {
		const { container } = await renderOrbit({}, 1024);
		expect(rows(container)).toHaveLength(0);
		expect(container.querySelectorAll("[data-orbit-sender]").length).toBeGreaterThan(0);
	});
});

describe("Orbit — custom vocabulary", () => {
	test("readout and legend speak the custom domain", async () => {
		await renderOrbit({ vocab: TEST_VOCAB });
		const readout = screen.getByText(/tests ·/);
		expect(readout.textContent).toContain(`${FX.senders.length} files`);
		expect(screen.queryByText(/emails ·/)).toBeNull();
		const legend = screen.getByRole("list", { name: "Legend" });
		expect(within(legend).getByText("Unit files")).toBeTruthy();
		expect(within(legend).getByText("Route files")).toBeTruthy();
		expect(within(legend).queryByText("People")).toBeNull();
	});

	test("period: null hides the time-range toggle but keeps the view toggle", async () => {
		await renderOrbit({ vocab: TEST_VOCAB });
		expect(screen.queryByRole("group", { name: "Time range" })).toBeNull();
		expect(screen.getByRole("group", { name: "View" })).toBeTruthy();
	});
});

describe("Orbit — empty", () => {
	/** Let the observer stubs report (their callbacks land on a microtask). */
	const settle = () => act(async () => {});

	test("no senders shows the vocabulary's empty state and no controls", async () => {
		render(<Orbit senders={[]} categories={[]} />);
		await settle();
		expect(screen.getByText(MAIL_VOCAB.empty.title)).toBeTruthy();
		expect(screen.queryByRole("group", { name: "View" })).toBeNull();
	});

	test("custom empty copy", async () => {
		render(<Orbit senders={[]} categories={[]} vocab={TEST_VOCAB} />);
		await settle();
		expect(screen.getByText("No test files yet")).toBeTruthy();
		expect(screen.queryByText(MAIL_VOCAB.empty.title)).toBeNull();
	});
});

describe("Orbit — narrow container", () => {
	test("below 640px the list is the default view", async () => {
		const { container } = await renderOrbit({}, 480);
		const list = rows(container);
		expect(list.length).toBe(8); // preview rows
		expect(list[0]!.getAttribute("data-orbit-row")).toBe(FX.senders[0]!.address);
		expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
		expect(container.querySelectorAll("[data-orbit-sender]")).toHaveLength(0);
	});

	test("switching the view toggle to List on a wide container shows rows", async () => {
		const { container } = await renderOrbit({}, 1024);
		fireEvent.click(screen.getByRole("button", { name: "List" }));
		await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
	});
});

describe("Orbit — drilldown, then View all (vocab.expand)", () => {
	const EXPAND_VOCAB: OrbitVocab = {
		...TEST_VOCAB,
		expand: {
			label: (s: SenderStat) => `View all for ${s.name}`,
			render: (s: SenderStat) => <p data-testid="custom-detail">Detail for {s.name}</p>,
		},
	};
	const name = () => FX.senders[0]!.name;
	const viewAll = () => screen.queryByRole("button", { name: `View all for ${name()}` });

	async function openFirstRow(vocab: OrbitVocab = EXPAND_VOCAB) {
		const utils = await renderOrbit({ vocab }, 480);
		fireEvent.click(rows(utils.container)[0]!);
		await waitFor(() => expect(screen.getByRole("button", { name: /Back to list/ })).toBeTruthy());
		return utils;
	}

	test("a row opens the drilldown first, with a View all button and no full view yet", async () => {
		const { container } = await openFirstRow();
		expect(rows(container)).toHaveLength(0);
		expect(viewAll()).toBeTruthy();
		expect(screen.queryByTestId("custom-detail")).toBeNull();
		expect(container.querySelectorAll("[data-orbit-card]").length).toBeGreaterThan(0);
	});

	test("without vocab.expand there is no View all button", async () => {
		await openFirstRow(TEST_VOCAB);
		expect(screen.queryByRole("button", { name: /^View all/ })).toBeNull();
	});

	test("View all swaps in the full view, once, with Back to the node", async () => {
		await openFirstRow();
		fireEvent.click(viewAll()!);
		await waitFor(() => expect(screen.getAllByTestId("custom-detail")).toHaveLength(1));
		expect(screen.getByTestId("custom-detail").textContent).toBe(`Detail for ${name()}`);
		expect(screen.getAllByRole("button", { name: `Back to ${name()}` })).toHaveLength(1);
		expect(screen.queryByRole("button", { name: /Back to list/ })).toBeNull();
	});

	test("Back from the full view returns to the drilldown", async () => {
		await openFirstRow();
		fireEvent.click(viewAll()!);
		fireEvent.click(await screen.findByRole("button", { name: `Back to ${name()}` }));
		await waitFor(() => expect(viewAll()).toBeTruthy());
		expect(screen.queryByTestId("custom-detail")).toBeNull();
	});

	test("Escape steps back one level at a time: full view → drilldown → list", async () => {
		const { container } = await openFirstRow();
		fireEvent.click(viewAll()!);
		await screen.findByTestId("custom-detail");
		fireEvent.keyDown(container.firstElementChild!, { key: "Escape" });
		await waitFor(() => expect(viewAll()).toBeTruthy());
		fireEvent.keyDown(container.firstElementChild!, { key: "Escape" });
		await waitFor(() => expect(rows(container).length).toBe(8));
	});

	test("focus returns to the row that opened the drilldown", async () => {
		const { container } = await openFirstRow();
		fireEvent.keyDown(container.firstElementChild!, { key: "Escape" });
		await waitFor(() => expect(document.activeElement?.getAttribute("data-orbit-row")).toBe(FX.senders[0]!.address));
	});
});
