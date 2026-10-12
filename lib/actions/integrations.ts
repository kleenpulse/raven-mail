"use server";

import { z } from "zod";
import { requireSession } from "@/lib/actions/auth";
import { IntegrationError, toIntegrationError } from "@/lib/integrations/errors";
import {
	disconnect,
	logExport,
	renameConnection,
	rotateSigningSecret,
	setConnectionPaused,
} from "@/lib/integrations/service";
import { logExportSchema, type ConnectionDTO } from "@/lib/integrations/types";

// Fast, DB-only mutations. Anything that talks to a webhook (connect, test,
// share, brief) is a route handler: actions run one at a time per client.

export type IntegrationActionResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: string; code: string; hint?: string };

function failure(err: unknown): IntegrationActionResult<never> {
	const error = toIntegrationError(err);
	if (error.code === "internal") console.error("[integrations]", error.cause ?? error);
	return { ok: false, error: error.message, code: error.code, hint: error.hint };
}

function invalid(error: z.ZodError): IntegrationActionResult<never> {
	return { ok: false, error: error.issues[0]?.message ?? "Invalid request.", code: "invalid_request" };
}

const idSchema = z.uuid();

const renameSchema = z.object({
	id: idSchema,
	label: z.string().trim().min(1, "Give it a name.").max(60, "Keep it under 60 characters."),
});

// requireSession() stays outside try: redirect() works by throwing.

export async function renameIntegrationAction(input: z.input<typeof renameSchema>): Promise<IntegrationActionResult<ConnectionDTO>> {
	const session = await requireSession();
	const parsed = renameSchema.safeParse(input);
	if (!parsed.success) return invalid(parsed.error);
	try {
		return { ok: true, data: await renameConnection(session, parsed.data.id, parsed.data.label) };
	} catch (err) {
		return failure(err);
	}
}

const pauseSchema = z.object({ id: idSchema, paused: z.boolean() });

export async function setIntegrationPausedAction(input: z.input<typeof pauseSchema>): Promise<IntegrationActionResult<ConnectionDTO>> {
	const session = await requireSession();
	const parsed = pauseSchema.safeParse(input);
	if (!parsed.success) return invalid(parsed.error);
	try {
		return { ok: true, data: await setConnectionPaused(session, parsed.data.id, parsed.data.paused) };
	} catch (err) {
		return failure(err);
	}
}

export async function disconnectIntegrationAction(id: string): Promise<IntegrationActionResult<null>> {
	const session = await requireSession();
	const parsed = idSchema.safeParse(id);
	if (!parsed.success) return invalid(parsed.error);
	try {
		await disconnect(session, parsed.data);
		return { ok: true, data: null };
	} catch (err) {
		return failure(err);
	}
}

export async function rotateSigningSecretAction(id: string): Promise<IntegrationActionResult<{ signingSecret: string }>> {
	const session = await requireSession();
	const parsed = idSchema.safeParse(id);
	if (!parsed.success) return invalid(parsed.error);
	try {
		return { ok: true, data: await rotateSigningSecret(session, parsed.data) };
	} catch (err) {
		return failure(err);
	}
}

/** Best effort: an export works without a database; this only files it in the activity log. */
export async function logExportAction(input: z.input<typeof logExportSchema>): Promise<IntegrationActionResult<null>> {
	const session = await requireSession();
	const parsed = logExportSchema.safeParse(input);
	if (!parsed.success) return invalid(parsed.error);
	try {
		await logExport(session, parsed.data);
		return { ok: true, data: null };
	} catch (err) {
		return err instanceof IntegrationError && err.code.startsWith("db_") ? { ok: true, data: null } : failure(err);
	}
}
