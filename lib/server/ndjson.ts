import "server-only";

const encoder = new TextEncoder();

/**
 * Streams an async iterable as NDJSON, one event per line, pulled only as fast
 * as the client reads. `application/x-ndjson` also keeps Next's compression
 * (which buffers) out of the way. A crash mid-stream becomes an in-band error
 * event, since the 200 status has already gone out.
 */
export function ndjsonResponse(
	events: AsyncIterable<unknown>,
	{ signal, label, crashEvent }: { signal: AbortSignal; label: string; crashEvent: unknown },
): Response {
	const iterator = events[Symbol.asyncIterator]();
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await iterator.next();
				if (next.done || signal.aborted) {
					controller.close();
					return;
				}
				controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
			} catch (err) {
				if (!signal.aborted) {
					console.error(`[${label}]`, err);
					controller.enqueue(encoder.encode(`${JSON.stringify(crashEvent)}\n`));
				}
				controller.close();
			}
		},
		async cancel() {
			await iterator.return?.(undefined);
		},
	});
	return new Response(stream, {
		headers: {
			"Content-Type": "application/x-ndjson; charset=utf-8",
			"Cache-Control": "private, no-store",
			"X-Accel-Buffering": "no",
		},
	});
}
