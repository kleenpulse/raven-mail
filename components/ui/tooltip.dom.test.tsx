import "@/test/dom";
import { afterEach, describe, expect, test } from "bun:test";

const React = await import("react");
const { render, screen, cleanup } = await import("@testing-library/react");
const { Tip, TooltipGroup } = await import("./tooltip");

afterEach(cleanup);

describe("Tip", () => {
	// Base UI's Trigger keeps `disabled` for itself (it only stops the tooltip),
	// so a disabled button has to be disabled on the rendered element.
	test("disabled on the rendered button disables the button", () => {
		render(
			<Tip label="Deep triage" render={<button disabled />}>
				Run
			</Tip>,
		);
		expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(true);
	});

	test("disabled on Tip itself leaves the button clickable", () => {
		render(
			<Tip label="Deep triage" disabled>
				Run
			</Tip>,
		);
		expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(false);
	});

	test("the same holds inside a TooltipGroup", () => {
		render(
			<TooltipGroup>
				<Tip label="Bold" render={<button disabled />}>
					B
				</Tip>
			</TooltipGroup>,
		);
		expect((screen.getByRole("button", { name: "B" }) as HTMLButtonElement).disabled).toBe(true);
	});
});
