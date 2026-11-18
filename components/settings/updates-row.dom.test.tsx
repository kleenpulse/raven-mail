import "@/test/dom";
import { afterEach, describe, expect, test } from "bun:test";
import type { DesktopUpdateCheck, DesktopUpdateState, RavenDesktop } from "@/lib/desktop/bridge";

const { render, cleanup, act, screen, fireEvent } = await import("@testing-library/react");
const { UpdatesRow } = await import("./updates-row");

afterEach(() => {
	cleanup();
	delete window.ravenDesktop;
});

/** A desktop bridge whose update state and check answer the test drives. */
function fakeDesktop(initial: DesktopUpdateState, check?: () => Promise<DesktopUpdateCheck>) {
	const listeners = new Set<(state: DesktopUpdateState) => void>();
	const actions: string[] = [];
	window.ravenDesktop = {
		update: {
			state: async () => initial,
			onState: (callback) => {
				listeners.add(callback);
				return () => listeners.delete(callback);
			},
			...(check ? { check } : {}),
			act: (action) => actions.push(action),
		},
	} as Partial<RavenDesktop> as RavenDesktop;
	return {
		actions,
		push: (state: DesktopUpdateState) => act(() => listeners.forEach((l) => l(state))),
	};
}

const settle = () => act(async () => await new Promise((r) => setTimeout(r, 0)));
const status = () => screen.getByRole("status").textContent;

describe("UpdatesRow", () => {
	test("checks when asked, and says when Raven is already the newest", async () => {
		let answer!: (check: DesktopUpdateCheck) => void;
		fakeDesktop({ kind: "none" }, () => new Promise((resolve) => (answer = resolve)));
		render(<UpdatesRow />);
		await settle();
		expect(status()).toBe("");

		fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
		const checking = screen.getByRole("button", { name: "Checking…" });
		expect(checking.hasAttribute("disabled")).toBe(true);

		await act(async () => answer("current"));
		expect(status()).toBe("You have the newest version.");
		expect(screen.getByRole("button", { name: "Check for updates" }).hasAttribute("disabled")).toBe(false);
	});

	test("a found update shows its download, then offers the restart", async () => {
		const desktop = fakeDesktop({ kind: "none" }, async () => "found");
		render(<UpdatesRow />);
		await settle();
		fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
		await settle();
		expect(status()).toBe("");
		await desktop.push({ kind: "downloading", version: "0.15.0", percent: 42 });
		expect(status()).toBe("Downloading Raven 0.15.0: 42%");
		expect(screen.getByRole("button", { name: "Check for updates" }).hasAttribute("disabled")).toBe(true);

		await desktop.push({ kind: "ready", version: "0.15.0" });
		expect(status()).toBe("Raven 0.15.0 is ready.");
		fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
		expect(desktop.actions).toEqual(["restart"]);
	});

	test("a build that can't install updates links to the release page", async () => {
		const desktop = fakeDesktop({ kind: "available", version: "0.15.0" });
		render(<UpdatesRow />);
		await settle();
		expect(status()).toBe("Raven 0.15.0 is out.");
		fireEvent.click(screen.getByRole("button", { name: "Open the download page" }));
		expect(desktop.actions).toEqual(["open-release"]);
	});

	test("a check that fails says so and can be tried again", async () => {
		fakeDesktop({ kind: "none" }, async () => {
			throw new Error("not allowed");
		});
		render(<UpdatesRow />);
		await settle();
		fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
		await settle();
		expect(status()).toBe("Raven couldn't check for updates. Check your connection and try again.");
		expect(screen.getByRole("button", { name: "Check for updates" }).hasAttribute("disabled")).toBe(false);
	});

	test("a build that never checks, or one from before the button, says it doesn't update itself", async () => {
		fakeDesktop({ kind: "none" }, async () => "off");
		const first = render(<UpdatesRow />);
		await settle();
		fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
		await settle();
		expect(status()).toBe("This build doesn't update itself.");
		first.unmount();

		fakeDesktop({ kind: "none" });
		render(<UpdatesRow />);
		await settle();
		fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
		await settle();
		expect(status()).toBe("This build doesn't update itself.");
	});
});
