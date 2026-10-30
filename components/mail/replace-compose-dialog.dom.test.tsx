import { jsonResponse } from "@/test/dom";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

const saves: { subject: string; draftUid?: string }[] = [];
let saveResult: { ok: true; data: { uid?: string } } | { ok: false; error: string } = { ok: true, data: { uid: "21" } };
const realActions = { ...(await import("@/lib/actions/mail")) };
mock.module("@/lib/actions/mail", () => ({
	...realActions,
	saveDraftAction: async (input: { draft: { subject: string }; draftUid?: string }) => {
		saves.push({ subject: input.draft.subject, draftUid: input.draftUid });
		return saveResult;
	},
}));

// happy-dom rejects a native animation motion cancels mid-way; the grow itself isn't under test.
const { MotionGlobalConfig } = await import("motion/react");
MotionGlobalConfig.skipAnimations = true;

const React = await import("react");
const { render, screen, fireEvent, cleanup, act } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { AccountProvider } = await import("@/components/providers/account-provider");
const { useComposeStore } = await import("@/lib/store/compose");
const { ReplaceComposeDialog } = await import("./replace-compose-dialog");

const account = { email: "me@home.example", displayName: "Me", provider: "custom", jev: { source: null, hint: null } } as never;
const realFetch = globalThis.fetch;
const compose = () => useComposeStore.getState();

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<AccountProvider account={account}>
				<ReplaceComposeDialog />
			</AccountProvider>
		</QueryClientProvider>,
	);
}

/** Writing "Mine" (unsaved), then a click on draft 8. */
function clickAnotherDraft() {
	compose().openCompose("new");
	compose().setDraft({ subject: "Mine" });
	act(() => {
		compose().openCompose("new", { subject: "Draft 8" }, { draftUid: "8", signature: false });
	});
}

beforeEach(() => {
	saves.length = 0;
	saveResult = { ok: true, data: { uid: "21" } };
	globalThis.fetch = (async () => jsonResponse({ ok: true, data: [] })) as unknown as typeof fetch;
});

afterEach(() => {
	cleanup();
	globalThis.fetch = realFetch;
	compose().closeCompose();
});

describe("ReplaceComposeDialog", () => {
	test("says what's at stake, and stays closed with nothing to ask", () => {
		mount();
		expect(screen.queryByRole("alertdialog")).toBeNull();
		clickAnotherDraft();
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect(screen.getByText(/aren't saved\. Opening this draft will replace it\./)).toBeTruthy();
	});

	test("Keep editing leaves the message as it is", () => {
		mount();
		clickAnotherDraft();
		fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
		expect(compose().draft.subject).toBe("Mine");
		expect(compose().pendingOpen).toBeNull();
		expect(saves).toHaveLength(0);
	});

	test("Don't save opens the draft without saving", () => {
		mount();
		clickAnotherDraft();
		fireEvent.click(screen.getByRole("button", { name: "Don't save" }));
		expect(compose().draft.subject).toBe("Draft 8");
		expect(compose().draftRow).toBe("8");
		expect(saves).toHaveLength(0);
	});

	test("Save and open saves to Drafts first, then opens", async () => {
		mount();
		clickAnotherDraft();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Save and open" }));
		});
		expect(saves).toEqual([{ subject: "Mine", draftUid: undefined }]);
		expect(compose().draft.subject).toBe("Draft 8");
	});

	test("a failed save keeps the message and the question open", async () => {
		saveResult = { ok: false, error: "IMAP is down" };
		mount();
		clickAnotherDraft();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Save and open" }));
		});
		expect(compose().draft.subject).toBe("Mine");
		expect(compose().pendingOpen).not.toBeNull();
	});

	test("Save waits while the draft's files are still loading", () => {
		mount();
		compose().openCompose("new", { subject: "Mine" }, { draftUid: "7", attachmentsLoading: true, signature: false });
		compose().setDraft({ subject: "Mine, edited" });
		act(() => {
			compose().openCompose("new");
		});
		expect((screen.getByRole("button", { name: "Save and open" }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByRole("status").textContent).toContain("still loading");
	});
});
