import { jsonResponse } from "@/test/dom";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MailMessage } from "@/lib/mail/types";

const toasts: { kind: string; title: string; description?: string; action?: { label: string } }[] = [];
mock.module("sonner", () => ({
	toast: {
		success: (title: string, o: { description?: string } = {}) => toasts.push({ kind: "success", title, ...o }),
		error: (title: string, o: { description?: string; action?: { label: string } } = {}) =>
			toasts.push({ kind: "error", title, ...o }),
	},
}));

const { render, screen, fireEvent, cleanup, waitFor } = await import("@testing-library/react");
const { UnsubscribeButton } = await import("./unsubscribe-button");
const { useComposeStore } = await import("@/lib/store/compose");
const { setPref, resetPrefs } = await import("@/lib/prefs/store");

const realFetch = globalThis.fetch;
const realOpen = window.open;
const posts: { url: string; body: unknown }[] = [];
const opened: string[] = [];

function stubFetch(answer: Response) {
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		posts.push({ url, body: JSON.parse(String(init?.body)) });
		return answer;
	}) as typeof fetch;
}

afterEach(() => {
	cleanup();
	toasts.length = 0;
	posts.length = 0;
	opened.length = 0;
	globalThis.fetch = realFetch;
	window.open = realOpen;
	useComposeStore.getState().closeCompose();
	resetPrefs();
});

function message(headers: Record<string, string>): MailMessage {
	return {
		uid: "42",
		folder: "INBOX",
		subject: "Issue 12",
		from: { name: "Weekly Reads", address: "news@reads.example" },
		to: [],
		cc: [],
		bcc: [],
		date: "2026-10-20T10:00:00Z",
		flags: { seen: true, flagged: false, answered: false, draft: false },
		text: "",
		html: "",
		attachments: [],
		headers,
	};
}

const LINKS = "<https://reads.example/u/abc>, <mailto:leave@reads.example?subject=stop>";

function confirmWith(label: string) {
	fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
	fireEvent.click(screen.getByRole("button", { name: label }));
}

describe("UnsubscribeButton", () => {
	test("nothing to show without List-Unsubscribe", () => {
		const { container } = render(<UnsubscribeButton message={message({})} />);
		expect(container.innerHTML).toBe("");
	});

	test("one-click: asks first, then posts this message and shows Unsubscribed", async () => {
		stubFetch(jsonResponse({ ok: true, data: null }));
		render(<UnsubscribeButton message={message({ "list-unsubscribe": LINKS, "list-unsubscribe-post": "List-Unsubscribe=One-Click" })} />);
		fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
		expect(screen.getByText("Unsubscribe from Weekly Reads?")).toBeTruthy();
		expect(screen.getByText("Raven asks reads.example to take you off this list.")).toBeTruthy();
		expect(posts).toHaveLength(0);
		const confirm = screen.getAllByRole("button", { name: "Unsubscribe" }).at(-1)!;
		fireEvent.click(confirm);
		await waitFor(() => expect(screen.getByText("Unsubscribed")).toBeTruthy());
		expect(posts).toEqual([{ url: "/api/mail/unsubscribe", body: { folder: "INBOX", uid: "42" } }]);
		expect(toasts[0]).toMatchObject({ kind: "success", title: "Unsubscribed from Weekly Reads" });
	});

	test("one-click failure offers the sender's page", async () => {
		stubFetch(jsonResponse({ ok: false, error: "Their server didn't confirm it.", code: "unsubscribe_failed" }, 502));
		render(<UnsubscribeButton message={message({ "list-unsubscribe": LINKS, "list-unsubscribe-post": "List-Unsubscribe=One-Click" })} />);
		fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
		fireEvent.click(screen.getAllByRole("button", { name: "Unsubscribe" }).at(-1)!);
		await waitFor(() => expect(toasts).toHaveLength(1));
		expect(toasts[0]).toMatchObject({
			kind: "error",
			title: "Couldn't unsubscribe",
			description: "Their server didn't confirm it.",
			action: { label: "Open their page" },
		});
		expect(screen.queryByText("Unsubscribed")).toBeNull();
	});

	test("https without one-click opens the page in a new tab, and posts nothing", () => {
		stubFetch(jsonResponse({ ok: true, data: null }));
		window.open = ((url: string) => {
			opened.push(url);
			return null;
		}) as typeof window.open;
		render(<UnsubscribeButton message={message({ "list-unsubscribe": LINKS })} />);
		confirmWith("Open page");
		expect(opened).toEqual(["https://reads.example/u/abc"]);
		expect(posts).toHaveLength(0);
	});

	test("mailto only: a prefilled email with no signature", () => {
		setPref("mail.signature", "Sam Rivera");
		render(<UnsubscribeButton message={message({ "list-unsubscribe": "<mailto:leave@reads.example?subject=stop>" })} />);
		confirmWith("Write email");
		const { open, draft } = useComposeStore.getState();
		expect(open).toBe(true);
		expect(draft).toMatchObject({ to: "leave@reads.example", subject: "stop", text: "unsubscribe" });
	});
});
