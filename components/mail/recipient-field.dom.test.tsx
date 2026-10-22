import "@/test/dom";
import { afterEach, describe, expect, test } from "bun:test";

const React = await import("react");
const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
const { RecipientField } = await import("./recipient-field");

const CONTACTS = [
	{ name: "Chen, Maya", address: "maya@northwind.com", score: 3 },
	{ name: "Mark Ode", address: "mark@x.com", score: 2 },
	{ address: "sam@acme.io", score: 1 },
];

let latest = "";

function Harness({ initial = "" }: { initial?: string }) {
	const [value, setValue] = React.useState(initial);
	return (
		<RecipientField
			id="to"
			label="To"
			value={value}
			onChange={(v) => {
				latest = v;
				setValue(v);
			}}
			contacts={CONTACTS}
		/>
	);
}

afterEach(() => {
	cleanup();
	latest = "";
});

const input = () => screen.getByRole("combobox") as HTMLInputElement;
const typeText = (text: string) => fireEvent.change(input(), { target: { value: text } });
const chips = () => screen.queryAllByRole("button", { name: /^Remove / }).map((b) => b.getAttribute("aria-label")!.slice(7));

describe("RecipientField", () => {
	test("typing then a comma makes a chip", () => {
		render(<Harness />);
		typeText("bob@y.org");
		fireEvent.keyDown(input(), { key: "," });
		expect(latest).toBe("bob@y.org");
		expect(chips()).toEqual(["bob@y.org"]);
		expect(input().value).toBe("");
	});

	test("a comma inside a quoted name doesn't split it", () => {
		render(<Harness />);
		typeText('"Lee, Ann');
		fireEvent.keyDown(input(), { key: "," });
		expect(latest).toBe("");
	});

	test("pasting a list keeps quoted 'Last, First' names whole, and skips repeats", () => {
		render(<Harness initial="a@x.com" />);
		fireEvent.paste(input(), {
			clipboardData: { getData: () => '"Chen, Maya" <maya@northwind.com>, a@x.com\nb@y.org' },
		});
		expect(chips()).toEqual(["a@x.com", "Chen, Maya", "b@y.org"]);
		expect(latest).toBe('a@x.com, "Chen, Maya" <maya@northwind.com>, b@y.org');
	});

	test("suggestions: arrow down then Enter picks the second, and chosen people aren't offered again", () => {
		render(<Harness />);
		typeText("ma");
		expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
			"Chen, Mayamaya@northwind.com",
			"Mark Odemark@x.com",
		]);
		fireEvent.keyDown(input(), { key: "ArrowDown" });
		fireEvent.keyDown(input(), { key: "Enter" });
		expect(latest).toBe("Mark Ode <mark@x.com>");
		typeText("ma");
		expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Chen, Mayamaya@northwind.com"]);
	});

	test("Escape closes the list without leaving the field's parent", () => {
		let reached = false;
		render(
			<div onKeyDown={() => (reached = true)}>
				<Harness />
			</div>,
		);
		typeText("ma");
		fireEvent.keyDown(input(), { key: "Escape" });
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(reached).toBe(false);
	});

	test("Backspace in an empty box takes the last address back to edit", () => {
		render(<Harness initial="a@x.com, b@y.org" />);
		fireEvent.keyDown(input(), { key: "Backspace" });
		expect(latest).toBe("a@x.com");
		expect(input().value).toBe("b@y.org");
	});

	test("Ctrl+Enter adds the typed address and lets the keypress through to send", () => {
		let sent = false;
		render(
			<div onKeyDown={(e) => (sent = e.key === "Enter" && e.ctrlKey)}>
				<Harness />
			</div>,
		);
		typeText("zed@z.io");
		fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
		expect(latest).toBe("zed@z.io");
		expect(sent).toBe(true);
	});

	test("blur adds what's typed; a bad address is flagged", () => {
		render(<Harness />);
		typeText("not-an-address");
		fireEvent.blur(input());
		expect(latest).toBe("not-an-address");
		expect(screen.getByTitle("Not an email address")).toBeTruthy();
	});
});
