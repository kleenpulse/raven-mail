import "server-only";
import { randomUUID } from "node:crypto";
import { ruleMessageFingerprint, sealRow } from "@/lib/db/sealed";
import { tenantKey } from "@/lib/integrations/crypto";
import { IntegrationError } from "@/lib/integrations/errors";
import { jevFor } from "@/lib/jev/client";
import { answeredBy, type DecisionClient } from "@/lib/kage";
import { devMoveWithUids, devRulesBatch, devSetFlags, isDevSession } from "@/lib/mail/dev-store";
import { moveWithUids, resolveSpecial, rulesBatch, setFlags } from "@/lib/mail/imap";
import { getSnapshot, invalidateSnapshot } from "@/lib/mail/snapshot";
import type { MailSummary } from "@/lib/mail/types";
import type { MailSession } from "@/lib/session";
import { decideMessage, readAnswers, ruleRequests, type Decision, type RuleInput } from "./engine";
import { claimEvent, judgedFingerprints, pruneEvents, settleEvent } from "./events-repo";
import { getRules } from "./service";
import {
	REMOVING_ACTIONS,
	RUN_MOVE_LIMIT,
	RUN_RECENT,
	RUN_UID_LIMIT,
	type PreviewItem,
	type RuleAction,
	type RuleEngine,
	type RunSummary,
} from "./types";

/** Engine calls in flight per run, as Deep triage. */
const CONCURRENCY = 4;
const PROTECTED_DAYS = 30;

/** What an event row keeps sealed. */
export type EventDetails = { subject: string; from: string; folder: string; uid: string; dest?: string; newUid?: string; why: string };

/** Jev with Kage behind it when there's a key, Kage alone without one. */
function engineFor(session: MailSession): DecisionClient {
	const jev = jevFor(session);
	if (!jev) throw new IntegrationError("rules_no_engine");
	return jev.client;
}

/**
 * Everyone you've written to in the last 30 days, from the server's own
 * snapshot of Sent (never from the client). One lookup per run.
 */
export async function protectedSenders(session: MailSession): Promise<Set<string>> {
	const snapshot = await getSnapshot(session, { days: PROTECTED_DAYS });
	const since = Date.now() - PROTECTED_DAYS * 86_400_000;
	const self = session.email.toLowerCase();
	const out = new Set<string>();
	for (const row of snapshot.rows) {
		if (row.folder !== "sent" || row.date < since) continue;
		for (const a of [...row.to, ...row.cc]) {
			const address = a.address.toLowerCase();
			if (address && address !== self) out.add(address);
		}
	}
	return out;
}

function batch(session: MailSession, uids: string[] | null, limit: number) {
	return isDevSession(session) ? devRulesBatch(uids, limit) : rulesBatch(session, uids, limit);
}

/** Each message judged against `rules`, at most CONCURRENCY engine calls at once. */
async function judgeAll(
	client: DecisionClient,
	rulesFor: (m: MailSummary) => RuleInput[],
	messages: MailSummary[],
	signal?: AbortSignal,
): Promise<Map<string, { probabilities: Map<string, number>; engine: RuleEngine }>> {
	const out = new Map<string, { probabilities: Map<string, number>; engine: RuleEngine }>();
	let cursor = 0;
	async function worker() {
		while (cursor < messages.length && !signal?.aborted) {
			const m = messages[cursor++]!;
			const rules = rulesFor(m);
			if (rules.length === 0) continue;
			const probabilities = new Map<string, number>();
			let engine: RuleEngine = "kage";
			try {
				for (const [i, { ruleIds, request }] of ruleRequests(rules, { subject: m.subject, from: m.from.address, snippet: m.preview }).entries()) {
					const result = await client.systemOne(request, { signal });
					if (i === 0) engine = answeredBy(result);
					for (const [id, p] of readAnswers(ruleIds, result.answers)) probabilities.set(id, p);
				}
			} catch (err) {
				if (signal?.aborted) throw err;
				// One message the engine couldn't judge stays unjudged; the next run tries it again.
				console.error("[rules] couldn't judge a message", err);
				continue;
			}
			out.set(m.uid, { probabilities, engine });
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	return out;
}

type Claimed = { id: string; message: MailSummary; decision: Decision; details: EventDetails };

/**
 * Run the enabled rules over new Inbox uids (at most 20), or the newest 50.
 * Each rule judges a message once per wording. Every judgment is claimed in
 * the database before anything happens on the server, and only the run that
 * claimed it acts, so two tabs can't both move one message.
 */
export async function runRules(
	session: MailSession,
	{ uids = null, signal }: { uids?: string[] | null; signal?: AbortSignal } = {},
): Promise<RunSummary> {
	const key = tenantKey(session);
	const rules = (await getRules(session)).filter((r) => r.enabled);
	if (rules.length === 0) return { checked: 0, judged: 0, applied: 0, engine: null };
	const client = engineFor(session);
	const { folder, uidValidity, messages } = await batch(session, uids ? uids.slice(0, RUN_UID_LIMIT) : null, RUN_RECENT);

	const fingerprint = (rule: RuleInput, m: MailSummary) =>
		ruleMessageFingerprint(key, rule, { messageId: m.messageId, folder, uidValidity, uid: m.uid });
	const judged = await judgedFingerprints(key, messages.flatMap((m) => rules.map((r) => fingerprint(r, m))));
	const fresh = (m: MailSummary) => rules.filter((r) => !judged.has(fingerprint(r, m)));

	const protects = rules.some((r) => REMOVING_ACTIONS.has(r.action));
	const keep = protects ? await protectedSenders(session) : new Set<string>();
	const results = await judgeAll(client, fresh, messages, signal);

	const winners: Claimed[] = [];
	let moves = 0;
	let engine: RuleEngine | null = null;
	for (const m of messages) {
		const result = results.get(m.uid);
		if (!result) continue;
		engine ??= result.engine;
		const decisions = decideMessage(fresh(m), result.probabilities, {
			protectedSender: keep.has(m.from.address.toLowerCase()),
			engine: result.engine,
		});
		const winner = decisions.find((d) => d.outcome === "applied");
		// Over the move cap: leave the whole message for the next run.
		if (winner && REMOVING_ACTIONS.has(winner.rule.action) && moves >= RUN_MOVE_LIMIT) continue;
		for (const decision of decisions) {
			const id = randomUUID();
			const details: EventDetails = { subject: m.subject, from: m.from.address, folder, uid: m.uid, why: decision.why };
			const claimed = await claimEvent({
				id,
				accountKey: key,
				ruleId: decision.rule.id,
				fingerprint: fingerprint(decision.rule, m),
				action: decision.rule.action,
				probability: decision.probability,
				engine: result.engine,
				sealed: sealRow("rule-events", details, key, id),
			});
			// Null: another run claimed this judgment first, and acts on it itself.
			if (claimed && decision === winner) {
				winners.push({ id: claimed, message: m, decision, details });
				if (REMOVING_ACTIONS.has(decision.rule.action)) moves += 1;
			}
		}
	}

	const applied = await applyAll(session, key, folder, winners);
	if (applied && !isDevSession(session)) invalidateSnapshot(session);
	await pruneEvents(key).catch((err) => console.error("[rules] prune failed", err));
	return { checked: messages.length, judged: results.size, applied, engine };
}

/** Where a removing action sends mail. */
async function destination(session: MailSession, action: RuleAction, folder?: string): Promise<string | null> {
	if (action === "move") return folder ?? null;
	const role = action === "archive" ? "\\Archive" : "\\Trash";
	if (isDevSession(session)) return action === "archive" ? "Archive" : "Trash";
	return resolveSpecial(session, role);
}

/** Batched by action and destination, one IMAP call each. Returns how many applied. */
async function applyAll(session: MailSession, key: string, folder: string, winners: Claimed[]): Promise<number> {
	const groups = new Map<string, Claimed[]>();
	for (const w of winners) {
		const groupKey = `${w.decision.rule.action}|${w.decision.rule.folder ?? ""}`;
		groups.set(groupKey, [...(groups.get(groupKey) ?? []), w]);
	}
	const dev = isDevSession(session);
	let applied = 0;
	for (const group of groups.values()) {
		const { action, folder: ruleFolder } = group[0]!.decision.rule;
		const uids = group.map((w) => w.message.uid);
		try {
			let moved = new Map<string, string>();
			let dest: string | undefined;
			if (REMOVING_ACTIONS.has(action)) {
				dest = (await destination(session, action, ruleFolder)) ?? undefined;
				if (!dest) throw new Error(action === "archive" ? "There's no Archive folder" : "There's no Trash folder");
				moved = dev ? devMoveWithUids(folder, uids, dest) : await moveWithUids(session, folder, uids, dest);
			} else {
				const flag = action === "star" ? { flagged: true } : { seen: true };
				if (dev) devSetFlags(folder, uids, flag);
				else await setFlags(session, folder, uids, { add: [action === "star" ? "\\Flagged" : "\\Seen"] });
			}
			for (const w of group) {
				const newUid = moved.get(w.message.uid);
				const details = { ...w.details, ...(dest ? { dest } : {}), ...(newUid ? { newUid } : {}) };
				await settleEvent(key, w.id, { applied: true, sealed: sealRow("rule-events", details, key, w.id) });
				applied += 1;
			}
		} catch (err) {
			const reason = err instanceof Error ? err.message : "the server refused";
			for (const w of group) {
				const details = { ...w.details, why: `${w.details.why}, but it couldn't be done: ${reason}` };
				await settleEvent(key, w.id, { applied: false, sealed: sealRow("rule-events", details, key, w.id) });
			}
		}
	}
	return applied;
}

/**
 * A dry run before saving: how a rule with this wording would judge the newest
 * 50 Inbox messages. Writes nothing.
 */
export async function previewRule(
	session: MailSession,
	input: { criteria: string; action: RuleAction; folder?: string },
	signal?: AbortSignal,
): Promise<PreviewItem[]> {
	const client = engineFor(session);
	const rule: RuleInput = { id: "preview", criteria: input.criteria.trim(), action: input.action, folder: input.folder };
	const { messages } = await batch(session, null, RUN_RECENT);
	const keep = REMOVING_ACTIONS.has(rule.action) ? await protectedSenders(session) : new Set<string>();
	const results = await judgeAll(client, () => [rule], messages, signal);
	return messages
		.flatMap((m) => {
			const result = results.get(m.uid);
			if (!result) return [];
			const [decision] = decideMessage([rule], result.probabilities, {
				protectedSender: keep.has(m.from.address.toLowerCase()),
				engine: result.engine,
			});
			if (!decision) return [];
			return [
				{
					uid: m.uid,
					subject: m.subject,
					from: m.from.name || m.from.address,
					probability: decision.probability,
					wouldApply: decision.outcome === "applied",
					why: decision.why,
				},
			];
		})
		.sort((a, b) => b.probability - a.probability);
}
