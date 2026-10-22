import { jsonResponse } from "@/test/dom";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PreviewItem, RuleDTO, RuleEventDTO } from "@/lib/rules/types";

type Toast = { kind: string; title: string; description?: string };
const toasts: Toast[] = [];
mock.module("sonner", () => ({
	toast: Object.assign((title: string) => toasts.push({ kind: "plain", title }), {
		success: (title: string, o: Omit<Toast, "kind" | "title"> = {}) => toasts.push({ kind: "success", title, ...o }),
		error: (title: string, o: Omit<Toast, "kind" | "title"> = {}) => toasts.push({ kind: "error", title, ...o }),
	}),
}));

const React = await import("react");
const { render, screen, fireEvent, cleanup, waitFor } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { AccountProvider } = await import("@/components/providers/account-provider");
const { RulesListRow, NewRuleRow, RuleActivityRow } = await import("./rules-rows");

const realFetch = globalThis.fetch;
const calls: { method: string; url: string; body?: unknown }[] = [];
let rules: RuleDTO[] = [];
let engine: "jev" | "kage" | null = "kage";
let events: RuleEventDTO[] = [];
let preview: PreviewItem[] = [];
type Failure = { status: number; code: string; error: string; hint: string };
let failWith: Failure | null = null;
let eventsFail: Failure | null = null;

function stubServer() {
	globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
		const method = init.method ?? "GET";
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ method, url, body });
		if (failWith) return jsonResponse({ ok: false, retryable: false, ...failWith }, failWith.status);
		if (url === "/api/mail/folders") return jsonResponse({ ok: true, data: [] });
		if (url === "/api/rules/events") {
			if (eventsFail) return jsonResponse({ ok: false, retryable: false, ...eventsFail }, eventsFail.status);
			return jsonResponse({ ok: true, data: method === "GET" ? events : { ...events[0], undone: true } });
		}
		if (url === "/api/rules/preview") return jsonResponse({ ok: true, data: preview });
		if (url === "/api/rules/run") return jsonResponse({ ok: true, data: { checked: 50, judged: 50, applied: 1, engine: "kage" } });
		if (method === "GET") return jsonResponse({ ok: true, data: { rules, engine } });
		if (method === "POST") return jsonResponse({ ok: true, data: { ...rule("new"), ...body } });
		return jsonResponse({ ok: true, data: null });
	}) as typeof fetch;
}

afterEach(() => {
	cleanup();
	toasts.length = 0;
	calls.length = 0;
	rules = [];
	engine = "kage";
	events = [];
	preview = [];
	failWith = null;
	eventsFail = null;
	globalThis.fetch = realFetch;
});

const account = { email: "me@home.example", displayName: "Me", provider: "custom", jev: { source: null, hint: null, kage: true } } as never;

function wrap(node: React.ReactNode) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<AccountProvider account={account}>{node}</AccountProvider>
		</QueryClientProvider>,
	);
}

function rule(id: string, over: Partial<RuleDTO> = {}): RuleDTO {
	return {
		id: `00000000-0000-4000-8000-00000000000${id.length}`.slice(0, 36),
		criteria: `rule ${id}`,
		action: "archive",
		enabled: true,
		position: 0,
		createdAt: "2026-10-22T10:00:00.000Z",
		updatedAt: "2026-10-22T10:00:00.000Z",
		...over,
	};
}

function event(over: Partial<RuleEventDTO> = {}): RuleEventDTO {
	return {
		id: "6f1c1f4e-3b7a-4f2e-9a51-1c2d3e4f5a6b",
		ruleId: "r",
		action: "archive",
		probability: 0.9,
		applied: true,
		undone: false,
		engine: "kage",
		subject: "Your order #4821",
		from: "orders@shop.example",
		folder: "INBOX",
		uid: "12",
		dest: "Archive",
		newUid: "88",
		why: 'Matched "receipts" at 90% (Kage)',
		undoable: true,
		createdAt: "2026-10-22T10:00:00.000Z",
		...over,
	};
}

describe("RulesListRow", () => {
	test("lists rules in order with what they do; on/off, reorder and delete go to the server", async () => {
		rules = [
			rule("a", { id: "11111111-1111-4111-8111-111111111111", criteria: "receipts from shops" }),
			rule("b", { id: "22222222-2222-4222-8222-222222222222", criteria: "trips", action: "move", folder: "Travel", position: 1 }),
		];
		stubServer();
		wrap(<RulesListRow />);
		await waitFor(() => screen.getByText("receipts from shops"));
		expect(screen.getByText("Move to Travel")).toBeTruthy();
		expect(screen.getByText(/Kage, Raven's built-in engine, decides/)).toBeTruthy();

		fireEvent.click(screen.getByRole("switch", { name: "Turn off: receipts from shops" }));
		await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ id: rules[0]!.id, enabled: false }));

		fireEvent.click(screen.getAllByRole("button", { name: "Run later" })[0]!);
		await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && (c.body as { move?: string }).move === "down")).toBe(true));

		fireEvent.click(screen.getAllByRole("button", { name: "Delete rule" })[0]!);
		await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
	});

	test("Run rules now says what changed", async () => {
		rules = [rule("a")];
		stubServer();
		wrap(<RulesListRow />);
		await waitFor(() => screen.getByText("rule a"));
		fireEvent.click(screen.getByRole("button", { name: "Run rules now" }));
		await waitFor(() => expect(toasts).toEqual([{ kind: "success", title: "Checked 50 messages. 1 changed." }]));
		expect(calls.find((c) => c.url === "/api/rules/run")?.body).toEqual({});
	});

	test("no engine: Run is off and the row says why", async () => {
		rules = [rule("a")];
		engine = null;
		stubServer();
		wrap(<RulesListRow />);
		await waitFor(() => screen.getByText("Rules can't run here: Kage is off and there's no Jev key."));
		expect((screen.getByRole("button", { name: "Run rules now" }) as HTMLButtonElement).disabled).toBe(true);
	});

	test("no database: the callout, and the other rows stay out of the way", async () => {
		failWith = { status: 503, code: "store_needs_db", error: "Rules, blocked senders and reminders need a database.", hint: "Set DATABASE_URL, then run bun run db:migrate." };
		stubServer();
		const { container } = wrap(
			<>
				<RulesListRow />
				<NewRuleRow />
				<RuleActivityRow />
			</>,
		);
		await waitFor(() => screen.getByText("Rules, blocked senders and reminders need a database."));
		expect(container.querySelectorAll("textarea")).toHaveLength(0);
		expect(screen.queryByText("Recent Activity") === null).toBe(true);
	});
});

describe("NewRuleRow", () => {
	test("Save waits for a preview of the current words; a preview says what would match", async () => {
		preview = [
			{ uid: "1", subject: "Your order #4821", from: "Shop", probability: 0.92, wouldApply: true, why: "" },
			{ uid: "2", subject: "Lunch?", from: "Maya", probability: 0.88, wouldApply: false, why: "Matched at 88%, but you write to this sender, so it stayed" },
			{ uid: "3", subject: "Notes", from: "Leo", probability: 0.1, wouldApply: false, why: "Not a match (10%)" },
		];
		stubServer();
		wrap(<NewRuleRow />);
		await waitFor(() => screen.getByRole("textbox"));
		const save = () => screen.getByRole("button", { name: "Save rule" }) as HTMLButtonElement;
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "receipts from shops" } });
		expect(save().disabled).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: /Preview on the last 50/ }));
		await waitFor(() => screen.getByText("Would match 1 of the last 3"));
		expect(screen.getByText("Your order #4821")).toBeTruthy();
		expect(screen.getByText("1 more matches, but it's from people you write to, so it stays.")).toBeTruthy();
		expect(calls.find((c) => c.url === "/api/rules/preview")?.body).toEqual({ criteria: "receipts from shops", action: "archive" });
		expect(save().disabled).toBe(false);

		// New words: preview again before saving.
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "receipts and invoices" } });
		expect(save().disabled).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: /Preview on the last 50/ }));
		await waitFor(() => expect(save().disabled).toBe(false));
		fireEvent.click(save());
		await waitFor(() => expect(calls.find((c) => c.url === "/api/rules" && c.method === "POST")?.body).toEqual({ criteria: "receipts and invoices", action: "archive" }));
		await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""));
	});
});

describe("RuleActivityRow", () => {
	test("Undo for applied moves; no Undo, with the reason, when the server gave no new uid", async () => {
		events = [event(), event({ id: "7f1c1f4e-3b7a-4f2e-9a51-1c2d3e4f5a6b", subject: "Weekly digest", newUid: undefined, undoable: false })];
		stubServer();
		wrap(<RuleActivityRow />);
		await waitFor(() => screen.getByText("Your order #4821"));
		expect(screen.getByText("No undo")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		await waitFor(() => expect(calls.find((c) => c.url === "/api/rules/events" && c.method === "POST")?.body).toEqual({ id: events[0]!.id }));
		await waitFor(() => expect(toasts.at(-1)).toEqual({ kind: "success", title: "Moved back to your Inbox" }));
	});

	test("before the table exists: the not-set-up callout instead of a spinner", async () => {
		eventsFail = { status: 503, code: "db_not_migrated", error: "The database isn't set up yet.", hint: "Run bun run db:migrate, then reload." };
		stubServer();
		wrap(<RuleActivityRow />);
		await waitFor(() => screen.getByText("The database isn't set up yet."));
	});
});
