import "@/test/dom";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

// happy-dom rejects a native animation motion cancels mid-way; the grow itself isn't under test.
const { MotionGlobalConfig } = await import("motion/react");
MotionGlobalConfig.skipAnimations = true;

const React = await import("react");
const { render, screen, fireEvent, cleanup, waitFor, act } = await import("@testing-library/react");
const { useAttachmentPreview, TEXT_PREVIEW_BYTES } = await import("./attachment-preview");
type PreviewSource = import("./attachment-preview").PreviewSource;

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
const realFetch = globalThis.fetch;
let created: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
	created = [];
	revoked = [];
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
			await waitFor(() => expect(dialog()).toBeNull());
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
		await act(() => fireEvent.click(screen.getByRole("button", { name: "Close dialog" })));
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
