/*
 * Small statistics for the Kage eval. No server imports, so the /dev/kage
 * board can draw intervals with the same math the CLI prints.
 */

export type Rate = { hits: number; total: number };

/** How two engines did on the same cases. `kageOnly` = Kage right, keywords wrong. */
export type Agreement = { both: number; kageOnly: number; heuristicOnly: number; neither: number };

/**
 * Wilson 95% interval for a hit rate. With 20 cases one miss moves the rate
 * five points, so a bare percentage overstates what the eval knows.
 */
export function wilson(r: Rate, z = 1.96): [number, number] | null {
	if (!r.total) return null;
	const p = r.hits / r.total;
	const z2 = z * z;
	const denom = 1 + z2 / r.total;
	const centre = (p + z2 / (2 * r.total)) / denom;
	const half = (z * Math.sqrt((p * (1 - p)) / r.total + z2 / (4 * r.total * r.total))) / denom;
	return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * Expected calibration error: answers grouped into equal-width confidence
 * bins, then the gap between stated confidence and actual accuracy, weighted
 * by bin size. 0 means "80% sure" is right 80% of the time.
 */
export function ece(points: { confidence: number; ok: boolean }[], bins = 10): number {
	if (!points.length) return 0;
	const sum = Array.from({ length: bins }, () => ({ n: 0, conf: 0, hits: 0 }));
	for (const { confidence, ok } of points) {
		const b = sum[Math.min(bins - 1, Math.max(0, Math.floor(confidence * bins)))]!;
		b.n += 1;
		b.conf += confidence;
		if (ok) b.hits += 1;
	}
	let error = 0;
	for (const b of sum) if (b.n) error += (b.n / points.length) * Math.abs(b.conf / b.n - b.hits / b.n);
	return error;
}

export function emptyAgreement(): Agreement {
	return { both: 0, kageOnly: 0, heuristicOnly: 0, neither: 0 };
}
