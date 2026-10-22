import { z } from "zod";
import { MAX_REMIND_DAYS } from "./when";

/** A `RemindChoice` from the client: preset days, or a time the user picked. */
export const remindSchema = z.union([
	z.object({ days: z.number().int().min(1).max(MAX_REMIND_DAYS) }),
	z.object({ at: z.iso.datetime({ offset: true }) }),
]);
