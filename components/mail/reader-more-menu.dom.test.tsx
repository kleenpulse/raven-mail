import { jsonResponse } from "@/test/dom";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { BlockDTO } from "@/lib/blocks/types";
import type { MailMessage } from "@/lib/mail/types";

type Toast = { kind: string; title: string; description?: string; action?: { label: string; onClick: () => void } };
const toasts: Toast[] = [];
mock.module("sonner", () => ({
	toast: {
		success: (title: string, o: Omit<Toast, "kind" | "title"> = {}) => toasts.push({ kind: "success", title, ...o }),
		error: (title: string, o: Omit<Toast, "kind" | "title"> = {}) => toasts.push({ kind: "error", title, ...o }),
	},
}));

const React = await import("react");
const { render, screen, fireEvent, cleanup, waitFor, act } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { AccountProvider } = await import("@/components/providers/account-provider");
const { ReaderMoreMenu } = await import("./reader-more-menu");
const { BlockedSendersRow } = await import("@/components/settings/blocked-senders-row");

const realFetch = globalThis.fetch;
const calls: { method: string; url: string; body?: unknown }[] = [];
let server: BlockDTO[] = [];
let noDb = false;

function stubServer() {
	globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
		const method = init.method ?? "GET";
		calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
		if (noDb) {
			return jsonResponse(
				{ ok: false, error: "Rules, blocked senders and reminders need a database.", code: "store_needs_db", hint: "Set DATABASE_URL, then run bun run db:migrate.", retryable: false },
				503,
			);
		}
		if (method === "GET") return jsonResponse({ ok: true, data: server });
		if (method === "POST") {
			const { kind, value } = JSON.parse(String(init.body)) as BlockDTO;
			const saved = { id: crypto.randomUUID(), kind, value, createdAt: "2026-10-22T12:00:00.000Z" };
			server = [...server, saved];
			return jsonResponse({ ok: true, data: saved });
		}
		const id = new URL(url, "http://x").searchParams.get("id");
		server = server.filter((b) => b.id !== id);
		return jsonResponse({ ok: true, data: null });
	}) as typeof fetch;
}

afterEach(() => {
	cleanup();
	toasts.length = 0;
	calls.length = 0;
	server = [];
	noDb = false;
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

function message(address: string): MailMessage {
	return {
		uid: "42",
		folder: "INBOX",
		subject: "Deal",
		from: { name: "Deals", address },
		to: [],
		cc: [],
		bcc: [],
		date: "2026-10-20T10:00:00Z",
		flags: { seen: true, flagged: false, answered: false, draft: false },
		text: "",
		html: "",
		attachments: [],
		headers: {},
	};
}

// The menu positions itself after opening; let that settle inside act.
async function openMenu() {
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "More" }));
		await new Promise((r) => setTimeout(r, 20));
	});
	return screen.getByRole("menu");
}

const items = () => screen.getAllByRole("menuitem").map((i) => i.textContent);

describe("ReaderMoreMenu", () => {
	test("offers the address and, for a company domain, the whole domain", async () => {
		stubServer();
		wrap(<ReaderMoreMenu message={message("Deals@Shop.Example")} accountEmail="me@home.example" onBlocked={() => {}} onUnblocked={() => {}} />);
		await openMenu();
		expect(items()).toEqual(["Block deals@shop.example", "Block everyone at shop.example"]);
	});

	test("no domain option for a shared provider", async () => {
		stubServer();
		wrap(<ReaderMoreMenu message={message("friend@gmail.com")} accountEmail="me@home.example" onBlocked={() => {}} onUnblocked={() => {}} />);
		await openMenu();
		expect(items()).toEqual(["Block friend@gmail.com"]);
	});

	test("your own email can't be blocked", async () => {
		stubServer();
		wrap(<ReaderMoreMenu message={message("Me@Home.example")} accountEmail="me@home.example" onBlocked={() => {}} onUnblocked={() => {}} />);
		await openMenu();
		expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
		expect(screen.getByText("This is your own email.")).toBeTruthy();
	});

	test("block → POST, onBlocked, a toast whose Undo unblocks", async () => {
		stubServer();
		const blocked = mock(() => {});
		const unblocked = mock(() => {});
		wrap(<ReaderMoreMenu message={message("deals@shop.example")} accountEmail="me@home.example" onBlocked={blocked} onUnblocked={unblocked} />);
		await openMenu();
		fireEvent.click(screen.getByRole("menuitem", { name: "Block everyone at shop.example" }));
		await waitFor(() => expect(blocked).toHaveBeenCalledTimes(1));
		expect(calls.find((c) => c.method === "POST")?.body).toEqual({ kind: "domain", value: "shop.example" });
		expect(toasts[0]).toMatchObject({ kind: "success", title: "Blocked everyone at shop.example" });

		toasts[0]!.action!.onClick();
		await waitFor(() => expect(unblocked).toHaveBeenCalledTimes(1));
		expect(calls.some((c) => c.method === "DELETE")).toBe(true);
		expect(server).toEqual([]);
	});

	test("already blocked: the menu offers Unblock", async () => {
		server = [{ id: crypto.randomUUID(), kind: "domain", value: "shop.example", createdAt: "2026-10-22T12:00:00.000Z" }];
		stubServer();
		wrap(<ReaderMoreMenu message={message("news@mail.shop.example")} accountEmail="me@home.example" onBlocked={() => {}} onUnblocked={() => {}} />);
		await waitFor(() => expect(calls.some((c) => c.method === "GET")).toBe(true));
		await openMenu();
		await waitFor(() => expect(items()).toEqual(["Unblock everyone at shop.example"]));
	});

	test("no database: an error toast with the fix, and onBlocked never runs", async () => {
		noDb = true;
		stubServer();
		const blocked = mock(() => {});
		wrap(<ReaderMoreMenu message={message("deals@shop.example")} accountEmail="me@home.example" onBlocked={blocked} onUnblocked={() => {}} />);
		await openMenu();
		fireEvent.click(screen.getByRole("menuitem", { name: "Block deals@shop.example" }));
		await waitFor(() => expect(toasts).toHaveLength(1));
		expect(toasts[0]).toMatchObject({
			kind: "error",
			title: "Rules, blocked senders and reminders need a database.",
			description: "Set DATABASE_URL, then run bun run db:migrate.",
		});
		expect(blocked).not.toHaveBeenCalled();
	});
});

describe("BlockedSendersRow", () => {
	test("lists everyone blocked, and Unblock removes them", async () => {
		server = [
			{ id: crypto.randomUUID(), kind: "address", value: "bob@shop.example", createdAt: "2026-10-22T12:00:00.000Z" },
			{ id: crypto.randomUUID(), kind: "domain", value: "spam.example", createdAt: "2026-10-22T12:00:00.000Z" },
		];
		stubServer();
		wrap(<BlockedSendersRow />);
		await waitFor(() => screen.getByText("bob@shop.example"));
		expect(screen.getByText("Everyone at spam.example")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Unblock bob@shop.example" }));
		await waitFor(() => expect(screen.queryByText("bob@shop.example") === null).toBe(true));
		expect(server.map((b) => b.value)).toEqual(["spam.example"]);
	});

	test("empty list says how to block", async () => {
		stubServer();
		wrap(<BlockedSendersRow />);
		await waitFor(() => screen.getByText(/No one is blocked/));
	});

	test("no database: the callout with the fix", async () => {
		noDb = true;
		stubServer();
		wrap(<BlockedSendersRow />);
		await waitFor(() => screen.getByText("Rules, blocked senders and reminders need a database."));
		expect(screen.getByText("Set DATABASE_URL, then run bun run db:migrate.")).toBeTruthy();
	});
});
