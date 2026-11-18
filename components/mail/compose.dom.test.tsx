import { jsonResponse } from "@/test/dom";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { RichEditorApi } from "@/components/mail/rich-editor";

// A budget small enough to hit with a few hundred bytes. Set before the code under test loads.
const BUDGET = 16_384 + 3000;
process.env.SEND_BUDGET_BYTES = String(BUDGET);

const errors: { message: string; description?: string }[] = [];
mock.module("sonner", () => ({
	toast: Object.assign(() => {}, {
		error: (message: string, options?: { description?: string }) => errors.push({ message, description: options?.description }),
		success: () => {},
		loading: () => {},
	}),
}));

const React = await import("react");
const { useComposeStore } = await import("@/lib/store/compose");

/** What the dock asked the editor to show. */
const inserted: { cid: string; alt: string; width?: number; at?: { x: number; y: number } }[] = [];
let editorUp = true;

// The real editor is Tiptap; here a stand-in that records what it's given and
// writes the images into the draft's HTML, as the real one does.
function StubEditor({ apiRef, onChange }: { apiRef: React.RefObject<RichEditorApi | null>; onChange: (next: { html: string; text: string }, how: { edit: boolean }) => void }) {
	React.useEffect(() => {
		if (!editorUp) return;
		apiRef.current = {
			insertImages(list, at) {
				inserted.push(...list.map((image) => ({ ...image, at })));
				const html = (useComposeStore.getState().draft.html ?? "") + list.map((i) => `<p><img src="cid:${i.cid}" alt="${i.alt}"></p>`).join("");
				onChange({ html, text: list.map((i) => `[image: ${i.alt}]`).join("\n") }, { edit: true });
			},
		};
		return () => {
			apiRef.current = null;
		};
	}, [apiRef, onChange]);
	return <div className="ProseMirror" data-testid="body" />;
}
mock.module("next/dynamic", () => ({ default: () => StubEditor }));

const { MotionGlobalConfig } = await import("motion/react");
MotionGlobalConfig.skipAnimations = true;

const { render, screen, fireEvent, createEvent, cleanup, act } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { AccountProvider } = await import("@/components/providers/account-provider");
const { ComposeDock } = await import("./compose");

const account = { email: "me@home.example", displayName: "Me", provider: "custom", jev: { source: null, hint: null } } as never;
const realFetch = globalThis.fetch;
const realBitmap = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
const compose = () => useComposeStore.getState();

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<AccountProvider account={account}>
				<ComposeDock />
			</AccountProvider>
		</QueryClientProvider>,
	);
	act(() => {
		compose().openCompose("new", undefined, { signature: false });
	});
}

const file = (name: string, type: string, bytes = 1200) => new File([new Uint8Array(bytes).fill(7)], name, { type });
const clipboard = (files: File[], text = "") => ({ clipboardData: { files, items: [], types: ["Files"], getData: () => text } });
const drag = (files: File[]) => ({ dataTransfer: { files, types: ["Files"], dropEffect: "none" } });
/** A drop at (40, 60). happy-dom's event drops the pointer position from its init, so it's set by hand. */
function dropOn(target: Element, files: File[]): boolean {
	const event = createEvent.drop(target, drag(files));
	Object.defineProperty(event, "clientX", { value: 40 });
	Object.defineProperty(event, "clientY", { value: 60 });
	return fireEvent(target, event);
}
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
const toField = () => document.querySelector<HTMLInputElement>('[data-compose] [role="combobox"]')!;
const chips = () => [...document.querySelectorAll("[data-preview-key]")].map((el) => el.textContent);

beforeEach(() => {
	errors.length = 0;
	inserted.length = 0;
	editorUp = true;
	globalThis.fetch = (async () => jsonResponse({ ok: true, data: [] })) as unknown as typeof fetch;
	// happy-dom has no createImageBitmap. Files named "broken" won't decode.
	(globalThis as { createImageBitmap?: unknown }).createImageBitmap = async (blob: File) => {
		if (blob.name.startsWith("broken")) throw new Error("decode");
		return { width: 900, height: 500, close() {} };
	};
});

afterEach(() => {
	act(() => compose().closeCompose());
	cleanup();
	globalThis.fetch = realFetch;
	(globalThis as { createImageBitmap?: unknown }).createImageBitmap = realBitmap;
});

describe("pasting into compose", () => {
	test("a screenshot pasted with focus in To goes into the body, not the file chips", async () => {
		mount();
		const event = fireEvent.paste(toField(), clipboard([file("image.png", "image/png")]));
		await settle();

		// fireEvent returns false when the default was prevented: the browser must not paste anything itself.
		expect(event).toBe(false);
		expect(compose().attachments).toHaveLength(1);
		const [image] = compose().attachments;
		expect(image!.cid).toMatch(/@raven\.mail$/);
		expect(image!.filename).toMatch(/^pasted-image-\d{4}-\d{2}-\d{2}-\d{6}\.png$/);
		expect(image).toMatchObject({ contentType: "image/png", size: 1200, width: 900 });
		expect(inserted).toEqual([{ cid: image!.cid!, alt: image!.filename, width: 900, at: undefined }]);
		expect(chips()).toEqual([]);
		expect(errors).toEqual([]);
	});

	test("a paste that carries text too is left to the field: the text wins over its picture", async () => {
		mount();
		const event = fireEvent.paste(toField(), clipboard([file("image.png", "image/png")], "A1\tB1"));
		await settle();

		expect(event).toBe(true);
		expect(compose().attachments).toEqual([]);
		expect(inserted).toEqual([]);
	});

	test("a pasted PDF becomes a file chip", async () => {
		mount();
		fireEvent.paste(screen.getByTestId("body"), clipboard([file("notes.pdf", "application/pdf")]));
		await settle();

		expect(compose().attachments.map((a) => [a.filename, a.cid])).toEqual([["notes.pdf", undefined]]);
		expect(inserted).toEqual([]);
		expect(chips()).toHaveLength(1);
		expect(chips()[0]).toContain("notes.pdf");
	});

	test("an svg, and an image that won't decode, go as files", async () => {
		mount();
		fireEvent.paste(toField(), clipboard([file("logo.svg", "image/svg+xml", 300), file("broken.png", "image/png", 300)]));
		await settle();

		expect(compose().attachments.map((a) => [a.filename, a.cid])).toEqual([
			["logo.svg", undefined],
			["broken.png", undefined],
		]);
		expect(inserted).toEqual([]);
		expect(chips()).toHaveLength(2);
	});

	test("an image that would pass the size budget is turned away with a reason, and nothing is added", async () => {
		mount();
		fireEvent.paste(toField(), clipboard([file("huge.png", "image/png", 4000)]));
		await settle();

		expect(compose().attachments).toEqual([]);
		expect(inserted).toEqual([]);
		expect(errors).toHaveLength(1);
		expect(errors[0]!.message).toBe('"huge.png" doesn\'t fit.');
		expect(errors[0]!.description).toMatch(/can add up to about \d+ MB/);
	});

	test("an image deleted from the body stops counting toward the budget", async () => {
		mount();
		fireEvent.paste(toField(), clipboard([file("one.png", "image/png")]));
		await settle();
		expect(compose().attachments).toHaveLength(1);

		// A second one doesn't fit while the first is still in the body.
		fireEvent.paste(toField(), clipboard([file("two.png", "image/png")]));
		await settle();
		expect(compose().attachments).toHaveLength(1);
		expect(errors.map((e) => e.message)).toEqual(['"two.png" doesn\'t fit.']);

		// The user deletes the first from the body; its bytes stay for undo, but no longer count.
		act(() => compose().setDraft({ html: "<p></p>", text: "" }));
		fireEvent.paste(toField(), clipboard([file("two.png", "image/png")]));
		await settle();
		expect(compose().attachments.map((a) => a.filename)).toEqual(["one.png", "two.png"]);
		expect(errors).toHaveLength(1);
	});

	test("an empty clipboard image can't be read, and says so", async () => {
		mount();
		fireEvent.paste(toField(), clipboard([file("image.png", "image/png", 0)]));
		await settle();

		expect(compose().attachments).toEqual([]);
		// Every clipboard image is called "image.png"; the toast doesn't pretend that's its name.
		expect(errors.map((e) => e.message)).toEqual(["Couldn't read that image."]);
	});

	test("a file that fails while being read is skipped; the rest still land", async () => {
		mount();
		const gone = file("gone.pdf", "application/pdf", 300);
		gone.arrayBuffer = () => Promise.reject(new Error("NotFoundError"));
		fireEvent.paste(toField(), clipboard([gone, file("notes.pdf", "application/pdf", 300)]));
		await settle();

		expect(compose().attachments.map((a) => a.filename)).toEqual(["notes.pdf"]);
		expect(errors.map((e) => e.message)).toEqual(['Couldn\'t read "gone.pdf".']);
	});

	test("a paste still being read when compose closes, or moves to another message, adds nothing", async () => {
		mount();
		let release!: (bytes: ArrayBuffer) => void;
		const slow = file("image.png", "image/png");
		slow.arrayBuffer = () => new Promise<ArrayBuffer>((resolve) => (release = resolve));
		fireEvent.paste(toField(), clipboard([slow]));
		await settle();

		act(() => compose().closeCompose());
		act(() => {
			compose().openCompose("new", { subject: "Another message" }, { signature: false });
		});
		await act(async () => {
			release(new Uint8Array(1200).buffer);
			await new Promise((resolve) => setTimeout(resolve, 30));
		});

		expect(compose().draft.subject).toBe("Another message");
		expect(compose().attachments).toEqual([]);
		expect(inserted).toEqual([]);
	});

	test("before the editor is up, a pasted image is kept as a file rather than lost", async () => {
		editorUp = false;
		mount();
		fireEvent.paste(toField(), clipboard([file("image.png", "image/png")]));
		await settle();

		expect(compose().attachments).toHaveLength(1);
		expect(compose().attachments[0]!.cid).toBeUndefined();
		expect(chips()).toHaveLength(1);
	});
});

describe("dropping files on compose", () => {
	test("an image dropped on the body goes in at that point", async () => {
		mount();
		const event = dropOn(screen.getByTestId("body"), [file("chart.png", "image/png")]);
		await settle();

		expect(event).toBe(false);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({ alt: "chart.png", at: { x: 40, y: 60 } });
		expect(chips()).toEqual([]);
	});

	test("an image dropped anywhere else on the dock attaches as a file", async () => {
		mount();
		fireEvent.drop(toField(), drag([file("chart.png", "image/png")]));
		await settle();

		expect(inserted).toEqual([]);
		expect(compose().attachments.map((a) => [a.filename, a.cid])).toEqual([["chart.png", undefined]]);
		expect(chips()).toHaveLength(1);
	});

	test("a drag that began inside the dock is never taken for a dropped file", async () => {
		mount();
		const body = screen.getByTestId("body");
		fireEvent.dragStart(body);
		fireEvent.drop(body, drag([file("chart.png", "image/png")]));
		await settle();

		expect(compose().attachments).toEqual([]);
		expect(inserted).toEqual([]);

		// The drag is over: a real file dropped afterwards counts again.
		fireEvent.drop(body, drag([file("chart.png", "image/png")]));
		await settle();
		expect(compose().attachments).toHaveLength(1);
	});

	test("while compose is open, a file dropped beside the dock doesn't navigate the page away", () => {
		mount();
		const over = new Event("dragover", { bubbles: true, cancelable: true });
		Object.defineProperty(over, "dataTransfer", { value: { types: ["Files"] } });
		const drop = new Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"] } });
		document.body.dispatchEvent(over);
		document.body.dispatchEvent(drop);
		expect([over.defaultPrevented, drop.defaultPrevented]).toEqual([true, true]);

		// Dragging text around the page is none of compose's business.
		const text = new Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(text, "dataTransfer", { value: { types: ["text/plain"] } });
		document.body.dispatchEvent(text);
		expect(text.defaultPrevented).toBe(false);
	});
});

describe("the file chips", () => {
	test("removing a chip removes that file, even with an inline image ahead of it in the list", async () => {
		mount();
		fireEvent.paste(toField(), clipboard([file("image.png", "image/png", 300)]));
		await settle();
		fireEvent.paste(toField(), clipboard([file("a.pdf", "application/pdf", 300), file("b.pdf", "application/pdf", 300)]));
		await settle();
		expect(compose().attachments).toHaveLength(3);
		expect(chips()).toHaveLength(2);

		fireEvent.click(screen.getByLabelText("Remove a.pdf"));
		expect(compose().attachments.map((a) => a.filename)).toEqual([compose().attachments[0]!.filename, "b.pdf"]);
		expect(compose().attachments[0]!.cid).toBeDefined();
	});
});
