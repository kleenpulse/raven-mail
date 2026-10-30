import { jsonResponse } from "@/test/dom";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MailMessage } from "@/lib/mail/types";

mock.module("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

const React = await import("react");
const { renderHook, act } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { AccountProvider } = await import("@/components/providers/account-provider");
const { useComposeStore } = await import("@/lib/store/compose");
const { useResumeDraft } = await import("./use-resume-draft");

const account = { email: "me@home.example", displayName: "Me", provider: "custom", jev: { source: null, hint: null } } as never;
const realFetch = globalThis.fetch;
const fetched: string[] = [];
/** Message fetches held back until released, to stage a slow draft. */
const held = new Map<string, () => void>();

function draft(uid: string): MailMessage {
	return {
		uid,
		folder: "Drafts",
		subject: `Draft ${uid}`,
		from: { address: "me@home.example" },
		to: [],
		cc: [],
		bcc: [],
		date: "2026-10-25T12:00:00.000Z",
		flags: { seen: true, flagged: false, answered: false, draft: true },
		text: `Body ${uid}`,
		html: "",
		attachments: [{ filename: "a.txt", contentType: "text/plain", size: 2, part: "2" }],
		headers: {},
	} as MailMessage;
}

function stub({ hold = [] as string[] } = {}) {
	globalThis.fetch = (async (input: string) => {
		const url = new URL(input, "http://x");
		const uid = url.searchParams.get("uid")!;
		fetched.push(`${url.pathname}:${uid}`);
		if (url.pathname === "/api/mail/attachment") return new Response("hi");
		if (hold.includes(uid)) await new Promise<void>((resolve) => held.set(uid, resolve));
		return jsonResponse({ ok: true, data: draft(uid) });
	}) as typeof fetch;
}

function setup() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { result } = renderHook(() => useResumeDraft(), {
		wrapper: ({ children }) => (
			<QueryClientProvider client={client}>
				<AccountProvider account={account}>{children}</AccountProvider>
			</QueryClientProvider>
		),
	});
	return (uid: string) => act(() => result.current("Drafts", uid));
}

const compose = () => useComposeStore.getState();
const count = (path: string) => fetched.filter((f) => f.startsWith(path)).length;

afterEach(() => {
	globalThis.fetch = realFetch;
	fetched.length = 0;
	// Release anything still held so a stalled fetch can't leak into the next test.
	for (const release of held.values()) release();
	held.clear();
	compose().closeCompose();
});

describe("useResumeDraft", () => {
	test("opening the draft already in compose keeps its edits and doesn't refetch", async () => {
		stub();
		const resume = setup();
		await resume("7");
		compose().setDraft({ subject: "Edited" });
		const session = compose().session;

		await resume("7");

		expect(compose().session).toBe(session);
		expect(compose().draft.subject).toBe("Edited");
		expect(compose().attachments).toHaveLength(1);
		expect(count("/api/mail/attachment")).toBe(1);
	});

	test("a minimized draft comes back up instead of reloading", async () => {
		stub();
		const resume = setup();
		await resume("7");
		compose().minimize();
		const session = compose().session;

		await resume("7");

		expect(compose().minimized).toBe(false);
		expect(compose().session).toBe(session);
		expect(count("/api/mail/attachment")).toBe(1);
	});

	test("a second click while the draft is loading is ignored", async () => {
		stub({ hold: ["7"] });
		const resume = setup();
		const first = resume("7");
		const second = resume("7");
		held.get("7")?.();
		await Promise.all([first, second]);

		expect(compose().draftRow).toBe("7");
		expect(count("/api/mail/attachment")).toBe(1);
	});

	test("the last draft clicked wins when an earlier one is slow", async () => {
		stub({ hold: ["7"] });
		const resume = setup();
		const slow = resume("7");
		await resume("8");
		held.get("7")?.();
		await slow;

		expect(compose().draftRow).toBe("8");
		expect(compose().draft.subject).toBe("Draft 8");
	});

	test("with unsaved changes it asks first, and fetches the files only once agreed", async () => {
		stub();
		const resume = setup();
		await resume("7");
		compose().setDraft({ subject: "Edited" });

		await resume("8");
		expect(compose().draft.subject).toBe("Edited");
		expect(compose().pendingOpen?.options.draftUid).toBe("8");
		expect(fetched).not.toContain("/api/mail/attachment:8");

		await act(async () => {
			compose().answerPending(true);
			await new Promise((r) => setTimeout(r, 0));
		});
		expect(compose().draftRow).toBe("8");
		expect(fetched).toContain("/api/mail/attachment:8");
	});

	test("a different draft still replaces the open one", async () => {
		stub();
		const resume = setup();
		await resume("7");
		await resume("8");

		expect(compose().draftRow).toBe("8");
		expect(compose().draft.subject).toBe("Draft 8");
	});
});
