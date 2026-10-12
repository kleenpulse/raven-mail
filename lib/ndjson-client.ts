/**
 * Reads an NDJSON body event by event. Lines may be split anywhere across
 * chunks (even inside a multi-byte character); a last line without a trailing
 * newline still counts.
 */
export async function readNdjson<T>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const flush = (final: boolean) => {
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (line) onEvent(JSON.parse(line) as T);
			newline = buffer.indexOf("\n");
		}
		if (final && buffer.trim()) {
			onEvent(JSON.parse(buffer.trim()) as T);
			buffer = "";
		}
	};
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		flush(false);
	}
	buffer += decoder.decode();
	flush(true);
}
