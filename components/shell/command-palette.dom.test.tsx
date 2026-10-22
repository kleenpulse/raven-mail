import { router } from "@/test/dom";
import { afterEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";

const asked: string[] = [];
let askName: "Jev" | "Kage" = "Jev";
const useMailPath = path.resolve(import.meta.dir, "../../hooks/use-mail.ts");
const realUseMail = await import(useMailPath);
mock.module(useMailPath, () => ({
	...realUseMail,
	useFolders: () => ({
		data: [
			{ path: "INBOX", name: "INBOX", specialUse: "\\Inbox", delimiter: "/", total: 1, unread: 0 },
			{ path: "Projects", name: "Projects", delimiter: "/", total: 1, unread: 0 },
		],
	}),
}));
mock.module(path.resolve(import.meta.dir, "../jev/use-ask.ts"), () => ({
	useAsk: () => async (q: string) => {
		asked.push(q);
	},
}));
mock.module(path.resolve(import.meta.dir, "../jev/ask-name.ts"), () => ({ useAskName: () => askName }));
mock.module("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: () => {} }) }));

const { render, screen, fireEvent, cleanup, waitFor, act } = await import("@testing-library/react");
const { CommandPalette } = await import("./command-palette");
const { usePaletteStore, registerMessageCommands } = await import("./palette-store");
const { useComposeStore } = await import("@/lib/store/compose");

afterEach(() => {
	cleanup();
	asked.length = 0;
	askName = "Jev";
	router.push.mockClear();
	usePaletteStore.setState({ open: false, message: null });
	useComposeStore.getState().closeCompose();
});

function openPalette() {
	usePaletteStore.setState({ open: true });
	render(<CommandPalette />);
	return screen.getByRole("combobox") as HTMLInputElement;
}

const options = () => screen.getAllByRole("option").map((o) => o.textContent ?? "");
const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });

describe("CommandPalette", () => {
	test("empty: Ask Jev is the top row, then compose, folders and settings", () => {
		openPalette();
		const rows = options();
		expect(rows[0]).toBe("Ask Jev");
		expect(rows).toContain("Compose" + "C");
		expect(rows).toContain("Projects");
		expect(rows).toContain("Mail settings");
	});

	test("without a Jev key the palette asks Kage", () => {
		askName = "Kage";
		const input = openPalette();
		expect(options()[0]).toBe("Ask Kage");
		expect(input.placeholder).toBe("Search, jump or ask Kage…");
	});

	test("Ask and Search rows stay whatever is typed", () => {
		const input = openPalette();
		type(input, "zzzz");
		expect(options()).toEqual(['Search mail for "zzzz"/', 'Ask Jev: "zzzz"']);
	});

	test("a question puts Ask Jev first, and Enter closes the palette, then asks", async () => {
		const input = openPalette();
		type(input, "who is waiting on me");
		expect(options()[0]).toBe('Ask Jev: "who is waiting on me"');
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(asked).toEqual(["who is waiting on me"]));
		expect(usePaletteStore.getState().open).toBe(false);
	});

	test("Compose opens compose after the palette closes", async () => {
		const input = openPalette();
		type(input, "compose");
		fireEvent.click(screen.getByRole("option", { name: /^Compose/ }));
		await waitFor(() => expect(useComposeStore.getState().open).toBe(true));
		expect(usePaletteStore.getState().open).toBe(false);
	});

	test("a folder row goes to that folder", async () => {
		const input = openPalette();
		type(input, "proj");
		fireEvent.click(screen.getByRole("option", { name: "Projects" }));
		await waitFor(() => expect(router.push).toHaveBeenCalledWith("/mail?folder=Projects"));
	});

	test("the open message's actions show while registered, and go when it unmounts", async () => {
		const run = mock<(action: string) => void>(() => {});
		let unregister = () => {};
		act(() => {
			unregister = registerMessageCommands({ canArchive: true, inTrash: false, flagged: false, canReplyAll: false, run });
		});
		const input = openPalette();
		type(input, "archive");
		fireEvent.click(screen.getByRole("option", { name: /^Archive/ }));
		await waitFor(() => expect(run).toHaveBeenCalledWith("archive"));

		act(() => unregister());
		act(() => usePaletteStore.setState({ open: true }));
		const again = screen.getByRole("combobox") as HTMLInputElement;
		expect(again.value).toBe(""); // reopened through the store: no stale text
		type(again, "archive");
		expect(screen.queryByRole("option", { name: /^ArchiveE$/ })).toBeNull();
		expect(options()).toContain('Search mail for "archive"/');
	});
});
