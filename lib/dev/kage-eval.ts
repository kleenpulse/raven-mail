import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { EnrichedRow } from "@/lib/insights/metrics";
import { extractKeywords, heuristicPlan } from "@/lib/jev/ask/heuristic-plan";
import { planAsk } from "@/lib/jev/ask/plan";
import { jevRank } from "@/lib/jev/ask/rank";
import type { Jev } from "@/lib/jev/client";
import { kage } from "@/lib/kage";
import { parseQuery, scoreTerms } from "@/lib/search/text";
import { heuristicTriage } from "@/lib/triage/heuristic";
import { jevTriage } from "@/lib/triage/jev";
import { ASK_CASES, CONTACTS } from "@/test/fixtures/kage/ask";
import { RANK_CASES } from "@/test/fixtures/kage/rank";
import { TRIAGE_CASES } from "@/test/fixtures/kage/triage";
import { RESULTS_DIR } from "./test-store";

/*
 * Scores Kage against the keyword heuristics (and Jev, when a key works) on
 * the labeled fixtures in test/fixtures/kage/. Shared by `bun run eval:kage`
 * and the dev-only /dev/kage page. Tune against `dev`; `holdout` was used for
 * diagnosis once; `blind` is the honest number.
 */

export const SPLITS = ["dev", "holdout", "blind"] as const;
export type EvalSplit = (typeof SPLITS)[number];
export type EvalEngine = "heuristic" | "kage" | "jev";

export type Rate = { hits: number; total: number };

export type EngineMetrics = {
	intent: Rate;
	/** Mean (correct − confidence)²: lower means the % shown can be trusted. */
	intentBrier: number;
	unreadOnly: Rate;
	scope: Rate;
	sender: Rate;
	category: Rate;
	hostileCategory: Rate;
	needsReply: Rate;
	/** Mean |urgency − label/3|, 0–1. */
	urgencyMae: number;
	rankTop1: Rate;
	rankTop3: Rate;
	rankNone: Rate;
	p50ms: number;
	p95ms: number;
	/** Calls where the engine failed and heuristics answered instead. */
	degraded: number;
};

export type CaseAnswer = { value: string; ok: boolean; confidence?: number };

export type EvalCase = {
	id: string;
	kind: "ask" | "mail" | "rank";
	split: EvalSplit;
	input: string;
	expected: string;
	hostile?: boolean;
	answers: Partial<Record<EvalEngine, CaseAnswer>>;
};

export type JevAvailability = { status: "missing" | "rejected" | "live"; note: string };

export type KageEvalReport = {
	schema: 1;
	at: string;
	ms: number;
	jev: JevAvailability;
	engines: EvalEngine[];
	metrics: Record<EvalSplit, Partial<Record<EvalEngine, EngineMetrics>>>;
	cases: EvalCase[];
};

const rate = (): Rate => ({ hits: 0, total: 0 });
function tally(r: Rate, ok: boolean) {
	r.total += 1;
	if (ok) r.hits += 1;
}
const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;
function quantile(xs: number[], q: number): number {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : 0;
}

/** A rejected key would quietly score heuristics under Jev's name, so prove it first. */
async function jevEngine(apiKey: string | undefined): Promise<{ jev: Jev | null; availability: JevAvailability }> {
	if (!apiKey) return { jev: null, availability: { status: "missing", note: "No TYPESAFE_API_KEY on this server" } };
	const client = new TypeSafeClient({ apiKey, timeout: 15_000, retry: { maxRetries: 1 } });
	try {
		await client.models.list({ timeout: 8_000, retry: { maxRetries: 0 } });
		return { jev: { client, source: "server" }, availability: { status: "live", note: "Key accepted" } };
	} catch (err) {
		const message = err instanceof Error ? err.message.slice(0, 120) : "Unknown error";
		return { jev: null, availability: { status: "rejected", note: `Key rejected: ${message}` } };
	}
}

function rankRows(pool: (typeof RANK_CASES)[number]["pool"], now: number): EnrichedRow[] {
	return pool.map(
		(p, i) =>
			({
				uid: i,
				path: "INBOX",
				folder: "inbox",
				from: { name: p.from, address: `${p.from.toLowerCase().replace(/\W+/g, ".")}@example.com` },
				subject: p.subject,
				preview: p.preview,
				date: now - p.hoursAgo * 3_600_000,
			}) as unknown as EnrichedRow,
	);
}

/** Today's no-engine search: the keyword scorer the Ask retrieval falls back to. */
function keywordRank(question: string, rows: EnrichedRow[]): number[] {
	const terms = parseQuery(extractKeywords(question));
	return rows
		.map((row, i) => ({
			i,
			s: scoreTerms(terms, [
				{ text: row.subject, weight: 3, key: "subject" },
				{ text: `${row.from.name} ${row.from.address}`, weight: 2, key: "from" },
				{ text: row.preview ?? "", weight: 1 },
			]),
		}))
		.filter((x) => x.s > 0)
		.sort((a, b) => b.s - a.s)
		.map((x) => x.i);
}

export async function runKageEval({ apiKey }: { apiKey?: string } = {}): Promise<KageEvalReport> {
	const started = performance.now();
	const { jev, availability } = await jevEngine(apiKey);
	const engines: { name: EvalEngine; jev: Jev | null }[] = [
		{ name: "heuristic", jev: null },
		{ name: "kage", jev: { client: kage, source: "kage" } },
	];
	if (jev) engines.push({ name: "jev", jev });

	const cases = new Map<string, EvalCase>();
	const caseFor = (id: string, init: Omit<EvalCase, "id" | "answers">) => {
		let c = cases.get(id);
		if (!c) cases.set(id, (c = { id, ...init, answers: {} }));
		return c;
	};
	const metrics = Object.fromEntries(SPLITS.map((s) => [s, {}])) as KageEvalReport["metrics"];
	const now = Date.now();

	for (const split of SPLITS) {
		for (const engine of engines) {
			const m: EngineMetrics = {
				intent: rate(),
				intentBrier: 0,
				unreadOnly: rate(),
				scope: rate(),
				sender: rate(),
				category: rate(),
				hostileCategory: rate(),
				needsReply: rate(),
				urgencyMae: 0,
				rankTop1: rate(),
				rankTop3: rate(),
				rankNone: rate(),
				p50ms: 0,
				p95ms: 0,
				degraded: 0,
			};
			const latencies: number[] = [];

			const asks = ASK_CASES.filter((c) => c.split === split);
			for (const [i, c] of asks.entries()) {
				const t0 = performance.now();
				const plan = engine.jev ? await planAsk({ question: c.q }, CONTACTS, engine.jev) : heuristicPlan(c.q, CONTACTS);
				latencies.push(performance.now() - t0);
				if (engine.jev && plan.source === "heuristic") m.degraded += 1;
				const ok = plan.intent === c.intent || (c.alt ?? []).includes(plan.intent);
				tally(m.intent, ok);
				m.intentBrier += (Number(ok) - plan.intentConfidence) ** 2;
				const unreadOk = plan.unreadOnly === (c.unreadOnly ?? false);
				tally(m.unreadOnly, unreadOk);
				// Who-owes-me questions read Sent by design.
				const wantSent = c.scope === "sent" || c.intent === "awaiting_others";
				tally(m.scope, wantSent === (plan.scope === "sent"));
				const senderOk = !c.sender || plan.sender?.address === c.sender;
				if (c.sender) tally(m.sender, senderOk);
				const extras = [plan.unreadOnly && "unread", plan.scope === "sent" && "sent", plan.sender?.name].filter(Boolean);
				caseFor(`ask:${split}:${i}`, {
					kind: "ask",
					split,
					input: c.q,
					expected: [c.intent, ...(c.alt ?? []).map((a) => `or ${a}`), c.unreadOnly && "unread", c.sender].filter(Boolean).join(" · "),
				}).answers[engine.name] = {
					value: [plan.intent, ...extras].join(" · "),
					ok: ok && unreadOk && senderOk,
					confidence: plan.intentConfidence,
				};
			}
			m.intentBrier = round(m.intentBrier / (asks.length || 1));

			const mails = TRIAGE_CASES.filter((c) => c.split === split);
			let urgencyError = 0;
			for (const [i, c] of mails.entries()) {
				const input = { subject: c.subject, from: c.from, snippet: c.snippet };
				const t0 = performance.now();
				const t = engine.jev ? await jevTriage(input, { jev: engine.jev }) : heuristicTriage(input);
				latencies.push(performance.now() - t0);
				if (engine.jev && t.source === "heuristic") m.degraded += 1;
				const ok = t.category === c.category || (c.alt ?? []).includes(t.category);
				tally(m.category, ok);
				if (c.hostile) tally(m.hostileCategory, ok);
				tally(m.needsReply, t.needsReply === c.needsReply);
				urgencyError += Math.abs(t.urgency - c.urgency / 3);
				caseFor(`mail:${split}:${i}`, {
					kind: "mail",
					split,
					input: `${c.subject} — ${c.from}`,
					expected: `${c.category} · urgency ${c.urgency}/3 · ${c.needsReply ? "reply" : "no reply"}`,
					hostile: c.hostile,
				}).answers[engine.name] = {
					value: `${t.category} · urgency ${round(t.urgency * 3, 1)}/3 · ${t.needsReply ? "reply" : "no reply"}`,
					ok: ok && t.needsReply === c.needsReply,
					confidence: t.confidence,
				};
			}
			m.urgencyMae = round(urgencyError / (mails.length || 1));

			for (const [i, c] of RANK_CASES.filter((c) => c.split === split).entries()) {
				const rows = rankRows(c.pool, now);
				let order: number[];
				let none: boolean;
				if (engine.jev) {
					const t0 = performance.now();
					const ranked = await jevRank(c.question, rows, now, engine.jev);
					latencies.push(performance.now() - t0);
					if (ranked === null) m.degraded += 1;
					order = (ranked ?? []).map((x) => rows.indexOf(x.row));
					none = !ranked?.length || ranked.every((x) => x.low);
				} else {
					order = keywordRank(c.question, rows);
					none = order.length === 0;
				}
				let ok: boolean;
				if (c.noneExpected) {
					ok = none;
					tally(m.rankNone, ok);
				} else {
					ok = !none && c.expect.includes(order[0]!);
					tally(m.rankTop1, ok);
					tally(m.rankTop3, !none && order.slice(0, 3).some((x) => c.expect.includes(x)));
				}
				caseFor(`rank:${split}:${i}`, {
					kind: "rank",
					split,
					input: c.question,
					expected: c.noneExpected ? "nothing matches" : c.expect.map((x) => c.pool[x]!.subject).join(" or "),
				}).answers[engine.name] = { value: none ? "nothing matches" : (c.pool[order[0]!]?.subject ?? "—"), ok };
			}

			m.p50ms = round(quantile(latencies, 0.5), 2);
			m.p95ms = round(quantile(latencies, 0.95), 2);
			metrics[split][engine.name] = m;
		}
	}

	return {
		schema: 1,
		at: new Date().toISOString(),
		ms: Math.round(performance.now() - started),
		jev: availability,
		engines: engines.map((e) => e.name),
		metrics,
		cases: [...cases.values()],
	};
}

const FILE = "kage-eval.json";

export async function writeKageEval(report: KageEvalReport): Promise<void> {
	await mkdir(RESULTS_DIR, { recursive: true });
	await writeFile(path.join(RESULTS_DIR, FILE), JSON.stringify(report, null, 2));
}

export async function readKageEval(): Promise<KageEvalReport | null> {
	try {
		const data = JSON.parse(await readFile(path.join(RESULTS_DIR, FILE), "utf8")) as KageEvalReport;
		return data?.schema === 1 ? data : null;
	} catch {
		return null;
	}
}
