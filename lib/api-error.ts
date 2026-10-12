/** A failed `{ ok: false }` API answer, with the catalog's code and fix when present. */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly hint?: string;
	readonly retryable: boolean;
	readonly retryAfterMs?: number;

	constructor(
		message: string,
		{ status, code = "error", hint, retryable = false, retryAfterMs }: {
			status: number;
			code?: string;
			hint?: string;
			retryable?: boolean;
			retryAfterMs?: number;
		},
	) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.hint = hint;
		this.retryable = retryable;
		this.retryAfterMs = retryAfterMs;
	}
}

type ErrorBody = { ok: false; error: string; code?: string; hint?: string; retryable?: boolean; retryAfterMs?: number };

export async function readApiError(res: Response): Promise<ApiError> {
	const body = (await res.json().catch(() => null)) as ErrorBody | null;
	return new ApiError(body?.error ?? `Request failed (${res.status})`, {
		status: res.status,
		code: body?.code,
		hint: body?.hint,
		retryable: body?.retryable ?? res.status >= 500,
		retryAfterMs: body?.retryAfterMs,
	});
}

/** Network failures (offline, DNS, reset) never reach an HTTP status. */
export function toApiError(err: unknown): ApiError {
	if (err instanceof ApiError) return err;
	if (err instanceof TypeError) {
		return new ApiError("Couldn't reach Raven.", {
			status: 0,
			code: "network",
			hint: "Check your connection and try again.",
			retryable: true,
		});
	}
	return new ApiError(err instanceof Error ? err.message : "Something went wrong.", { status: 0, code: "internal" });
}
