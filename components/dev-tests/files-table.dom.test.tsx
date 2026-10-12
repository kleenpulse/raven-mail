import "@/test/dom";
import { describe, expect, test } from "bun:test";
import type { TestCase, TestFile, TestLayer, TestStatus } from "@/lib/dev/test-report";

const { fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
const { FilesTable } = await import("./files-table");
const { countTests } = await import("@/lib/dev/test-report");

function tc(file: string, name: string, status: TestStatus = "pass", error?: TestCase["error"]): TestCase {
	return { id: `${file}::${name}`, name, path: [], status, ms: 3, ...(error ? { error } : {}) };
}

function tf(file: string, layer: TestLayer, tests: TestCase[], ms = 40): TestFile {
	return { file, layer, area: "other", ms, counts: countTests(tests), tests };
}

const FILES: TestFile[] = [
	tf("lib/mail/parse.test.ts", "unit", [tc("lib/mail/parse.test.ts", "parses headers"), tc("lib/mail/parse.test.ts", "decodes base64")]),
	tf("test/api/mail.test.ts", "route", [
		tc("test/api/mail.test.ts", "lists folders"),
		tc("test/api/mail.test.ts", "rejects a bad uid", "fail", { message: "expected 400, got 500" }),
	]),
	tf("components/viz/viz.dom.test.tsx", "dom", [tc("components/viz/viz.dom.test.tsx", "Ring clamps its value")]),
	tf("lib/format.test.ts", "unit", [tc("lib/format.test.ts", "formats bytes")], 2),
];

const count = () => screen.getByText(/of \d+ files$/).textContent;
/** File paths of the visible rows, in order. */
const shownPaths = () =>
	screen
		.getAllByRole("listitem")
		.map((li) => li.querySelector(".font-mono")?.textContent)
		.filter(Boolean);
const chip = (name: string) => screen.getByRole("button", { name });

describe("FilesTable", () => {
	test("shows every file, failures first then by path", () => {
		render(<FilesTable files={FILES} />);
		expect(count()).toBe("4 of 4 files");
		expect(shownPaths()).toEqual([
			"test/api/mail.test.ts",
			"components/viz/viz.dom.test.tsx",
			"lib/format.test.ts",
			"lib/mail/parse.test.ts",
		]);
		// Row shows the short title and the failure tally.
		const failing = screen.getAllByRole("listitem")[0]!;
		expect(within(failing).getByText("mail")).toBeTruthy();
		expect(failing.textContent).toContain("1 ✕ · 2");
	});

	test("chips expose their pressed state", () => {
		render(<FilesTable files={FILES} />);
		expect(chip("All").getAttribute("aria-pressed")).toBe("true");
		expect(chip("Failing").getAttribute("aria-pressed")).toBe("false");
		for (const l of ["Unit", "Route", "DOM"]) expect(chip(l).getAttribute("aria-pressed")).toBe("true");
	});

	test("Failing narrows to files with failures; All restores", () => {
		render(<FilesTable files={FILES} />);
		fireEvent.click(chip("Failing"));
		expect(count()).toBe("1 of 4 files");
		expect(shownPaths()).toEqual(["test/api/mail.test.ts"]);
		expect(chip("Failing").getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(chip("All"));
		expect(count()).toBe("4 of 4 files");
	});

	test("layer chips toggle files of that layer", () => {
		render(<FilesTable files={FILES} />);
		fireEvent.click(chip("Unit"));
		expect(chip("Unit").getAttribute("aria-pressed")).toBe("false");
		expect(count()).toBe("2 of 4 files");
		expect(shownPaths()).not.toContain("lib/format.test.ts");
		fireEvent.click(chip("Route"));
		expect(shownPaths()).toEqual(["components/viz/viz.dom.test.tsx"]);
		fireEvent.click(chip("Unit"));
		expect(count()).toBe("3 of 4 files");
	});

	test("the last active layer can't be switched off", () => {
		render(<FilesTable files={FILES} />);
		fireEvent.click(chip("Unit"));
		fireEvent.click(chip("Route"));
		fireEvent.click(chip("DOM"));
		expect(chip("DOM").getAttribute("aria-pressed")).toBe("true");
		expect(count()).toBe("1 of 4 files");
	});

	test("search filters by file path (case-insensitive)", () => {
		render(<FilesTable files={FILES} />);
		fireEvent.change(screen.getByRole("textbox", { name: "Filter files or tests" }), { target: { value: "  LIB/MAIL " } });
		expect(count()).toBe("1 of 4 files");
		expect(shownPaths()).toEqual(["lib/mail/parse.test.ts"]);
	});

	test("search filters by test name", () => {
		render(<FilesTable files={FILES} />);
		fireEvent.change(screen.getByRole("textbox", { name: "Filter files or tests" }), { target: { value: "clamps" } });
		expect(shownPaths()).toEqual(["components/viz/viz.dom.test.tsx"]);
		expect(count()).toBe("1 of 4 files");
	});

	test("filters combine, and no match reads 0 of M", () => {
		render(<FilesTable files={FILES} />);
		fireEvent.click(chip("Failing"));
		fireEvent.change(screen.getByRole("textbox", { name: "Filter files or tests" }), { target: { value: "parse" } });
		expect(count()).toBe("0 of 4 files");
		expect(screen.queryAllByRole("listitem")).toHaveLength(0);
	});

	test("clicking a file opens its detail dialog", async () => {
		render(<FilesTable files={FILES} />);
		fireEvent.click(screen.getByText("test/api/mail.test.ts").closest("button")!);
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("1 failing")).toBeTruthy();
		await waitFor(() => expect(within(dialog).getByText("expected 400, got 500")).toBeTruthy());
	});
});
