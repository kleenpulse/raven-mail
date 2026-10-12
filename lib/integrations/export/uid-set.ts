/** IMAP UIDs are unsigned 32-bit. */
export const MAX_UID = 4_294_967_295;

/** Ascending UIDs → compact IMAP sequence set: [1,2,3,7,9,10] → "1:3,7,9:10". */
export function compressUids(uids: readonly number[]): string {
	const sorted = [...new Set(uids)].sort((a, b) => a - b);
	const parts: string[] = [];
	for (let i = 0; i < sorted.length; ) {
		const start = sorted[i]!;
		let end = start;
		while (i + 1 < sorted.length && sorted[i + 1] === end + 1) end = sorted[++i]!;
		parts.push(start === end ? String(start) : `${start}:${end}`);
		i++;
	}
	return parts.join(",");
}

/**
 * Strict parser for client-supplied sets: no `*`, no 0, no reversed ranges, and
 * never more than `max` UIDs — "1:*" must not turn into a whole-folder fetch.
 */
export function parseUidSet(set: string, { max }: { max: number }): number[] {
	if (!/^\d+(?::\d+)?(?:,\d+(?::\d+)?)*$/.test(set)) throw new Error("Invalid UID set.");
	const out: number[] = [];
	for (const part of set.split(",")) {
		const [a, b = a] = part.split(":").map(Number) as [number, number?];
		if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b > MAX_UID || b < a) {
			throw new Error("Invalid UID range.");
		}
		if (out.length + (b - a + 1) > max) throw new Error("Too many UIDs.");
		for (let uid = a; uid <= b; uid++) out.push(uid);
	}
	return [...new Set(out)].sort((x, y) => x - y);
}
