import "@/test/dom";
import { describe, expect, test } from "bun:test";
import type { RunDot } from "@/lib/dev/test-run-state";

const { fireEvent, render, screen } = await import("@testing-library/react");
const { DotStrip } = await import("./dot-strip");

const DOTS: RunDot[] = [
	{ status: "pass", name: "readNdjson > lines split across chunks", file: "lib/ndjson-client.test.ts", ms: 0.8 },
	{ status: "fail", name: "route > 403 cross-origin", file: "lib/server/guard.test.ts", ms: 12 },
	{ status: "skip", name: "later", file: "lib/x.test.ts" },
];

const dot = (container: HTMLElement, i: number) => container.querySelector<HTMLElement>(`[data-dot="${i}"]`)!;

describe("DotStrip", () => {
	test("one dot per test, plus a pulsing dot while running", () => {
		const { container, rerender } = render(<DotStrip dots={DOTS} running />);
		expect(container.querySelectorAll("[data-dot]")).toHaveLength(3);
		expect(container.querySelector(".animate-pulse")).toBeTruthy();
		rerender(<DotStrip dots={DOTS} running={false} />);
		expect(container.querySelector(".animate-pulse")).toBeNull();
	});

	test("no card until a dot is hovered", () => {
		render(<DotStrip dots={DOTS} running={false} />);
		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	test("hovering a dot shows its test, file, status, position and time", () => {
		const { container } = render(<DotStrip dots={DOTS} running={false} />);
		fireEvent.pointerMove(dot(container, 1));
		const tip = screen.getByRole("tooltip");
		expect(tip.textContent).toContain("route > 403 cross-origin");
		expect(tip.textContent).toContain("lib/server/guard.test.ts");
		expect(tip.textContent).toContain("Fail");
		expect(tip.textContent).toContain("#2 of 3");
		expect(tip.textContent).toContain("12ms");
	});

	test("moving to another dot swaps the card; leaving hides it", () => {
		const { container } = render(<DotStrip dots={DOTS} running={false} />);
		fireEvent.pointerMove(dot(container, 0));
		expect(screen.getByRole("tooltip").textContent).toContain("readNdjson");
		fireEvent.pointerMove(dot(container, 2));
		const tip = screen.getByRole("tooltip");
		expect(tip.textContent).toContain("later");
		expect(tip.textContent).not.toContain("ms"); // no timing reported for skips
		fireEvent.pointerLeave(container.firstElementChild!);
		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	test("the gaps between dots don't show a card", () => {
		const { container } = render(<DotStrip dots={DOTS} running={false} />);
		fireEvent.pointerMove(dot(container, 0));
		fireEvent.pointerMove(container.firstElementChild!);
		expect(screen.queryByRole("tooltip")).toBeNull();
	});
});
