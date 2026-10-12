import "@/test/dom";
import { describe, expect, test } from "bun:test";
import type { TestCase, TestFile } from "@/lib/dev/test-report";

const { fireEvent, render, screen, within } = await import("@testing-library/react");
const { FileDetail, TestRow } = await import("./file-detail");
const { countTests } = await import("@/lib/dev/test-report");

const FILE_PATH = "test/api/mail.test.ts";

const TESTS: TestCase[] = [
	{ id: "a", name: "lists folders", path: ["GET /api/mail/folders"], status: "pass", ms: 4 },
	{
		id: "b",
		name: "rejects a bad uid",
		path: ["GET /api/mail/message"],
		status: "fail",
		ms: 12,
		error: { message: "expected 400", detail: "Expected: 400\nReceived: 500\n  at mail.test.ts:42" },
	},
	{ id: "c", name: "streams large bodies", path: [], status: "skip", ms: 0 },
	{ id: "d", name: "moves to trash", path: [], status: "fail", ms: 7, error: { message: "timed out" } },
];

const FILE: TestFile = { file: FILE_PATH, layer: "route", area: "mail", ms: 1234, counts: countTests(TESTS), tests: TESTS };

const rowFor = (name: string) => screen.getByText(new RegExp(name)).closest("li")!;

describe("FileDetail", () => {
	test("header: path, failing pill, layer, area, totals", () => {
		render(<FileDetail file={FILE} />);
		expect(screen.getByText(FILE_PATH)).toBeTruthy();
		expect(screen.getByText("2 failing")).toBeTruthy();
		expect(screen.getByText("Route")).toBeTruthy();
		expect(screen.getByText("Mail")).toBeTruthy();
		expect(screen.getByText(/4 tests · 1\.23s/)).toBeTruthy();
	});

	test("all-passing file says so", () => {
		const tests = TESTS.filter((t) => t.status !== "fail");
		render(<FileDetail file={{ ...FILE, tests, counts: countTests(tests) }} />);
		expect(screen.getByText("All passing")).toBeTruthy();
	});

	test("failing tests are listed first, titles joined with ›", () => {
		const { container } = render(<FileDetail file={FILE} />);
		const titles = [...container.querySelectorAll("ul > li")].map((li) => li.querySelector(".truncate")?.textContent);
		expect(titles).toEqual([
			"GET /api/mail/message › rejects a bad uid",
			"moves to trash",
			"GET /api/mail/folders › lists folders",
			"streams large bodies",
		]);
	});

	test("a failing test's error detail is open by default", () => {
		render(<FileDetail file={FILE} />);
		const row = rowFor("rejects a bad uid");
		const button = within(row).getByRole("button");
		expect(button.getAttribute("aria-expanded")).toBe("true");
		const pre = row.querySelector("pre")!;
		expect(pre.textContent).toBe("Expected: 400\nReceived: 500\n  at mail.test.ts:42");
	});

	test("falls back to the error message when there is no detail", () => {
		render(<FileDetail file={FILE} />);
		expect(rowFor("moves to trash").querySelector("pre")!.textContent).toBe("timed out");
	});

	test("the row button toggles the detail closed and open again", () => {
		render(<FileDetail file={FILE} />);
		const row = rowFor("rejects a bad uid");
		const button = within(row).getByRole("button");
		fireEvent.click(button);
		expect(button.getAttribute("aria-expanded")).toBe("false");
		expect(row.querySelector("pre")).toBeNull();
		fireEvent.click(button);
		expect(button.getAttribute("aria-expanded")).toBe("true");
		expect(row.querySelector("pre")).not.toBeNull();
	});

	test("passing and skipped rows have no button and no detail", () => {
		render(<FileDetail file={FILE} />);
		for (const name of ["lists folders", "streams large bodies"]) {
			const row = rowFor(name);
			expect(within(row).queryByRole("button")).toBeNull();
			expect(row.querySelector("pre")).toBeNull();
		}
		expect(within(rowFor("lists folders")).getByText("Pass")).toBeTruthy();
		expect(within(rowFor("streams large bodies")).getByText("Skip")).toBeTruthy();
		expect(screen.getAllByRole("button")).toHaveLength(2);
	});
});

describe("TestRow", () => {
	test("a non-failing test that carries an error starts closed", () => {
		const t: TestCase = { id: "x", name: "flaky", path: [], status: "todo", ms: 0, error: { message: "note" } };
		render(
			<ul>
				<TestRow test={t} showFile="lib/x.test.ts" />
			</ul>,
		);
		expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
		expect(screen.getByText("lib/x.test.ts")).toBeTruthy();
		expect(screen.getByText("Todo")).toBeTruthy();
	});
});
