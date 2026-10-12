import { z } from "zod";
import { assertIdle, startRun } from "@/lib/dev/test-runner";
import { HttpError, readJson, requireApiSession, route } from "@/lib/server/guard";
import { ndjsonResponse } from "@/lib/server/ndjson";

export const maxDuration = 300;

// No free-form input reaches the spawned process: the only knob is a boolean.
const runSchema = z.object({ coverage: z.boolean().default(true) }).strict();

/** Dev-only: runs the test suite and streams progress for /dev/tests. */
export const POST = route(async (request) => {
	if (process.env.NODE_ENV === "production") throw new HttpError(404, "Not found.", "not_found");
	await requireApiSession();
	const { coverage } = await readJson(request, runSchema);
	assertIdle();
	return ndjsonResponse(startRun({ coverage, signal: request.signal }), {
		signal: request.signal,
		label: "dev/tests",
		crashEvent: { type: "error", message: "The test runner crashed." },
	});
});
