import "@/test/dom";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const toasts: string[] = [];
mock.module("sonner", () => ({ toast: { error: (m: string) => void toasts.push(m), success: () => {} } }));

// happy-dom rejects a native animation motion cancels mid-way; the grow itself isn't under test.
const { MotionGlobalConfig } = await import("motion/react");
MotionGlobalConfig.skipAnimations = true;

const React = await import("react");
const { render, screen, fireEvent, cleanup, waitFor, act } = await import("@testing-library/react");
const { prefetchProps, previewKey, useAttachmentPreview, TEXT_PREVIEW_BYTES, PREFETCH_MAX_BYTES, PREFETCH_REST_MS } =
	await import("./attachment-preview");
const { forgetPreviews } = await import("@/lib/mail/preview-cache");
type PreviewSource = import("./attachment-preview").PreviewSource;

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
const realFetch = globalThis.fetch;
let created: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
	created = [];
	revoked = [];
	toasts.length = 0;
	let n = 0;
	URL.createObjectURL = () => {
		const url = `blob:test/${++n}`;
		created.push(url);
		return url;
	};
	URL.revokeObjectURL = (url: string) => void revoked.push(url);
});

afterEach(() => {
	cleanup();
	URL.createObjectURL = realCreate;
	URL.revokeObjectURL = realRevoke;
	globalThis.fetch = realFetch;
	forgetPreviews();
});

const local = (filename: string, contentType: string, body: string): PreviewSource => ({
	filename,
	contentType,
	size: body.length,
	contentBase64: btoa(body),
});

/** Stands in for compose / the reader: a trigger per file, the preview mounted beside them. */
function Harness({ files }: { files: PreviewSource[] }) {
	const preview = useAttachmentPreview();
	return (
		<>
			<p>host still open</p>
			{files.map((f) => (
				<button key={f.filename} type="button" onClick={(e) => preview.open(f, e.currentTarget)}>
					{f.filename}
				</button>
			))}
			{preview.dialog}
		</>
	);
}

const openFile = (name: string) => act(() => fireEvent.click(screen.getByRole("button", { name })));
const dialog = () => screen.queryByRole("dialog");

describe("attachment preview", () => {
	test("an image opens in the page", async () => {
		render(<Harness files={[local("pic.png", "image/png", "png-bytes")]} />);
		await openFile("pic.png");
		const img = await screen.findByRole("img", { name: "pic.png" });
		expect(img.getAttribute("src")).toBe(created[0]!);
		expect(dialog()?.getAttribute("aria-label")).toBe("Preview of pic.png");
		const newTab = screen.getByRole("link", { name: "Open in new tab" });
		expect(newTab.getAttribute("href")).toBe(created[0]!);
		expect(newTab.getAttribute("target")).toBe("_blank");
	});

	test("an XML file with no useful type shows as plain text", async () => {
		render(<Harness files={[local("theme.xml", "application/octet-stream", "<theme dark='1'/>")]} />);
		await openFile("theme.xml");
		await waitFor(() => expect(document.querySelector("pre")?.textContent).toBe("<theme dark='1'/>"));
		// Documents keep the plain preview: no media viewer chrome.
		expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
		expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
	});

	test("a file with no preview type opens nothing", async () => {
		render(<Harness files={[local("a.zip", "application/zip", "PK")]} />);
		await openFile("a.zip");
		expect(dialog()).toBeNull();
		expect(created).toEqual([]);
	});

	test("long text decodes only the first part", async () => {
		const body = "a".repeat(TEXT_PREVIEW_BYTES + 5000);
		render(<Harness files={[local("big.log", "text/plain", body)]} />);
		await openFile("big.log");
		await waitFor(() => expect(document.querySelector("pre")?.textContent?.length).toBe(TEXT_PREVIEW_BYTES));
		expect(screen.getByText(/Showing the first 1 MB/)).toBeTruthy();
	});

	test("a server file takes its type from the metadata, not the response", async () => {
		globalThis.fetch = (async () =>
			new Response("<a/>", { headers: { "Content-Type": "application/octet-stream" } })) as unknown as typeof fetch;
		const remote: PreviewSource = { filename: "x.xml", contentType: "text/xml", size: 4, folder: "INBOX", uid: "1", part: "2" };
		render(<Harness files={[remote]} />);
		await openFile("x.xml");
		await waitFor(() => expect(document.querySelector("pre")?.textContent).toBe("<a/>"));
	});

	test("Escape closes the preview and never reaches the shell", async () => {
		const shellEscapes: string[] = [];
		const shell = (e: KeyboardEvent) => void shellEscapes.push(e.key);
		window.addEventListener("keydown", shell);
		try {
			render(<Harness files={[local("pic.png", "image/png", "png")]} />);
			await openFile("pic.png");
			await screen.findByRole("img", { name: "pic.png" });
			const focused = document.activeElement!;
			expect(dialog()?.contains(focused)).toBe(true);
			await act(() => fireEvent.keyDown(focused, { key: "Escape" }));
			await waitFor(() => expect(dialog() === null).toBe(true));
			expect(shellEscapes).toEqual([]);
			expect(screen.getByText("host still open")).toBeTruthy();
		} finally {
			window.removeEventListener("keydown", shell);
		}
	});

	test("the blob URL is revoked once the preview has closed", async () => {
		render(<Harness files={[local("pic.png", "image/png", "png")]} />);
		await openFile("pic.png");
		await screen.findByRole("img", { name: "pic.png" });
		await act(() => fireEvent.click(screen.getByRole("button", { name: "Close preview" })));
		await waitFor(() => expect(revoked).toEqual([created[0]!]));
	});

	test("opening a second file revokes the first file's URL, not its own", async () => {
		render(<Harness files={[local("a.png", "image/png", "a"), local("b.png", "image/png", "b")]} />);
		await openFile("a.png");
		await screen.findByRole("img", { name: "a.png" });
		const [first] = created;
		// Straight over the first, so no exit animation gets the chance to revoke it.
		await openFile("b.png");
		await screen.findByRole("img", { name: "b.png" });
		expect(revoked).toEqual([first!]);
	});

	test("unmounting with a preview open revokes its URL", async () => {
		const { unmount } = render(<Harness files={[local("pic.png", "image/png", "png")]} />);
		await openFile("pic.png");
		await screen.findByRole("img", { name: "pic.png" });
		unmount();
		expect(revoked).toEqual([created[0]!]);
	});
});

const remote = (filename: string, part: string, contentType = "image/png"): PreviewSource => ({
	filename,
	contentType,
	size: 10,
	folder: "INBOX",
	uid: "7",
	part,
});

/** Server parts answer with their own bytes; parts in `failing` answer 500. */
function serveParts(failing: string[] = []) {
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const part = new URL(String(input), "http://raven.test").searchParams.get("part") ?? "";
		return failing.includes(part) ? new Response("nope", { status: 500 }) : new Response(`part-${part}`);
	}) as unknown as typeof fetch;
}

/** Like the reader: chips carry their preview key, and each click builds a fresh source object. */
function Gallery({ files }: { files: PreviewSource[] }) {
	const preview = useAttachmentPreview();
	return (
		<>
			{files.map((f, i) => (
				<button
					key={f.filename}
					type="button"
					data-preview-key={previewKey(f, i)}
					{...prefetchProps(f)}
					onClick={(e) => preview.open({ ...f }, e.currentTarget, { sources: files, index: i })}
				>
					{f.filename}
				</button>
			))}
			{preview.dialog}
		</>
	);
}

const press = (key: string, target: Element = dialog()!) => act(() => fireEvent.keyDown(target, { key }));
const counter = (text: string) => screen.findByText(text, { selector: "p" });

describe("media viewer", () => {
	const images = (n: number) => Array.from({ length: n }, (_, i) => local(`${"abcde"[i]}.png`, "image/png", `img-${i}`));

	test("arrow keys step through the gallery and wrap at the end", async () => {
		render(<Gallery files={images(3)} />);
		await openFile("a.png");
		await counter("1 / 3");
		await press("ArrowRight");
		await counter("2 / 3");
		await screen.findByRole("img", { name: "b.png" });
		expect(dialog()?.getAttribute("aria-label")).toBe("Preview of b.png");
		await press("ArrowRight");
		await press("ArrowRight");
		await counter("1 / 3");
		await press("ArrowLeft");
		await counter("3 / 3");
	});

	test("the clicked file is found by key, though each click builds a new object", async () => {
		serveParts();
		render(<Gallery files={[remote("a.png", "2"), remote("b.png", "3"), remote("c.png", "4")]} />);
		await openFile("b.png");
		await counter("2 / 3");
		await screen.findByRole("img", { name: "b.png" });
	});

	test("a file that fails to load shows in the viewer and doesn't block the rest", async () => {
		serveParts(["3"]);
		render(<Gallery files={[remote("a.png", "2"), remote("b.png", "3"), remote("c.png", "4")]} />);
		await openFile("a.png");
		await screen.findByRole("img", { name: "a.png" });
		await press("ArrowRight");
		await screen.findByText("Couldn't load b.png.");
		const download = screen.getByRole("link", { name: "Download" });
		expect(download.getAttribute("href")).toContain("part=3");
		await press("ArrowRight");
		await counter("3 / 3");
		await screen.findByRole("img", { name: "c.png" });
		expect(toasts).toEqual([]);
	});

	test("a document that fails still toasts and closes", async () => {
		serveParts(["9"]);
		render(<Gallery files={[remote("terms.pdf", "9", "application/pdf")]} />);
		await openFile("terms.pdf");
		await waitFor(() => expect(toasts).toEqual(["Couldn't open terms.pdf"]));
		await waitFor(() => expect(dialog() === null).toBe(true));
	});

	test("arrow keys on a focused video seek it instead of changing the file", async () => {
		render(<Gallery files={[local("clip.mp4", "video/mp4", "vid"), local("a.png", "image/png", "img")]} />);
		await openFile("clip.mp4");
		await counter("1 / 2");
		const video = await waitFor(() => {
			const el = document.querySelector("video");
			expect(el !== null).toBe(true);
			return el!;
		});
		await press("ArrowRight", video);
		expect(screen.getByText("1 / 2", { selector: "p" })).toBeTruthy();
		await press("ArrowRight");
		await counter("2 / 2");
	});

	test("zoom in shows the level, Reset brings it back", async () => {
		render(<Gallery files={images(1)} />);
		await openFile("a.png");
		await screen.findByRole("img", { name: "a.png" });
		expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
		await act(() => fireEvent.click(screen.getByRole("button", { name: "Zoom in" })));
		await screen.findByText("125%");
		await act(() => fireEvent.click(screen.getByRole("button", { name: "Reset" })));
		await waitFor(() => expect(screen.queryByText("125%") === null).toBe(true));
	});

	test("files more than one step away are released, and closing releases the rest", async () => {
		render(<Gallery files={images(5)} />);
		await openFile("a.png");
		const first = (await screen.findByRole("img", { name: "a.png" })).getAttribute("src")!;
		for (const [n, name] of [[2, "b.png"], [3, "c.png"], [4, "d.png"]] as const) {
			await press("ArrowRight");
			await counter(`${n} / 5`);
			await screen.findByRole("img", { name });
		}
		expect(revoked).toContain(first);
		const shown = screen.getByRole("img", { name: "d.png" }).getAttribute("src")!;
		expect(revoked).not.toContain(shown);
		// Never more than the shown file and its two neighbours alive at once.
		expect(created.length - revoked.length).toBeLessThanOrEqual(3);

		await press("Escape");
		await waitFor(() => expect(dialog() === null).toBe(true));
		expect([...revoked].sort()).toEqual([...created].sort());
	});

	test("closing returns to the chip of the file on screen", async () => {
		render(<Gallery files={images(3)} />);
		await openFile("a.png");
		await press("ArrowRight");
		await press("ArrowRight");
		await counter("3 / 3");
		await press("Escape");
		await waitFor(() => expect(dialog() === null).toBe(true));
		expect(document.activeElement?.getAttribute("data-preview-key")).toBe("compose/2");
	});
	test("a file already viewed opens again without downloading it again", async () => {
		const fetched: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const part = new URL(String(input), "http://raven.test").searchParams.get("part") ?? "";
			fetched.push(part);
			return new Response(`part-${part}`);
		}) as unknown as typeof fetch;
		render(<Gallery files={[remote("a.png", "2")]} />);
		await openFile("a.png");
		await screen.findByRole("img", { name: "a.png" });
		await press("Escape");
		await waitFor(() => expect(dialog() === null).toBe(true));
		await openFile("a.png");
		await screen.findByRole("img", { name: "a.png" });
		expect(fetched).toEqual(["2"]);
	});
});

describe("prefetch", () => {
	let fetched: string[] = [];
	beforeEach(() => {
		fetched = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const part = new URL(String(input), "http://raven.test").searchParams.get("part") ?? "";
			fetched.push(part);
			return new Response(`part-${part}`);
		}) as unknown as typeof fetch;
	});
	const rest = () => act(() => new Promise((resolve) => setTimeout(resolve, PREFETCH_REST_MS + 30)));
	const chip = (name: string) => screen.getByRole("button", { name });

	test("resting the pointer on a chip starts the download, and the click joins it", async () => {
		render(<Gallery files={[remote("a.png", "2")]} />);
		await act(() => fireEvent.pointerEnter(chip("a.png"), { pointerType: "mouse" }));
		await rest();
		expect(fetched).toEqual(["2"]);
		await openFile("a.png");
		await screen.findByRole("img", { name: "a.png" });
		expect(fetched).toEqual(["2"]);
	});

	test("sweeping across a chip without resting fetches nothing", async () => {
		render(<Gallery files={[remote("a.png", "2")]} />);
		await act(() => fireEvent.pointerEnter(chip("a.png"), { pointerType: "mouse" }));
		await act(() => fireEvent.pointerLeave(chip("a.png"), { pointerType: "mouse" }));
		await rest();
		expect(fetched).toEqual([]);
	});

	test("pressing starts at once; documents and large files wait for the click", async () => {
		const big = { ...remote("big.png", "3"), size: PREFETCH_MAX_BYTES + 1 };
		render(<Gallery files={[remote("a.png", "2"), big, remote("terms.pdf", "4", "application/pdf")]} />);
		await act(() => fireEvent.pointerDown(chip("big.png")));
		await act(() => fireEvent.pointerDown(chip("terms.pdf")));
		await act(() => fireEvent.pointerDown(chip("a.png")));
		await waitFor(() => expect(fetched).toEqual(["2"]));
	});
});

describe("media viewer size", () => {
	const proto = HTMLImageElement.prototype;
	const realDecode = proto.decode;
	const own = (name: string) => Object.getOwnPropertyDescriptor(proto, name);
	const realWidth = own("naturalWidth");
	const realHeight = own("naturalHeight");
	let decoded: Promise<void> = Promise.resolve();

	beforeEach(() => {
		decoded = Promise.resolve();
		proto.decode = () => decoded;
		// A 64px icon: small enough that, measured in time, it shows near its own size.
		Object.defineProperty(proto, "naturalWidth", { configurable: true, get: () => 64 });
		Object.defineProperty(proto, "naturalHeight", { configurable: true, get: () => 64 });
	});

	afterEach(() => {
		proto.decode = realDecode;
		for (const [name, real] of [["naturalWidth", realWidth], ["naturalHeight", realHeight]] as const) {
			if (real) Object.defineProperty(proto, name, real);
			else delete (proto as unknown as Record<string, unknown>)[name];
		}
	});

	const shownBox = async () => {
		const panel = dialog()!;
		await waitFor(() => expect(panel.style.opacity).toBe("1"));
		return { width: parseFloat(panel.style.width), height: parseFloat(panel.style.height) };
	};

	/** The box once its size has had time to settle: a shrink would have been applied by then. */
	const settledBox = async () => {
		await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
		return shownBox();
	};

	test("an image that arrives in the loading box keeps that box, and doesn't shrink", async () => {
		let finish!: () => void;
		decoded = new Promise<void>((resolve) => (finish = resolve));
		render(<Gallery files={[local("icon.png", "image/png", "png")]} />);
		await openFile("icon.png");
		await screen.findByRole("img", { name: "icon.png" });
		const loading = await shownBox();
		expect(loading.width).toBeGreaterThan(window.innerWidth / 2);
		await act(async () => finish());
		expect(await settledBox()).toEqual(loading);
	});

	test("a small image already loaded opens in the same box as one still loading", async () => {
		let finish!: () => void;
		decoded = new Promise<void>((resolve) => (finish = resolve));
		const first = render(<Gallery files={[local("icon.png", "image/png", "png")]} />);
		await openFile("icon.png");
		const loading = await shownBox();
		await act(async () => finish());
		first.unmount();

		// Measured at once this time, before the box grows.
		decoded = Promise.resolve();
		render(<Gallery files={[local("icon.png", "image/png", "png")]} />);
		await openFile("icon.png");
		expect(await settledBox()).toEqual(loading);
	});
});
