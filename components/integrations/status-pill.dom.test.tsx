import "@/test/dom";
import { describe, expect, test } from "bun:test";
import type { Tone } from "./status-pill";

const { render, screen } = await import("@testing-library/react");
const { connectionTone, CONNECTION_LABEL, StatusPill } = await import("./status-pill");

function pill(tone: Tone, text = "Label") {
	render(<StatusPill tone={tone}>{text}</StatusPill>);
	return screen.getByText(text).closest("span")!;
}

describe("StatusPill", () => {
	test.each([
		["ok", ["bg-ok/12", "text-ok"]],
		["warn", ["bg-warn/12", "text-warn"]],
		["attention", ["bg-critical/12", "text-critical"]],
		["running", ["bg-signal-soft", "text-signal-ink"]],
		["paused", ["bg-foreground/8", "text-ink-2"]],
		["idle", ["text-ink-2", "ring-1"]],
		["soon", ["border-dashed", "text-ink-3"]],
	] as const)("%s tone applies its pill classes", (tone, classes) => {
		const el = pill(tone);
		for (const c of classes) expect(el.classList.contains(c)).toBe(true);
	});

	test("running shows a spinning loader and no dot", () => {
		const el = pill("running");
		const icon = el.querySelector("svg");
		expect(icon).not.toBeNull();
		expect(icon!.getAttribute("class")).toContain("animate-spin");
		expect(icon!.getAttribute("aria-hidden")).toBe("true");
		expect(el.querySelector("span.rounded-full")).toBeNull();
	});

	test.each([
		["ok", "bg-ok"],
		["warn", "bg-warn"],
		["attention", "bg-critical"],
		["paused", "bg-ink-3"],
	] as const)("%s tone renders a decorative dot (%s) and no spinner", (tone, dotClass) => {
		const el = pill(tone);
		expect(el.querySelector("svg")).toBeNull();
		const dot = el.querySelector("span[aria-hidden]");
		expect(dot).not.toBeNull();
		expect(dot!.classList.contains(dotClass)).toBe(true);
	});

	test("attention dot pulses once", () => {
		expect(pill("attention").querySelector("span[aria-hidden]")!.classList.contains("animate-pulse-once")).toBe(true);
	});

	test.each(["idle", "soon"] as const)("%s tone has neither dot nor spinner", (tone) => {
		const el = pill(tone);
		expect(el.querySelector("svg")).toBeNull();
		expect(el.querySelector("span[aria-hidden]")).toBeNull();
		expect(el.textContent).toBe("Label");
	});

	test("merges a caller className", () => {
		expect(pill("ok", "Extra").classList.contains("shrink-0")).toBe(true);
		render(
			<StatusPill tone="ok" className="custom-x">
				Custom
			</StatusPill>,
		);
		expect(screen.getByText("Custom").closest("span")!.classList.contains("custom-x")).toBe(true);
	});
});

describe("connectionTone / CONNECTION_LABEL", () => {
	test("maps connection status to tone and label", () => {
		expect(connectionTone("active")).toBe("ok");
		expect(connectionTone("paused")).toBe("paused");
		expect(connectionTone("error")).toBe("attention");
		expect(CONNECTION_LABEL).toEqual({ active: "Connected", paused: "Paused", error: "Needs attention" });
	});
});
