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

// A saved draft as the server hands it back: the inline image is a data: URL in the HTML, and isn't listed.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
const account = { email: "me@home.example", displayName: "Me", provider: "custom", jev: { source: null, hint: null } } as never;
const realFetch = globalThis.fetch;
const compose = () => useComposeStore.getState();

function saved(attachments: MailMessage["attachments"]): MailMessage {
	return {
		uid: "9",
		folder: "Drafts",
		subject: "With a picture",
		from: { address: "me@home.example" },
		to: [],
		cc: [],
		bcc: [],
		date: "2026-11-18T12:00:00.000Z",
		flags: { seen: true, flagged: false, answered: false, draft: true },
		text: "Look: [image: shot.png]",
		html: `<p>Look: <img src="data:image/png;base64,${PNG}" alt="shot.png" width="560" style="max-width:100%;height:auto" /></p>`,
		attachments,
		headers: {},
	} as MailMessage;
}

function resume(message: MailMessage) {
	globalThis.fetch = (async (input: string) =>
		new URL(input, "http://x").pathname === "/api/mail/attachment" ? new Response("hi") : jsonResponse({ ok: true, data: message })) as typeof fetch;
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { result } = renderHook(() => useResumeDraft(), {
		wrapper: ({ children }) => (
			<QueryClientProvider client={client}>
				<AccountProvider account={account}>{children}</AccountProvider>
			</QueryClientProvider>
		),
	});
	return act(() => result.current("Drafts", "9"));
}

afterEach(() => {
	globalThis.fetch = realFetch;
	compose().closeCompose();
	localStorage.clear();
});

describe("reopening a draft that has an image in its body", () => {
	test("the image comes back as an inline file, and compose never holds the data: URL", async () => {
		await resume(saved([]));

		const { draft, attachments, draftUid, attachmentsLoading, edits } = compose();
		expect(attachments).toHaveLength(1);
		const [image] = attachments;
		expect(image).toMatchObject({ filename: "shot.png", contentType: "image/png", contentBase64: PNG, size: 7, width: 560 });
		expect(draft.html).toBe(`<p>Look: <img src="cid:${image!.cid}" alt="shot.png" width="560"></p>`);
		expect(draft.html).not.toContain("data:");
		// Still the same saved draft, with nothing to save yet.
		expect([draftUid, attachmentsLoading, edits]).toEqual(["9", false, 0]);
		// What's kept on this device has no image bytes in it.
		expect(localStorage.getItem("em-compose") ?? "").not.toContain(PNG);
	});

	test("its listed files still load beside the inline image", async () => {
		await resume(saved([{ filename: "a.txt", contentType: "text/plain", size: 2, part: "2" }]));

		expect(compose().attachments.map((a) => [a.filename, Boolean(a.cid)])).toEqual([
			["shot.png", true],
			["a.txt", false],
		]);
		expect(compose().attachmentsLoading).toBe(false);
		expect(compose().draftUid).toBe("9");
	});
});
