import "@/test/dom";
import { describe, expect, test } from "bun:test";

const { render, screen } = await import("@testing-library/react");
const { Bars } = await import("./bars");
const { Sparkline } = await import("./sparkline");
const { Ring } = await import("./ring");
const { CountUp } = await import("./count-up");

const offset = (el: Element) => (el as HTMLElement | SVGElement).style.strokeDashoffset;

describe("Bars", () => {
	test("is an image labelled by its caption, one bar per value", () => {
		render(<Bars values={[1, 4, 2]} label="Mail per day" />);
		const img = screen.getByRole("img", { name: "Mail per day" });
		expect(img.tagName.toLowerCase()).toBe("svg");
		expect(img.querySelectorAll("rect")).toHaveLength(3);
	});

	test("highlights only the last bar by default, none when disabled", () => {
		const { unmount } = render(<Bars values={[1, 2, 3]} label="a" />);
		let rects = [...screen.getByRole("img", { name: "a" }).querySelectorAll("rect")];
		expect(rects.map((r) => r.getAttribute("class"))).toEqual(["fill-foreground/30", "fill-foreground/30", "fill-signal"]);
		unmount();
		render(<Bars values={[1, 2, 3]} label="b" highlightLast={false} />);
		rects = [...screen.getByRole("img", { name: "b" }).querySelectorAll("rect")];
		expect(rects.every((r) => r.getAttribute("class") === "fill-foreground/30")).toBe(true);
	});

	test("tallest value spans the drawing height; empty and zero series still render", () => {
		render(<Bars values={[0, 10]} label="tall" height={100} />);
		const [low, high] = [...screen.getByRole("img", { name: "tall" }).querySelectorAll("rect")];
		expect(Number(high!.getAttribute("height"))).toBe(96);
		expect(Number(low!.getAttribute("height"))).toBe(2); // minimum stub
		render(<Bars values={[]} label="empty" />);
		expect(screen.getByRole("img", { name: "empty" }).querySelectorAll("rect")).toHaveLength(0);
	});
});

describe("Sparkline", () => {
	test("labelled svg image with a path and an endpoint dot", () => {
		const { container } = render(<Sparkline values={[1, 3, 2]} label="Trend" />);
		const img = screen.getByRole("img", { name: "Trend" });
		expect(img.tagName.toLowerCase()).toBe("svg");
		expect(img.querySelector("path")?.getAttribute("d")).toMatch(/^M/);
		expect(container.querySelector("span[aria-hidden]")).not.toBeNull();
	});

	test("no values: still an image, no path, no dot", () => {
		const { container } = render(<Sparkline values={[]} label="Nothing" />);
		expect(screen.getByRole("img", { name: "Nothing" }).querySelector("path")).toBeNull();
		expect(container.querySelector("span[aria-hidden]")).toBeNull();
	});
});

describe("Ring", () => {
	test("is a labelled image that renders its children", () => {
		render(
			<Ring value={40} label="Inbox zero progress">
				<span>40%</span>
			</Ring>,
		);
		const img = screen.getByRole("img", { name: "Inbox zero progress" });
		expect(img.textContent).toContain("40%");
		// The inner svg is decorative.
		expect(img.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
	});

	test.each([
		[40, "60"],
		[-25, "100"],
		[0, "100"],
		[100, "0"],
		[250, "0"],
	])("value %p sweeps to dash offset %s (clamped to 0–100)", (value, expected) => {
		render(<Ring value={value} label={`ring ${value}`} />);
		const sweep = screen.getByRole("img", { name: `ring ${value}` }).querySelector("circle.ring-sweep")!;
		expect(offset(sweep)).toBe(expected);
	});
});

describe("CountUp", () => {
	test("screen readers get the final formatted value immediately", () => {
		const { container } = render(<CountUp value={12345} />);
		const sr = container.querySelector(".sr-only")!;
		expect(sr.textContent).toBe((12345).toLocaleString());
		// The animated figure is hidden from assistive tech.
		expect(container.querySelector("[aria-hidden]")).not.toBeNull();
	});

	test("uses the custom formatter for the stable value", () => {
		const { container } = render(<CountUp value={0.426} format={(n) => `${(n * 100).toFixed(1)}%`} />);
		expect(container.querySelector(".sr-only")!.textContent).toBe("42.6%");
	});

	test("sr-only value follows prop changes", () => {
		const { container, rerender } = render(<CountUp value={3} />);
		rerender(<CountUp value={9} />);
		expect(container.querySelector(".sr-only")!.textContent).toBe("9");
	});
});
