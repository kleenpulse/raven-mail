import "server-only";
import { randomUUID } from "node:crypto";
import { isLoopbackHost } from "@/lib/auth/ip";
import { dbConfigured, dbError } from "@/lib/db";
import type { IntegrationRow } from "@/lib/db/schema";
import { jevStatus } from "@/lib/jev/client";
import type { MailSession } from "@/lib/session";
import { briefCard, emailCard } from "./cards";
import { fingerprint, openTarget, sealTarget, tenantKey } from "./crypto";
import { deliver } from "./deliver";
import { jevDiagnostics, pinnedModel } from "./diagnostics/jev";
import { mailDiagnostics } from "./diagnostics/mail";
import { IntegrationError, toIntegrationError } from "./errors";
import { formatBytes } from "./export/progress";
import type { Outbound } from "./http";
import { discordLookup, judgeDiscord, readDiscordLookup } from "./providers/discord";
import { PROVIDERS, type ParsedTarget, type Target } from "./providers";
import * as repo from "./repo";
import { outboundPolicy, safeFetch } from "./safe-fetch";
import { newSigningSecret } from "./signing";
import { nextHealth } from "./status";
import { runSteps, type Step } from "./steps";
import {
	MAX_CONNECTIONS,
	type CheckResult,
	type ConnectInput,
	type ConnectionKind,
	type ConnectionMeta,
	type ConnectResult,
	type DbProblem,
	type DeliveryReport,
	type EndpointSecurity,
	type EventOutcome,
	type IntegrationsOverview,
	type LogExportInput,
	type SendBriefInput,
	type ShareEmailInput,
	type StepEvent,
} from "./types";

const NAMES: Record<ConnectionKind, string> = { slack: "Slack", discord: "Discord", webhook: "The endpoint" };

export type Recorder = (event: repo.NewEvent) => void;

function problem(err: IntegrationError): DbProblem {
	return { code: err.code, message: err.message, hint: err.hint };
}

function security(endpoint: { host: string; secure: boolean }): EndpointSecurity {
	if (endpoint.secure) return "tls";
	return isLoopbackHost(endpoint.host) ? "plain" : "starttls";
}

/** Absolute origin for links inside shared messages. */
export function appOrigin(request: Request): string {
	const configured = process.env.APP_URL?.trim();
	if (configured) return new URL(configured).origin;
	const url = new URL(request.url);
	const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
	const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
	return `${proto}://${host}`;
}

/* ── Overview ────────────────────────────────────────────────────────────── */

export async function getOverview(session: MailSession): Promise<IntegrationsOverview> {
	const jev = await jevStatus(session);
	const builtins: IntegrationsOverview["builtins"] = {
		mail: {
			email: session.email,
			provider: session.dev ? "dev" : session.provider,
			dev: Boolean(session.dev),
			imap: { host: session.imap.host, port: session.imap.port, security: security(session.imap) },
			smtp: { host: session.smtp.host, port: session.smtp.port, security: security(session.smtp) },
			lastCheck: null,
		},
		jev: { configured: jev.source !== null, source: jev.source, model: pinnedModel(), lastCheck: null },
	};
	const base = { builtins, syncedAt: new Date().toISOString() };

	if (!dbConfigured()) {
		return { ...base, dbReady: false, dbError: problem(new IntegrationError("db_not_configured")), connections: null, lastExport: null };
	}
	const accountKey = tenantKey(session);
	try {
		const [rows, checks, lastExport] = await Promise.all([
			repo.listConnections(accountKey),
			repo.latestChecks(accountKey),
			repo.lastExportEvent(accountKey),
		]);
		builtins.mail.lastCheck = checks.mail;
		builtins.jev.lastCheck = checks.jev;
		return { ...base, dbReady: true, dbError: null, connections: rows.map(repo.toConnectionDTO), lastExport };
	} catch (err) {
		return { ...base, dbReady: false, dbError: problem(dbError(err)), connections: null, lastExport: null };
	}
}

/* ── Delivery bookkeeping ────────────────────────────────────────────────── */

async function applyOutcome(
	accountKey: string,
	row: IntegrationRow,
	outcome: { ok: true } | { ok: false; error: IntegrationError },
): Promise<IntegrationRow> {
	const health = nextHealth({ status: row.status, failureStreak: row.failureStreak }, outcome);
	const now = new Date();
	return repo.updateConnection(accountKey, row.id, {
		status: health.status,
		failureStreak: health.failureStreak,
		...(outcome.ok
			? { lastOkAt: now }
			: { lastErrorAt: now, lastError: { code: outcome.error.code, message: outcome.error.message } }),
	});
}

function send(kind: ConnectionKind, outbound: Outbound, signal: AbortSignal | undefined, budget?: { maxAttempts: number; budgetMs: number }) {
	const policy = outboundPolicy();
	return deliver((s) => safeFetch(outbound, { policy, signal: s }), PROVIDERS[kind].judge, {
		signal,
		idempotent: kind === "webhook",
		...budget,
	});
}

/** Unlock a stored connection; an unreadable secret flags it for reconnecting. */
async function unlock(accountKey: string, row: IntegrationRow): Promise<Target> {
	try {
		return openTarget(row.secret, accountKey, row.id);
	} catch (err) {
		const error = toIntegrationError(err);
		await applyOutcome(accountKey, row, { ok: false, error }).catch(() => {});
		throw error;
	}
}

/* ── Connect ─────────────────────────────────────────────────────────────── */

type ConnectCtx = {
	id: string;
	parsed?: ParsedTarget;
	fingerprint?: string;
	replacing?: IntegrationRow;
	target?: Target;
	meta: ConnectionMeta;
	revealSecret?: string;
	label?: string;
	latencyMs?: number;
	row?: IntegrationRow;
};

function lookupStep(): Step<ConnectCtx> {
	return {
		id: "lookup",
		label: "Look up webhook",
		run: async (ctx, signal) => {
			const res = await safeFetch(discordLookup(ctx.target!), { signal });
			const verdict = judgeDiscord(res);
			if (verdict) throw verdict;
			ctx.meta = { ...ctx.meta, ...readDiscordLookup(res) };
			return ctx.meta.webhookName ? `Found “${ctx.meta.webhookName}”` : "Webhook found";
		},
	};
}

/** Streamed: validate → (Discord: look up) → test delivery → seal + save. Nothing is saved unless the test lands. */
export async function* connectFlow(session: MailSession, input: ConnectInput, signal?: AbortSignal): AsyncGenerator<StepEvent<ConnectResult>, void> {
	const accountKey = tenantKey(session);
	const provider = PROVIDERS[input.kind];
	const ctx: ConnectCtx = { id: input.replaceId ?? randomUUID(), meta: {} };

	const steps: Step<ConnectCtx>[] = [
		{
			id: "validate",
			label: "Check URL",
			run: async (c) => {
				c.parsed = provider.parse(input.url, outboundPolicy());
				if (input.replaceId) {
					c.replacing = await repo.getConnection(accountKey, input.replaceId);
					if (c.replacing.kind !== input.kind) throw new IntegrationError("wrong_provider_url");
				} else if ((await repo.countConnections(accountKey)) >= MAX_CONNECTIONS) {
					throw new IntegrationError("limit_reached");
				}
				c.fingerprint = fingerprint(accountKey, c.parsed.fingerprintKey);
				const existing = await repo.findByFingerprint(accountKey, c.fingerprint);
				if (existing && existing.id !== input.replaceId) {
					throw new IntegrationError("duplicate", { message: `Already connected as “${existing.label}”.` });
				}

				// Reconnecting keeps the signing secret receivers already verify with.
				let signingSecret: string | undefined;
				if (input.kind === "webhook" && input.signed !== false) {
					try {
						signingSecret = c.replacing ? openTarget(c.replacing.secret, accountKey, c.replacing.id).signingSecret : undefined;
					} catch {
						signingSecret = undefined;
					}
					if (!signingSecret) {
						signingSecret = newSigningSecret();
						c.revealSecret = signingSecret;
					}
				}
				c.target = { url: c.parsed.url, ...(signingSecret ? { signingSecret } : {}) };
				c.meta = { ...c.parsed.meta, ...(input.kind === "webhook" ? { signed: Boolean(signingSecret) } : {}) };
				return c.parsed.hint;
			},
		},
		...(input.kind === "discord" ? [lookupStep()] : []),
		{
			id: "test",
			label: input.kind === "webhook" ? "Send signed ping" : "Send test message",
			run: async (c, s) => {
				c.label = input.label?.trim() || c.replacing?.label || c.meta.webhookName || c.parsed!.defaultLabel;
				const delivery = await send(input.kind, provider.ping(c.target!, c.label), s, { maxAttempts: 2, budgetMs: 12_000 });
				if (!delivery.ok) throw delivery.error;
				c.latencyMs = delivery.latencyMs;
				return `${NAMES[input.kind]} answered ${delivery.response.status} in ${delivery.latencyMs} ms`;
			},
		},
		{
			id: "save",
			label: "Save securely",
			run: async (c) => {
				const values = {
					label: c.label!,
					secret: sealTarget(c.target!, accountKey, c.id),
					fingerprint: c.fingerprint!,
					hint: c.parsed!.hint,
					meta: c.meta,
				};
				const now = new Date();
				c.row = c.replacing
					? await repo.updateConnection(accountKey, c.id, {
							...values,
							status: "active",
							failureStreak: 0,
							lastOkAt: now,
							lastError: null,
						})
					: await repo.insertConnection({ id: c.id, accountKey, kind: input.kind, ...values, lastOkAt: now });
				return "Encrypted at rest (AES-256-GCM)";
			},
		},
	];

	const end = yield* runSteps(
		steps,
		ctx,
		(c) => ({ connection: repo.toConnectionDTO(c.row!), ...(c.revealSecret ? { signingSecret: c.revealSecret } : {}) }),
		{ signal },
	);
	if (!end) return;
	const label = ctx.label ?? ctx.replacing?.label ?? ctx.parsed?.defaultLabel ?? null;
	await repo.tryRecordEvent({
		accountKey,
		integrationId: end.ok || ctx.replacing ? ctx.id : null,
		target: input.kind,
		action: input.replaceId ? "reconnect" : "connect",
		outcome: end.ok ? "ok" : "error",
		label,
		summary: end.ok ? (input.replaceId ? "Reconnected with a new URL" : "Connected — test message delivered") : `Couldn't connect: ${end.error.message}`,
		errorCode: end.ok ? null : end.error.code,
		latencyMs: ctx.latencyMs ?? null,
		attempts: null,
	});
}

/* ── Checks ──────────────────────────────────────────────────────────────── */

type TestCtx = { row?: IntegrationRow; target?: Target; meta: ConnectionMeta; latencyMs?: number };

async function* testConnectionFlow(session: MailSession, id: string, signal?: AbortSignal): AsyncGenerator<StepEvent<CheckResult>, void> {
	const accountKey = tenantKey(session);
	const ctx: TestCtx = { meta: {} };
	let kind: ConnectionKind | null = null;

	const steps: Step<TestCtx>[] = [
		{
			id: "unlock",
			label: "Unlock saved URL",
			run: async (c) => {
				c.row = await repo.getConnection(accountKey, id);
				kind = c.row.kind;
				c.target = await unlock(accountKey, c.row);
				return c.row.hint;
			},
		},
		{
			id: "test",
			label: "Send test message",
			run: async (c, s) => {
				const row = c.row!;
				const delivery = await send(row.kind, PROVIDERS[row.kind].ping(c.target!, row.label), s, { maxAttempts: 2, budgetMs: 12_000 });
				c.row = await applyOutcome(accountKey, row, delivery.ok ? { ok: true } : { ok: false, error: delivery.error });
				if (!delivery.ok) throw delivery.error;
				c.latencyMs = delivery.latencyMs;
				return `${NAMES[row.kind]} answered ${delivery.response.status} in ${delivery.latencyMs} ms`;
			},
		},
	];

	const end = yield* runSteps(
		steps,
		ctx,
		(c) => ({ summary: "Test message delivered", outcome: "ok" as const, connection: repo.toConnectionDTO(c.row!) }),
		{ signal },
	);
	if (!end || !ctx.row || !kind) return;
	await repo.tryRecordEvent({
		accountKey,
		integrationId: ctx.row.id,
		target: kind,
		action: "test",
		outcome: end.ok ? "ok" : "error",
		label: ctx.row.label,
		summary: end.ok ? "Test message delivered" : `Test failed: ${end.error.message}`,
		errorCode: end.ok ? null : end.error.code,
		latencyMs: ctx.latencyMs ?? null,
		attempts: null,
	});
}

async function* builtinCheckFlow(session: MailSession, target: "mail" | "jev", signal?: AbortSignal): AsyncGenerator<StepEvent<CheckResult>, void> {
	const started = performance.now();
	const run = target === "mail" ? mailDiagnostics(session) : { ...jevDiagnostics(session), cleanup: () => {} };
	const count = run.steps.length;
	let end;
	try {
		end = yield* runSteps(
			run.steps as Step<object>[],
			run.ctx,
			(_ctx, warned) => ({
				summary: warned ? "Passed with warnings" : `All ${count} checks passed`,
				outcome: (warned ? "warn" : "ok") as EventOutcome,
			}),
			{ signal },
		);
	} finally {
		run.cleanup();
	}
	if (!end || !dbConfigured()) return;
	const outcome: EventOutcome = end.ok ? (end.warned ? "warn" : "ok") : "error";
	await repo.tryRecordEvent({
		accountKey: tenantKey(session),
		integrationId: null,
		target,
		action: "check",
		outcome,
		label: target === "mail" ? session.email : "Jev",
		summary: end.ok ? end.result.summary : end.error.message,
		errorCode: end.ok ? null : end.error.code,
		latencyMs: Math.round(performance.now() - started),
		attempts: null,
	});
}

export function checkFlow(
	session: MailSession,
	input: { target: "mail" | "jev" } | { id: string },
	signal?: AbortSignal,
): AsyncGenerator<StepEvent<CheckResult>, void> {
	return "id" in input ? testConnectionFlow(session, input.id, signal) : builtinCheckFlow(session, input.target, signal);
}

/* ── Share + brief (explicit user actions) ──────────────────────────────── */

async function deliverTo(
	session: MailSession,
	integrationId: string,
	build: (target: Target, kind: ConnectionKind) => Outbound,
	describeOk: string,
	describeFail: (message: string) => string,
	action: "share" | "brief",
	{ signal, record }: { signal?: AbortSignal; record: Recorder },
): Promise<DeliveryReport> {
	const accountKey = tenantKey(session);
	const row = await repo.getConnection(accountKey, integrationId);
	if (row.status === "paused") throw new IntegrationError("paused");
	const target = await unlock(accountKey, row);
	const delivery = await send(row.kind, build(target, row.kind), signal);
	const updated = await applyOutcome(accountKey, row, delivery.ok ? { ok: true } : { ok: false, error: delivery.error });
	record({
		accountKey,
		integrationId: row.id,
		target: row.kind,
		action,
		outcome: delivery.ok ? "ok" : delivery.error.code === "unconfirmed" ? "warn" : "error",
		label: row.label,
		summary: delivery.ok ? describeOk : describeFail(delivery.error.message),
		errorCode: delivery.ok ? null : delivery.error.code,
		latencyMs: delivery.latencyMs,
		attempts: delivery.attempts,
	});
	if (!delivery.ok) throw delivery.error;
	return { attempts: delivery.attempts, latencyMs: delivery.latencyMs, connection: repo.toConnectionDTO(updated) };
}

const quoteSubject = (subject: string) => `“${subject.length > 80 ? `${subject.slice(0, 79)}…` : subject || "(no subject)"}”`;

export function shareEmail(session: MailSession, input: ShareEmailInput, origin: string, opts: { signal?: AbortSignal; record: Recorder }) {
	const card = emailCard(input.email, origin, input.note);
	return deliverTo(
		session,
		input.integrationId,
		(target, kind) => PROVIDERS[kind].email(target, card),
		`Shared ${quoteSubject(input.email.subject)}`,
		(message) => `Couldn't share ${quoteSubject(input.email.subject)}: ${message}`,
		"share",
		opts,
	);
}

export function sendBrief(session: MailSession, input: SendBriefInput, origin: string, opts: { signal?: AbortSignal; record: Recorder }) {
	const card = briefCard(input, origin);
	const n = input.items.length;
	return deliverTo(
		session,
		input.integrationId,
		(target, kind) => PROVIDERS[kind].brief(target, card),
		`Sent the daily brief (${n} ${n === 1 ? "email" : "emails"})`,
		(message) => `Couldn't send the daily brief: ${message}`,
		"brief",
		opts,
	);
}

/* ── Management (fast, DB-only — server actions) ────────────────────────── */

export async function renameConnection(session: MailSession, id: string, label: string) {
	const accountKey = tenantKey(session);
	const before = await repo.getConnection(accountKey, id);
	const row = await repo.updateConnection(accountKey, id, { label });
	await repo.tryRecordEvent({
		accountKey,
		integrationId: id,
		target: row.kind,
		action: "rename",
		outcome: "ok",
		label,
		summary: `Renamed “${before.label}” to “${label}”`,
		errorCode: null,
		latencyMs: null,
		attempts: null,
	});
	return repo.toConnectionDTO(row);
}

export async function setConnectionPaused(session: MailSession, id: string, paused: boolean) {
	const accountKey = tenantKey(session);
	const row = await repo.updateConnection(accountKey, id, paused ? { status: "paused" } : { status: "active", failureStreak: 0 });
	await repo.tryRecordEvent({
		accountKey,
		integrationId: id,
		target: row.kind,
		action: paused ? "pause" : "resume",
		outcome: "ok",
		label: row.label,
		summary: paused ? "Paused — nothing will be sent" : "Resumed",
		errorCode: null,
		latencyMs: null,
		attempts: null,
	});
	return repo.toConnectionDTO(row);
}

export async function disconnect(session: MailSession, id: string) {
	const accountKey = tenantKey(session);
	const row = await repo.deleteConnection(accountKey, id);
	await repo.tryRecordEvent({
		accountKey,
		integrationId: null,
		target: row.kind,
		action: "disconnect",
		outcome: "ok",
		label: row.label,
		summary: "Disconnected — its saved URL was deleted",
		errorCode: null,
		latencyMs: null,
		attempts: null,
	});
}

/** Generic webhooks only: new signing secret, returned exactly once. */
export async function rotateSigningSecret(session: MailSession, id: string): Promise<{ signingSecret: string }> {
	const accountKey = tenantKey(session);
	const row = await repo.getConnection(accountKey, id);
	if (row.kind !== "webhook") throw new IntegrationError("wrong_provider_url", { message: "Only generic webhooks have a signing secret." });
	const target = await unlock(accountKey, row);
	const signingSecret = newSigningSecret();
	await repo.updateConnection(accountKey, id, {
		secret: sealTarget({ url: target.url, signingSecret }, accountKey, id),
		meta: { ...row.meta, signed: true },
	});
	await repo.tryRecordEvent({
		accountKey,
		integrationId: id,
		target: "webhook",
		action: "rotate",
		outcome: "ok",
		label: row.label,
		summary: "Rotated the signing secret — update your receiver",
		errorCode: null,
		latencyMs: null,
		attempts: null,
	});
	return { signingSecret };
}

export async function logExport(session: MailSession, input: LogExportInput) {
	if (!dbConfigured()) return;
	const folder = input.folder === "INBOX" ? "Inbox" : input.folder;
	const size = formatBytes(input.bytes);
	const count = (n: number) => n.toLocaleString("en-US");
	const summary =
		input.outcome === "completed"
			? `Exported ${count(input.saved)} ${input.saved === 1 ? "message" : "messages"} from ${folder} (${size})`
			: `${input.outcome === "cancelled" ? "Cancelled" : input.outcome === "failed" ? "Stopped" : "Saved part of"} the ${folder} export at ${count(input.saved)} of ${count(input.total)} (${size})`;
	await repo.tryRecordEvent({
		accountKey: tenantKey(session),
		integrationId: null,
		target: "export",
		action: "export",
		outcome: input.outcome === "completed" ? "ok" : input.outcome === "failed" ? "error" : "warn",
		label: folder,
		summary,
		errorCode: input.errorCode ?? null,
		latencyMs: null,
		attempts: null,
	});
}
