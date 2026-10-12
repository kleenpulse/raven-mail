import { describe, expect, test } from "bun:test";
import { readNdjson } from "@/lib/ndjson-client";

function streamOf(parts: Uint8Array[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const p of parts) controller.enqueue(p);
			controller.close();
		},
	});
}

async function collect(parts: Uint8Array[]) {
	const out: unknown[] = [];
	await readNdjson(streamOf(parts), (e) => out.push(e));
	return out;
}

describe("readNdjson", () => {
	test("lines split across chunks, blank lines skipped, final line without newline", async () => {
		const text = '{"a":1}\n\n{"b":2}\n{"c":3}';
		const bytes = new TextEncoder().encode(text);
		const parts = [bytes.slice(0, 3), bytes.slice(3, 11), bytes.slice(11)];
		expect(await collect(parts)).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
	});

	test("a multi-byte character split between chunks", async () => {
		const bytes = new TextEncoder().encode('{"t":"Ünïcödé ✓"}\n');
		const split = bytes.indexOf(0x9c); // inside ✓ (e2 9c 93)
		expect(await collect([bytes.slice(0, split), bytes.slice(split)])).toEqual([{ t: "Ünïcödé ✓" }]);
	});

	test("malformed JSON throws", async () => {
		await expect(collect([new TextEncoder().encode("{nope}\n")])).rejects.toThrow();
	});
});
