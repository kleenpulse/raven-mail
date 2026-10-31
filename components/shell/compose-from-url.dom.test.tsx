import "@/test/dom";
import { afterEach, describe, expect, test } from "bun:test";

const React = await import("react");
const { render, cleanup, act } = await import("@testing-library/react");
const { NuqsTestingAdapter } = await import("nuqs/adapters/testing");
const { ComposeFromUrl } = await import("./compose-from-url");
const { useComposeStore } = await import("@/lib/store/compose");

afterEach(() => {
	cleanup();
	useComposeStore.setState({ open: false, edits: 0, savedEdits: 0, pendingOpen: null });
	useComposeStore.getState().resetDraft();
});

function mount(searchParams: string) {
	const urls: string[] = [];
	render(
		<React.StrictMode>
			<NuqsTestingAdapter searchParams={searchParams} hasMemory onUrlUpdate={(e) => urls.push(e.queryString)}>
				<ComposeFromUrl />
			</NuqsTestingAdapter>
		</React.StrictMode>,
	);
	return urls;
}

const settle = () => act(async () => await new Promise((r) => setTimeout(r, 20)));

describe("ComposeFromUrl", () => {
	test("opens a mailto link from the URL in compose once, then clears it", async () => {
		const sessionBefore = useComposeStore.getState().session;
		const urls = mount(`?folder=INBOX&compose=${encodeURIComponent("mailto:a@x.example?subject=Hi%20there&body=one")}`);
		await settle();
		const state = useComposeStore.getState();
		expect(state.open).toBe(true);
		expect(state.mode).toBe("new");
		expect(state.draft.to).toBe("a@x.example");
		expect(state.draft.subject).toBe("Hi there");
		expect(state.draft.text.startsWith("one")).toBe(true);
		expect(state.session).toBe(sessionBefore + 1);
		expect(urls.at(-1)).toBe("?folder=INBOX");
	});

	test("a value that isn't a mailto link is only cleared", async () => {
		const urls = mount(`?compose=${encodeURIComponent("javascript:alert(1)")}`);
		await settle();
		expect(useComposeStore.getState().open).toBe(false);
		expect(urls.at(-1)).toBe("");
	});

	test("unsaved changes in compose ask first instead of being replaced", async () => {
		useComposeStore.setState({ open: true, edits: 2, savedEdits: 0 });
		useComposeStore.getState().setDraft({ subject: "Mine" }, { edit: false });
		mount(`?compose=${encodeURIComponent("mailto:b@x.example")}`);
		await settle();
		const state = useComposeStore.getState();
		expect(state.draft.subject).toBe("Mine");
		expect(state.pendingOpen?.draft?.to).toBe("b@x.example");
	});

	test("no param, nothing happens", async () => {
		const urls = mount("?folder=INBOX");
		await settle();
		expect(useComposeStore.getState().open).toBe(false);
		expect(urls).toEqual([]);
	});
});
