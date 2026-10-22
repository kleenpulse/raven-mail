import { runKageEval, writeKageEval } from "@/lib/dev/kage-eval";
import { HttpError, json, requireApiSession, route } from "@/lib/server/guard";

// Scoring Jev too (when its key works) makes a paid call per case.
export const maxDuration = 300;

/** Dev-only: re-scores Kage on the labeled fixtures for /dev/kage. No input. */
export const POST = route(async () => {
	if (process.env.NODE_ENV === "production") throw new HttpError(404, "Not found.", "not_found");
	await requireApiSession();
	const report = await runKageEval({ apiKey: process.env.TYPESAFE_API_KEY?.trim() });
	await writeKageEval(report);
	return json({ ok: true, data: report });
});
