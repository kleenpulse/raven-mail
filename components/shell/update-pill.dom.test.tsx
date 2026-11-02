import "@/test/dom";
import { afterEach, describe, expect, test } from "bun:test";
import type { DesktopUpdateState, RavenDesktop } from "@/lib/desktop/bridge";

const React = await import("react");
const { render, cleanup, act, screen, fireEvent } = await import("@testing-library/react");
const { UpdatePill } = await import("./update-pill");

afterEach(() => {
	cleanup();
	delete window.ravenDesktop;
});

/** A desktop bridge whose update state the test drives. */
function fakeDesktop(initial: DesktopUpdateState) {
	const listeners = new Set<(state: DesktopUpdateState) => void>();
	const actions: string[] = [];
	window.ravenDesktop = {
		update: {
			state: async () => initial,
			onState: (callback) => {
				listeners.add(callback);
				return () => listeners.delete(callback);
			},
			act: (action) => actions.push(action),
		},
	} as Partial<RavenDesktop> as RavenDesktop;
	return {
		actions,
		listeners,
		push: (state: DesktopUpdateState) => act(() => listeners.forEach((l) => l(state))),
	};
}

const settle = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

describe("UpdatePill", () => {
	test("renders nothing on the web", async () => {
		const { container } = render(<UpdatePill />);
		await settle();
		expect(container.innerHTML).toBe("");
	});

	test("renders nothing with no update", async () => {
		fakeDesktop({ kind: "none" });
		const { container } = render(<UpdatePill />);
		await settle();
		expect(container.innerHTML).toBe("");
	});

	test("shows download progress, then Restart to update, which asks main to restart", async () => {
		const desktop = fakeDesktop({ kind: "none" });
		render(<UpdatePill />);
		await settle();
		await desktop.push({ kind: "downloading", version: "0.11.0", percent: 42 });
		const bar = screen.getByRole("progressbar", { name: "Downloading Raven 0.11.0" });
		expect(bar.getAttribute("aria-valuenow")).toBe("42");
		expect(screen.getByText("Updating 42%")).toBeTruthy();

		await desktop.push({ kind: "ready", version: "0.11.0" });
		expect(screen.queryByRole("progressbar")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Restart to update to Raven 0.11.0" }));
		expect(desktop.actions).toEqual(["restart"]);
	});

	test("picks up a state main had before the page loaded", async () => {
		fakeDesktop({ kind: "ready", version: "0.11.0" });
		render(<UpdatePill />);
		await settle();
		expect(screen.getByRole("button", { name: "Restart to update to Raven 0.11.0" })).toBeTruthy();
	});

	test("a push beats the slower first answer", async () => {
		const desktop = fakeDesktop({ kind: "downloading", version: "0.11.0", percent: 10 });
		render(<UpdatePill />);
		await desktop.push({ kind: "ready", version: "0.11.0" });
		await settle();
		expect(screen.getByRole("button", { name: "Restart to update to Raven 0.11.0" })).toBeTruthy();
	});

	test("a build that can't install updates links to the release page", async () => {
		const desktop = fakeDesktop({ kind: "available", version: "0.11.0" });
		render(<UpdatePill />);
		await settle();
		fireEvent.click(screen.getByRole("button", { name: "Raven 0.11.0 is out. Open the download page" }));
		expect(desktop.actions).toEqual(["open-release"]);
	});

	test("unsubscribes when it unmounts", async () => {
		const desktop = fakeDesktop({ kind: "none" });
		const { unmount } = render(<UpdatePill />);
		await settle();
		expect(desktop.listeners.size).toBe(1);
		unmount();
		expect(desktop.listeners.size).toBe(0);
	});
});
