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
import { ASK_CASES as TUNE_ASK_CASES, CONTACTS } from "@/test/fixtures/kage/ask";
import { BLIND_ASK_CASES } from "@/test/fixtures/kage/blind/ask";
import { BLIND_RANK_CASES } from "@/test/fixtures/kage/blind/rank";
import { BLIND_TRIAGE_CASES } from "@/test/fixtures/kage/blind/triage";
import { RANK_CASES as TUNE_RANK_CASES } from "@/test/fixtures/kage/rank";
import { TRIAGE_CASES as TUNE_TRIAGE_CASES } from "@/test/fixtures/kage/triage";
import { ece, emptyAgreement, type Agreement, type Rate } from "./kage-stats";
import { RESULTS_DIR } from "./test-store";

/*
 * Scores Kage against the keyword heuristics (and Jev, when a key works) on
 * the labeled fixtures in test/fixtures/kage/. Shared by `bun run eval:kage`
 * and the dev-only /dev/kage page. Tune against `dev`; `holdout` is reported,
 * never tuned on; `blind` (test/fixtures/kage/blind/) was written by someone
 * who had not seen Kage and is the honest number. Its cases stay out of the
 * report unless `revealBlind` is set, so tuning can't drift towards them.
 */

export const SPLITS = ["dev", "holdout", "blind"] as const;
export type EvalSplit = (typeof SPLITS)[number];
export type EvalEngine = "heuristic" | "kage" | "jev";
export type CaseKind = "ask" | "mail" | "rank";

export type { Agreement, Rate };

const ASK_CASES = [...TUNE_ASK_CASES, ...BLIND_ASK_CASES];
const TRIAGE_CASES = [...TUNE_TRIAGE_CASES, ...BLIND_TRIAGE_CASES];
const RANK_CASES = [...TUNE_RANK_CASES, ...BLIND_RANK_CASES];

export type EngineMetrics = {
	intent: Rate;
	/** Mean (correct − confidence)²: lower means the % shown can be trusted. */
	intentBrier: number;
	/** Gap between stated and actual accuracy across confidence bins, 0–1. */
	intentEce: number;
	unreadOnly: Rate;
	scope: Rate;
	sender: Rate;
	category: Rate;
	/** Calibration of the triage category's confidence, 0–1. */
	categoryEce: number;
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
	kind: CaseKind;
	split: EvalSplit;
	input: string;
	expected: string;
	hostile?: boolean;
	answers: Partial<Record<EvalEngine, CaseAnswer>>;
};

export type JevAvailability = { status: "missing" | "rejected" | "live"; note: string };

export type KageEvalReport = {
	schema: 2;
	at: string;
	ms: number;
	jev: JevAvailability;
	engines: EvalEngine[];
	metrics: Record<EvalSplit, Partial<Record<EvalEngine, EngineMetrics>>>;
	/** Kage against keywords, case by case. Shows how much a tie-break could win. */
	agreement: Record<EvalSplit, Partial<Record<CaseKind, Agreement>>>;
	/** True when blind cases were left out of `cases` (totals above still count them). */
	blindHidden: boolean;
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

export async function runKageEval({
	apiKey,
	revealBlind = false,
}: { apiKey?: string; revealBlind?: boolean } = {}): Promise<KageEvalReport> {
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
				intentEce: 0,
				unreadOnly: rate(),
				scope: rate(),
				sender: rate(),
				category: rate(),
				categoryEce: 0,
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
			const intentPoints: { confidence: number; ok: boolean }[] = [];
			const categoryPoints: { confidence: number; ok: boolean }[] = [];

			const asks = ASK_CASES.filter((c) => c.split === split);
			for (const [i, c] of asks.entries()) {
				const t0 = performance.now();
				const plan = engine.jev ? await planAsk({ question: c.q }, CONTACTS, engine.jev) : heuristicPlan(c.q, CONTACTS);
				latencies.push(performance.now() - t0);
				if (engine.jev && plan.source === "heuristic") m.degraded += 1;
				const ok = plan.intent === c.intent || (c.alt ?? []).includes(plan.intent);
				tally(m.intent, ok);
				m.intentBrier += (Number(ok) - plan.intentConfidence) ** 2;
				intentPoints.push({ confidence: plan.intentConfidence, ok });
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
			m.intentEce = round(ece(intentPoints));

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
				categoryPoints.push({ confidence: t.confidence, ok });
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
			m.categoryEce = round(ece(categoryPoints));

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

	const all = [...cases.values()];
	const agreement = Object.fromEntries(SPLITS.map((s) => [s, {}])) as KageEvalReport["agreement"];
	for (const c of all) {
		const k = c.answers.kage?.ok;
		const h = c.answers.heuristic?.ok;
		if (k === undefined || h === undefined) continue;
		const a = (agreement[c.split][c.kind] ??= emptyAgreement());
		if (k && h) a.both += 1;
		else if (k) a.kageOnly += 1;
		else if (h) a.heuristicOnly += 1;
		else a.neither += 1;
	}

	return {
		schema: 2,
		at: new Date().toISOString(),
		ms: Math.round(performance.now() - started),
		jev: availability,
		engines: engines.map((e) => e.name),
		metrics,
		agreement,
		blindHidden: !revealBlind,
		cases: revealBlind ? all : all.filter((c) => c.split !== "blind"),
	};
}

/*
 * Regression gate. Kage's dev and holdout numbers are pinned in
 * test/fixtures/kage/baseline.json; a change may move them, but not down by
 * more than the margin. Blind is never gated: a gate on it is a way to tune on it.
 */

export const GATED_SPLITS = ["dev", "holdout"] as const satisfies readonly EvalSplit[];
/** Machine-dependent, so never pinned. */
const UNGATED = new Set<keyof EngineMetrics>(["p50ms", "p95ms"]);
/** Error-style metrics where higher is worse. */
const LOWER_IS_BETTER = new Set<keyof EngineMetrics>(["intentBrier", "intentEce", "categoryEce", "urgencyMae", "degraded"]);
/** A rate may drop by one case or 3 points, whichever is larger. */
const RATE_MARGIN = 0.03;
/** An error metric may rise by this much. */
const ERROR_MARGIN = 0.02;

export type KageBaseline = {
	at: string;
	metrics: Record<(typeof GATED_SPLITS)[number], EngineMetrics>;
};

export function baselineOf(report: KageEvalReport): KageBaseline {
	return {
		at: report.at,
		metrics: Object.fromEntries(GATED_SPLITS.map((s) => [s, report.metrics[s].kage!])) as KageBaseline["metrics"],
	};
}

/** Human-readable regressions of Kage against the baseline; empty means the gate passes. */
export function regressions(report: KageEvalReport, baseline: KageBaseline): string[] {
	const out: string[] = [];
	for (const split of GATED_SPLITS) {
		const now = report.metrics[split].kage;
		const then = baseline.metrics[split];
		if (!now) {
			out.push(`${split}: no Kage metrics`);
			continue;
		}
		for (const key of Object.keys(then) as (keyof EngineMetrics)[]) {
			if (UNGATED.has(key)) continue;
			const a = then[key];
			const b = now[key];
			if (typeof a === "number" && typeof b === "number") {
				const worse = LOWER_IS_BETTER.has(key) ? b - a : a - b;
				if (worse > ERROR_MARGIN + 1e-9) out.push(`${split} ${key}: ${a} → ${b}`);
			} else if (typeof a === "object" && typeof b === "object" && a.total && b.total) {
				const drop = a.hits / a.total - b.hits / b.total;
				if (drop > Math.max(1 / b.total, RATE_MARGIN) + 1e-9) out.push(`${split} ${key}: ${a.hits}/${a.total} → ${b.hits}/${b.total}`);
			}
		}
	}
	return out;
}

export const BASELINE_FILE = path.join(process.cwd(), "test/fixtures/kage/baseline.json");

const FILE = "kage-eval.json";

export async function writeKageEval(report: KageEvalReport): Promise<void> {
	await mkdir(RESULTS_DIR, { recursive: true });
	await writeFile(path.join(RESULTS_DIR, FILE), JSON.stringify(report, null, 2));
}

export async function readKageEval(): Promise<KageEvalReport | null> {
	try {
		const data = JSON.parse(await readFile(path.join(RESULTS_DIR, FILE), "utf8")) as KageEvalReport;
		return data?.schema === 2 ? data : null;
	} catch {
		return null;
	}
}
