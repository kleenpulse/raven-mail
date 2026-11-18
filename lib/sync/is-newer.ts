/** ISO strings compare lexicographically; null loses to any stamp. */
export function isNewer(a: string | null, b: string | null): boolean {
	if (!a) return false;
	if (!b) return true;
	return a > b;
}
