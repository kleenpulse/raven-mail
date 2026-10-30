/**
 * A Server-Timing header value: `wait;dur=12.3, connect;dur=210`. The browser's
 * network panel shows each phase in the request's Timing tab. Same-origin only:
 * without Timing-Allow-Origin no other site can read it.
 */
export function serverTiming(phases: Record<string, number>): string {
	return Object.entries(phases)
		.filter(([name, ms]) => /^[a-z][a-z0-9_-]*$/i.test(name) && Number.isFinite(ms))
		.map(([name, ms]) => `${name};dur=${Math.max(0, Math.round(ms * 10) / 10)}`)
		.join(", ");
}
