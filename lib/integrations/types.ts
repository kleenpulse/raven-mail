import { z } from "zod";

/*
 * Shared vocabulary for the Integrations tab. Pure: imported by the DB schema,
 * route handlers, server actions and client components alike.
 */

export const CONNECTION_KINDS = ["slack", "discord", "webhook"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export const CONNECTION_STATUSES = ["active", "paused", "error"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const EVENT_TARGETS = ["mail", "jev", "slack", "discord", "webhook", "export"] as const;
export type EventTarget = (typeof EVENT_TARGETS)[number];

export const EVENT_ACTIONS = [
	"connect",
	"reconnect",
	"test",
	"check",
	"share",
	"brief",
	"pause",
	"resume",
	"rename",
	"rotate",
	"disconnect",
	"export",
] as const;
export type EventAction = (typeof EVENT_ACTIONS)[number];

export const EXPORT_RANGES = ["all", "365d", "30d"] as const;
export type ExportRange = (typeof EXPORT_RANGES)[number];

export const EVENT_OUTCOMES = ["ok", "warn", "error"] as const;
export type EventOutcome = (typeof EVENT_OUTCOMES)[number];

/** Catalog ids: two built-ins, the connectable kinds, and the export tool. */
export type CatalogId = "mail" | "jev" | ConnectionKind | "export";

export const MAX_CONNECTIONS = 10;
export const PREVIEW_MAX = 280;
export const NOTE_MAX = 280;
export const BRIEF_MAX = 5;

/** Non-secret facts learned while connecting, safe to show in the UI. */
export type ConnectionMeta = {
	/** Discord: the webhook's own name and ids. */
	webhookName?: string;
	channelId?: string;
	guildId?: string;
	/** Generic webhook: deliveries carry Standard Webhooks signatures. */
	signed?: boolean;
	/** Generic webhook: recognised automation host (Zapier, Make, n8n…). */
	service?: string;
};

export type LastError = { code: string; message: string };

export type ConnectionDTO = {
	id: string;
	kind: ConnectionKind;
	label: string;
	status: ConnectionStatus;
	hint: string;
	meta: ConnectionMeta;
	failureStreak: number;
	lastOkAt: string | null;
	lastErrorAt: string | null;
	lastError: LastError | null;
	createdAt: string;
};

export type CheckSummary = {
	at: string;
	outcome: EventOutcome;
	summary: string;
	errorCode: string | null;
	latencyMs: number | null;
};

export type EndpointSecurity = "tls" | "starttls" | "plain";

export type MailBuiltin = {
	email: string;
	provider: string;
	dev: boolean;
	imap: { host: string; port: number; security: EndpointSecurity };
	smtp: { host: string; port: number; security: EndpointSecurity };
	lastCheck: CheckSummary | null;
};

export type JevBuiltin = {
	configured: boolean;
	/** "user" = a key saved in Settings, "server" = TYPESAFE_API_KEY. */
	source: "user" | "server" | null;
	model: string;
	lastCheck: CheckSummary | null;
};

export type DbProblem = { code: string; message: string; hint: string };

export type IntegrationsOverview = {
	dbReady: boolean;
	dbError: DbProblem | null;
	builtins: { mail: MailBuiltin; jev: JevBuiltin };
	/** `null` when the database is unavailable — the rest of the page still renders. */
	connections: ConnectionDTO[] | null;
	lastExport: IntegrationEventDTO | null;
	syncedAt: string;
};

export type IntegrationEventDTO = {
	id: number;
	integrationId: string | null;
	target: EventTarget;
	action: EventAction;
	outcome: EventOutcome;
	/** The connection's label when the event happened (survives rename/disconnect). */
	label: string | null;
	summary: string;
	errorCode: string | null;
	latencyMs: number | null;
	attempts: number | null;
	createdAt: string;
};

export type EventsPage = { events: IntegrationEventDTO[]; nextCursor: number | null };

export type ExportChunkPlan = { uids: string; count: number; bytes: number };

/** Everything the client needs to pull a folder down chunk by chunk. */
export type ExportPlan = {
	folder: string;
	range: ExportRange;
	/** IMAP UIDVALIDITY at planning time; chunks refuse to run if it changes. */
	uidValidity: string;
	total: number;
	bytes: number;
	chunks: ExportChunkPlan[];
};

/* ── Streamed step progress (NDJSON) ─────────────────────────────────────── */

export type StepStatus = "pending" | "running" | "ok" | "warn" | "error" | "skipped";
export type StepPlanItem = { id: string; label: string };

export type StepFailure = {
	code: string;
	message: string;
	hint?: string;
	step?: string;
	retryable: boolean;
};

export type StepEvent<R = unknown> =
	| { type: "plan"; steps: StepPlanItem[] }
	| { type: "step"; id: string; status: Exclude<StepStatus, "pending">; detail?: string; ms?: number }
	| { type: "done"; result: R }
	| ({ type: "error" } & StepFailure);

export type ConnectResult = { connection: ConnectionDTO; signingSecret?: string };
export type CheckResult = { summary: string; outcome: EventOutcome; connection?: ConnectionDTO };

export type DeliveryReport = { attempts: number; latencyMs: number; connection: ConnectionDTO };

/* ── Inputs ──────────────────────────────────────────────────────────────── */

const folder = z
	.string()
	.min(1)
	.max(512)
	.refine((v) => !/[\r\n]/.test(v), "Invalid folder.");
const uid = z.string().regex(/^\d{1,10}$/, "Invalid message id.");
const person = z.object({ name: z.string().max(200), address: z.string().max(320) });

export const connectInputSchema = z.object({
	kind: z.enum(CONNECTION_KINDS),
	url: z.string().trim().min(1, "Paste the webhook URL.").max(2048, "That URL is too long."),
	label: z.string().trim().max(60).optional(),
	/** Generic webhook only: sign deliveries (default on). */
	signed: z.boolean().optional(),
	/** Reconnect an existing connection in place (keeps its history). */
	replaceId: z.uuid().optional(),
});
export type ConnectInput = z.infer<typeof connectInputSchema>;

export const checkInputSchema = z.union([
	z.object({ target: z.enum(["mail", "jev"]) }),
	z.object({ id: z.uuid() }),
]);
export type CheckInput = z.infer<typeof checkInputSchema>;

export const sharedEmailSchema = z.object({
	folder,
	uid,
	messageId: z.string().max(998).nullish(),
	subject: z.string().max(300),
	from: person,
	date: z.string().max(64),
	preview: z.string().max(PREVIEW_MAX * 2),
});
export type SharedEmail = z.infer<typeof sharedEmailSchema>;

export const shareEmailSchema = z.object({
	integrationId: z.uuid(),
	email: sharedEmailSchema,
	note: z.string().trim().max(NOTE_MAX).optional(),
});
export type ShareEmailInput = z.infer<typeof shareEmailSchema>;

export const briefItemSchema = z.object({
	folder,
	uid,
	messageId: z.string().max(998).nullish(),
	subject: z.string().max(300),
	from: person,
	why: z.array(z.string().max(80)).max(4),
});
export type BriefDigestItem = z.infer<typeof briefItemSchema>;

export const sendBriefSchema = z.object({
	integrationId: z.uuid(),
	dateLabel: z.string().trim().min(1).max(60),
	items: z.array(briefItemSchema).min(1).max(BRIEF_MAX),
});
export type SendBriefInput = z.infer<typeof sendBriefSchema>;

export const exportPlanSchema = z.object({ folder, range: z.enum(EXPORT_RANGES) });
export type ExportPlanInput = z.infer<typeof exportPlanSchema>;

export const exportChunkSchema = z.object({
	folder,
	uidValidity: z.string().regex(/^\d{1,20}$/),
	uids: z.string().min(1).max(4000),
});
export type ExportChunkInput = z.infer<typeof exportChunkSchema>;

export const logExportSchema = z.object({
	folder,
	range: z.enum(EXPORT_RANGES),
	outcome: z.enum(["completed", "partial", "cancelled", "failed"]),
	total: z.number().int().min(0),
	saved: z.number().int().min(0),
	bytes: z.number().int().min(0),
	errorCode: z.string().max(64).optional(),
});
export type LogExportInput = z.infer<typeof logExportSchema>;
