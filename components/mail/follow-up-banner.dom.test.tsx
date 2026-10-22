import { jsonResponse } from "@/test/dom";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { FollowUpView } from "@/lib/follow-ups/types";
import type { MailMessage } from "@/lib/mail/types";

type Toast = { kind: string; title: string; description?: string };
const toasts: Toast[] = [];
mock.module("sonner", () => ({
	toast: {
		success: (title: string, o: Omit<Toast, "kind" | "title"> = {}) => toasts.push({ kind: "success", title, ...o }),
		error: (title: string, o: Omit<Toast, "kind" | "title"> = {}) => toasts.push({ kind: "error", title, ...o }),
	},
}));

// happy-dom rejects a native animation motion cancels mid-way; the banner's look isn't under test.
const { MotionGlobalConfig } = await import("motion/react");
MotionGlobalConfig.skipAnimations = true;

const React = await import("react");
const { render, screen, fireEvent, cleanup, waitFor, act } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { AccountProvider } = await import("@/components/providers/account-provider");
const { ReaderMoreMenu } = await import("./reader-more-menu");
const { FollowUpBanner } = await import("./follow-up-banner");
const { useNewMailShowing } = await import("./new-mail-banner");
const { FollowUpsCard } = await import("@/components/overview/follow-ups-card");

const realFetch = globalThis.fetch;
const calls: { method: string; url: string; body?: unknown }[] = [];
let reminders: FollowUpView[] = [];
let noDb = false;

function stubServer() {
	globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
		const method = init.method ?? "GET";
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ method, url, body });
		if (noDb) {
			return jsonResponse(
				{ ok: false, error: "Rules, blocked senders and reminders need a database.", code: "store_needs_db", hint: "Set DATABASE_URL, then run bun run db:migrate.", retryable: false },
				503,
			);
		}
		if (url.startsWith("/api/blocks")) return jsonResponse({ ok: true, data: [] });
		if (method === "GET") return jsonResponse({ ok: true, data: reminders });
		if (method === "POST") {
			const saved = { ...reminder({ due: false }), dueAt: "2026-10-25T10:00:00.000Z" };
			return jsonResponse({ ok: true, data: saved });
		}
		if (method === "PATCH") return jsonResponse({ ok: true, data: body.action === "done" ? null : reminder({ due: false }) });
		return jsonResponse({ ok: true, data: null });
	}) as typeof fetch;
}

afterEach(() => {
	cleanup();
	toasts.length = 0;
	calls.length = 0;
	reminders = [];
	noDb = false;
	useNewMailShowing.setState({ showing: false });
	globalThis.fetch = realFetch;
});

const account = { email: "me@home.example", displayName: "Me", provider: "custom", jev: { source: null, hint: null } } as never;

function wrap(node: React.ReactNode) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<AccountProvider account={account}>{node}</AccountProvider>
		</QueryClientProvider>,
	);
}

function reminder(over: Partial<FollowUpView> = {}): FollowUpView {
	return {
		id: "6f1c1f4e-3b7a-4f2e-9a51-1c2d3e4f5a6b",
		messageId: "<m42@home.example>",
		subject: "Q3 plan",
		to: "Maya Chen",
		folder: "Sent",
		uid: "42",
		dueAt: "2026-10-20T10:00:00.000Z",
		status: "open",
		createdAt: "2026-10-17T10:00:00.000Z",
		updatedAt: "2026-10-17T10:00:00.000Z",
		due: true,
		...over,
	};
}

const sent: MailMessage = {
	uid: "42",
	folder: "Sent",
	messageId: "<m42@home.example>",
	subject: "Q3 plan",
	from: { name: "Me", address: "me@home.example" },
	to: [{ name: "Maya Chen", address: "maya@acme.example" }],
	cc: [],
	bcc: [],
	date: "2026-10-17T10:00:00Z",
	flags: { seen: true, flagged: false, answered: false, draft: false },
	text: "",
	html: "",
	attachments: [],
	headers: {},
};

async function openMenu() {
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "More" }));
		await new Promise((r) => setTimeout(r, 20));
	});
}

const items = () => screen.getAllByRole("menuitem").map((i) => i.textContent);

describe("Remind me if no reply, in the reader's ⋯ menu", () => {
	test("only mail you sent gets it", async () => {
		stubServer();
		wrap(<ReaderMoreMenu message={{ ...sent, folder: "INBOX" }} accountEmail="me@home.example" onBlocked={() => {}} onUnblocked={() => {}} />);
		await openMenu();
		expect(screen.queryByText("Remind me if no reply") === null).toBe(true);
		expect(calls.some((c) => c.url.startsWith("/api/follow-ups"))).toBe(false);
	});

	test("a preset posts the message's place, never its content", async () => {
		stubServer();
		wrap(<ReaderMoreMenu message={sent} sent accountEmail="me@home.example" onBlocked={() => {}} onUnblocked={() => {}} />);
		await openMenu();
		expect(items()).toEqual(["In 1 day", "In 3 days", "In 1 week", "Pick a time…"]);
		fireEvent.click(screen.getByRole("menuitem", { name: "In 3 days" }));
		await waitFor(() => expect(toasts).toHaveLength(1));
		expect(calls.find((c) => c.method === "POST")).toMatchObject({
			url: "/api/follow-ups",
			body: { folder: "Sent", uid: "42", remind: { days: 3 } },
		});
		expect(toasts[0]!.title).toStartWith("Reminder set for ");
	});

	test("one already set: says when, and Cancel removes it", async () => {
		reminders = [reminder({ due: false, dueAt: "2027-03-05T10:00:00.000Z" })];
		stubServer();
		wrap(<ReaderMoreMenu message={sent} sent accountEmail="me@home.example" onBlocked={() => {}} onUnblocked={() => {}} />);
		await waitFor(() => expect(calls.some((c) => c.url === "/api/follow-ups")).toBe(true));
		await openMenu();
		await waitFor(() => screen.getByText("Set for 5 Mar 2027"));
		fireEvent.click(screen.getByRole("menuitem", { name: "Cancel reminder" }));
		await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
		expect(calls.find((c) => c.method === "DELETE")!.url).toBe(`/api/follow-ups?id=${reminders[0]!.id}`);
	});

	test("no database: the callout, in place of the options", async () => {
		noDb = true;
		stubServer();
		wrap(<ReaderMoreMenu message={sent} sent accountEmail="me@home.example" onBlocked={() => {}} onUnblocked={() => {}} />);
		await waitFor(() => expect(calls.some((c) => c.url === "/api/follow-ups")).toBe(true));
		await openMenu();
		await waitFor(() => screen.getByText("Rules, blocked senders and reminders need a database."));
		expect(screen.queryByRole("menuitem", { name: "In 1 day" }) === null).toBe(true);
	});
});

describe("FollowUpBanner", () => {
	test("a due reminder shows who hasn't replied, and Done clears it", async () => {
		reminders = [reminder()];
		stubServer();
		wrap(<FollowUpBanner />);
		await waitFor(() => screen.getByText("No reply from Maya Chen"));
		expect(screen.getByText("Q3 plan")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Open thread" }).getAttribute("href")).toBe(
			"/mail?folder=Sent&uid=42&mid=%3Cm42%40home.example%3E",
		);
		fireEvent.click(screen.getByRole("button", { name: "Done" }));
		await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ id: reminders[0]!.id, action: "done" }));
		await waitFor(() => expect(screen.queryByText("No reply from Maya Chen") === null).toBe(true));
	});

	test("Snooze 1 day asks the server and hides it", async () => {
		reminders = [reminder()];
		stubServer();
		wrap(<FollowUpBanner />);
		await waitFor(() => screen.getByText("No reply from Maya Chen"));
		fireEvent.click(screen.getByRole("button", { name: "Snooze 1 day" }));
		await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ id: reminders[0]!.id, action: "snooze" }));
		await waitFor(() => expect(screen.queryByText("No reply from Maya Chen") === null).toBe(true));
	});

	test("waits while the new-mail banner is up, and never shows what isn't due", async () => {
		reminders = [reminder({ id: "a1c1f4e0-3b7a-4f2e-9a51-1c2d3e4f5a6b", due: false, to: "Leo" }), reminder()];
		useNewMailShowing.setState({ showing: true });
		stubServer();
		wrap(<FollowUpBanner />);
		await waitFor(() => expect(calls.length).toBeGreaterThan(0));
		await new Promise((r) => setTimeout(r, 30));
		expect(screen.queryByText("No reply from Maya Chen") === null).toBe(true);
		act(() => useNewMailShowing.setState({ showing: false }));
		await waitFor(() => screen.getByText("No reply from Maya Chen"));
		expect(screen.queryByText("No reply from Leo") === null).toBe(true);
	});

	test("Dismiss hides it for this visit without telling the server", async () => {
		reminders = [reminder()];
		stubServer();
		wrap(<FollowUpBanner />);
		await waitFor(() => screen.getByText("No reply from Maya Chen"));
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		await waitFor(() => expect(screen.queryByText("No reply from Maya Chen") === null).toBe(true));
		expect(calls.every((c) => c.method === "GET")).toBe(true);
	});
});

describe("FollowUpsCard", () => {
	test("due first with their actions, then what's coming up", async () => {
		reminders = [reminder(), reminder({ id: "b1c1f4e0-3b7a-4f2e-9a51-1c2d3e4f5a6b", to: "Leo", subject: "Venue", due: false, dueAt: "2027-03-05T10:00:00.000Z" })];
		stubServer();
		wrap(<FollowUpsCard />);
		await waitFor(() => screen.getByText("1 due"));
		expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Snooze 1 day" })).toBeTruthy();
		expect(screen.getByText("5 Mar 2027")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Cancel reminder" }));
		await waitFor(() => expect(screen.queryByText("Venue") === null).toBe(true));
	});

	test("nothing set: nothing shown", async () => {
		stubServer();
		const { container } = wrap(<FollowUpsCard />);
		await waitFor(() => expect(calls.length).toBeGreaterThan(0));
		expect(container.textContent).toBe("");
	});
});
