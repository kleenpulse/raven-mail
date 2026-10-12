import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import type { ImapFlow } from "imapflow";
import { assertPublicMailHost } from "@/lib/auth/host-guard";
import { isLoopbackHost } from "@/lib/auth/ip";
import { devListFolders, isDevSession } from "@/lib/mail/dev-store";
import { acquireClient } from "@/lib/mail/imap";
import { verifySmtp } from "@/lib/mail/smtp";
import type { MailSession } from "@/lib/session";
import { sleep } from "../deliver";
import { IntegrationError } from "../errors";
import { netErrorCode } from "../net-errors";
import { warn, type Step, type StepOutcome } from "../steps";
import { classifyImapError, classifySmtpError } from "./classify";

type Ctx = { held?: { client: ImapFlow; release: () => void } };

const PROBE_TIMEOUT_MS = 10_000;
const CERT_WARN_DAYS = 14;
const QUOTA_WARN = 0.9;
const NOTABLE = ["IDLE", "CONDSTORE", "QRESYNC", "MOVE", "UIDPLUS", "SPECIAL-USE", "COMPRESS=DEFLATE", "QUOTA", "OBJECTID"];

const count = (n: number) => n.toLocaleString("en-US");

function gb(bytes: number): string {
	return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** TCP (and for implicit-TLS ports, a TLS handshake) without logging in. */
function probe(host: string, port: number, secure: boolean, signal?: AbortSignal): Promise<StepOutcome> {
	return new Promise((resolve, reject) => {
		const onError = (err: Error) => {
			socket.destroy();
			const code = netErrorCode(err);
			if (code === "cert_invalid") return reject(new IntegrationError("cert_invalid", { message: `The certificate for ${host} isn't trusted.`, cause: err }));
			if (code === "tls_failed") return reject(new IntegrationError("tls_failed", { message: `${host}:${port} didn't complete a TLS handshake.`, hint: "The port may expect STARTTLS, or be plain text.", cause: err }));
			if (code === "timeout") return reject(new IntegrationError("timeout", { message: `${host}:${port} didn't answer in time.`, cause: err }));
			reject(new IntegrationError("imap_unreachable", { message: `Couldn't open ${host}:${port}.`, cause: err }));
		};
		const socket = secure
			? tls.connect({
					host,
					port,
					servername: net.isIP(host) ? undefined : host,
					rejectUnauthorized: process.env.IMAP_REJECT_UNAUTHORIZED !== "false",
				})
			: net.connect({ host, port });
		socket.setTimeout(PROBE_TIMEOUT_MS, () => onError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
		signal?.addEventListener("abort", () => socket.destroy(), { once: true });
		socket.once("error", onError);
		socket.once(secure ? "secureConnect" : "connect", () => {
			let detail: StepOutcome;
			if (socket instanceof tls.TLSSocket) {
				const protocol = socket.getProtocol()?.replace("TLSv", "TLS ") ?? "TLS";
				const validTo = socket.getPeerCertificate()?.valid_to;
				const days = validTo ? Math.floor((Date.parse(validTo) - Date.now()) / 86_400_000) : null;
				detail =
					days === null
						? protocol
						: days < CERT_WARN_DAYS
							? warn(`${protocol} · certificate expires in ${Math.max(0, days)} days`)
							: `${protocol} · certificate valid ${days} more days`;
			} else if (isLoopbackHost(host)) {
				detail = `Local bridge on port ${port} · no TLS needed on loopback`;
			} else {
				detail = `Port ${port} open · upgrades with STARTTLS at sign-in`;
			}
			socket.end();
			resolve(detail);
		});
	});
}

function realSteps(session: MailSession): Step<Ctx>[] {
	const { imap, smtp, provider } = session;
	return [
		{
			id: "resolve",
			label: "Resolve host",
			run: async () => {
				// Same production rule as sign-in: custom hosts can't point at private networks.
				if (provider === "custom") {
					try {
						await assertPublicMailHost(imap.host);
					} catch (err) {
						throw new IntegrationError("private_address", { message: err instanceof Error ? err.message : undefined, cause: err });
					}
				}
				try {
					const addresses = await lookup(imap.host, { all: true });
					const first = addresses[0]?.address ?? "?";
					return `${imap.host} → ${first}${addresses.length > 1 ? ` (+${addresses.length - 1})` : ""}`;
				} catch (err) {
					throw new IntegrationError("dns_failed", { message: `Couldn't find ${imap.host}.`, cause: err });
				}
			},
		},
		{
			id: "secure",
			label: "Secure channel",
			run: (_ctx, signal) => probe(imap.host, imap.port, imap.secure, signal),
		},
		{
			id: "signin",
			label: "Sign in",
			run: async (ctx) => {
				ctx.held = await acquireClient(session);
				try {
					await ctx.held.client.connect();
				} catch (err) {
					throw classifyImapError(err, provider);
				}
				const { serverInfo, tls: tlsInfo } = ctx.held.client;
				const name = typeof serverInfo?.name === "string" ? ` · ${serverInfo.name}` : "";
				const channel = tlsInfo ? ` · ${tlsInfo.version.replace("TLSv", "TLS ")}${imap.secure ? "" : " via STARTTLS"}` : "";
				return `Signed in as ${session.email}${channel}${name}`;
			},
		},
		{
			id: "mailbox",
			label: "Read mailbox",
			run: async (ctx) => {
				const client = ctx.held!.client;
				try {
					const folders = await client.list();
					const inbox = await client.status("INBOX", { messages: true, unseen: true });
					return `${count(folders.length)} folders · Inbox ${count(inbox.messages ?? 0)} (${count(inbox.unseen ?? 0)} unread)`;
				} catch (err) {
					throw classifyImapError(err, provider);
				}
			},
		},
		{
			id: "features",
			label: "Server features",
			run: async (ctx) => {
				const client = ctx.held!.client;
				const caps = client.capabilities;
				const notable = NOTABLE.filter((c) => caps.has(c)).map((c) => c.replace("=DEFLATE", ""));
				let quota = "";
				let full = false;
				if (caps.has("QUOTA")) {
					const q = await client.getQuota().catch(() => false as const);
					if (q && q.storage?.limit) {
						const used = q.storage.used ?? 0;
						full = used / q.storage.limit >= QUOTA_WARN;
						quota = ` · ${gb(used)} of ${gb(q.storage.limit)} used`;
					}
				}
				ctx.held!.release();
				ctx.held = undefined;
				const detail = `${notable.join(" · ") || "Basic IMAP4rev1"}${quota}`;
				return full ? warn(`${detail} — nearly full, new mail may bounce`) : detail;
			},
		},
		{
			id: "smtp",
			label: "Outgoing mail",
			run: async () => {
				try {
					await verifySmtp(session);
				} catch (err) {
					throw classifySmtpError(err, provider);
				}
				const mode = smtp.secure ? "TLS" : isLoopbackHost(smtp.host) ? "plain (loopback)" : "STARTTLS";
				return `${smtp.host}:${smtp.port} · ${mode} · credentials accepted`;
			},
		},
	];
}

/** Dev mailbox: same plan, simulated timings, clearly labelled. */
function devSteps(): Step<Ctx>[] {
	const pause = () => sleep(140 + Math.round(Math.random() * 260));
	const folders = devListFolders();
	const inbox = folders.find((f) => f.path === "INBOX");
	const step = (id: string, label: string, detail: string): Step<Ctx> => ({
		id,
		label,
		run: async (_ctx, signal) => {
			await sleep(0, signal);
			await pause();
			return detail;
		},
	});
	return [
		step("resolve", "Resolve host", "dev.local → in-process mailbox"),
		step("secure", "Secure channel", "Skipped for the dev mailbox (no network)"),
		step("signin", "Sign in", "Signed in as dev@localhost · dev mailbox"),
		step("mailbox", "Read mailbox", `${folders.length} folders · Inbox ${count(inbox?.total ?? 0)} (${count(inbox?.unread ?? 0)} unread)`),
		step("features", "Server features", "IDLE · MOVE · SPECIAL-USE (simulated)"),
		step("smtp", "Outgoing mail", "Dev store accepts sends (simulated)"),
	];
}

export function mailDiagnostics(session: MailSession) {
	const ctx: Ctx = {};
	return {
		ctx,
		steps: isDevSession(session) ? devSteps() : realSteps(session),
		cleanup: () => ctx.held?.release(),
	};
}
