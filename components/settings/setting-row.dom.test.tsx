import "@/test/dom";
import { afterEach, describe, expect, test } from "bun:test";

const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
const { PrefSwitchRow, PrefSegmentedRow, SettingsQuery } = await import("./setting-row");
const { getPref, resetPrefs, setPref } = await import("@/lib/prefs/store");

afterEach(() => {
	cleanup();
	resetPrefs();
});

describe("PrefSwitchRow", () => {
	test("toggling stores the pref and marks the row changed", () => {
		render(<PrefSwitchRow id="preload" pref="mail.preload" />);
		expect(screen.queryByText("(changed)")).toBeNull();

		fireEvent.click(screen.getByRole("switch", { name: "Load Messages Early" }));
		expect(getPref("mail.preload")).toBe(false);
		expect(screen.getByText("(changed)")).toBeTruthy();
	});

	test("reset returns it to the default and clears the mark", () => {
		setPref("mail.preload", false);
		render(<PrefSwitchRow id="preload" pref="mail.preload" />);

		fireEvent.click(screen.getByRole("button", { name: "Reset Load Messages Early to default" }));
		expect(getPref("mail.preload")).toBe(true);
		expect(screen.queryByText("(changed)")).toBeNull();
	});

	test("side effect runs with the new value", () => {
		const seen: boolean[] = [];
		render(<PrefSwitchRow id="offline-cache" pref="sync.offlineCache" onChange={(v) => seen.push(v)} />);
		fireEvent.click(screen.getByRole("switch", { name: "Save Mail on This Device" }));
		expect(seen).toEqual([false]);
	});
});

describe("PrefSegmentedRow", () => {
	test("picking an option applies it", () => {
		render(
			<PrefSegmentedRow
				id="density"
				pref="appearance.density"
				options={[
					{ value: "comfortable", label: "Comfortable" },
					{ value: "compact", label: "Compact" },
				]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Compact" }));
		expect(getPref("appearance.density")).toBe("compact");
	});
});

describe("search highlight", () => {
	test("matched words in the label are marked", () => {
		const { container } = render(
			<SettingsQuery.Provider value="early">
				<PrefSwitchRow id="preload" pref="mail.preload" />
			</SettingsQuery.Provider>,
		);
		expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toContain("Early");
	});
});
