import { choice, type ChoiceQuestion, type SystemOneRequest } from "@typesafe-ai/sdk";
import { REMOVING_ACTIONS, RULE_THRESHOLDS, type RuleAction, type RuleEngine } from "./types";

/*
 * How a rule decides, as pure data: the questions sent to Jev or Kage, and the
 * decisions made from their answers. The email only ever goes in `state`; the
 * user's criteria are the only words in the question. Nothing the engine
 * returns names an action or a folder: those come from the rule alone.
 */

export type RuleInput = { id: string; criteria: string; action: RuleAction; folder?: string };
export type MailInput = { subject: string; from: string; snippet: string };

/** Rules per engine call; a long list becomes a few calls per message, not one per rule. */
export const RULES_PER_CALL = 10;
const SNIPPET_MAX = 1200;

const QUESTION = "Which of the user's rules does this email fit?";
// Opaque label keys (r0..r9): Kage reads label names as evidence, so a key
// like "match" would let an email that says "match" lean the answer.
const NONE = "none";

export type RuleRequest = { ruleIds: string[]; request: SystemOneRequest<{ rules: ChoiceQuestion }> };

/**
 * One request per chunk of rules: a single choice between the rules and
 * "Anything else". Asked together, the rules compete, so a word two rules
 * share can't lift both (asked one by one, "discount codes" made sign-in
 * codes look like a sale).
 */
export function ruleRequests(rules: RuleInput[], mail: MailInput): RuleRequest[] {
	const state = { subject: mail.subject, from: mail.from, snippet: mail.snippet.slice(0, SNIPPET_MAX) };
	const out: RuleRequest[] = [];
	for (let i = 0; i < rules.length; i += RULES_PER_CALL) {
		const chunk = rules.slice(i, i + RULES_PER_CALL);
		const labels: Record<string, string> = {};
		chunk.forEach((rule, j) => {
			labels[`r${j}`] = rule.criteria;
		});
		labels[NONE] = "Anything else";
		out.push({ ruleIds: chunk.map((r) => r.id), request: { state, questions: { rules: choice(QUESTION, labels) } } });
	}
	return out;
}

type ChoiceAnswer = { choice: string; confidence?: number; probabilities?: Record<string, number> };

/** P(the email fits the rule behind `label`), from the chunk's choice answer. */
export function labelProbability(answer: ChoiceAnswer, label: string): number {
	const p = answer.probabilities?.[label];
	if (typeof p === "number" && Number.isFinite(p)) return clamp(p);
	return answer.choice === label ? clamp(answer.confidence ?? 0.5) : 0;
}

/** Read one chunk's answer back into rule id → probability. */
export function readAnswers(ruleIds: string[], answers: { rules?: ChoiceAnswer }): Map<string, number> {
	const out = new Map<string, number>();
	const answer = answers.rules;
	if (!answer) return out;
	ruleIds.forEach((id, j) => out.set(id, labelProbability(answer, `r${j}`)));
	return out;
}

export type DecisionOutcome = "applied" | "below" | "protected" | "earlier";
export type Decision = { rule: RuleInput; probability: number; outcome: DecisionOutcome; why: string };

const pct = (p: number) => `${Math.round(p * 100)}%`;
const ENGINE_NAME: Record<RuleEngine, string> = { jev: "Jev", kage: "Kage" };

/** Long wording, cut back to a whole word. */
function quote(criteria: string): string {
	if (criteria.length <= 60) return criteria;
	const cut = criteria.slice(0, 57);
	const space = cut.lastIndexOf(" ");
	return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}...`;
}

/**
 * Every judged rule's outcome for one message, in rule order. The first rule
 * that clears its threshold acts; later matches are logged as "earlier". A
 * rule that would take mail from someone you write to is held back.
 */
export function decideMessage(
	rules: RuleInput[],
	probabilities: Map<string, number>,
	{ protectedSender, engine }: { protectedSender: boolean; engine: RuleEngine },
): Decision[] {
	let acted = false;
	const decisions: Decision[] = [];
	for (const rule of rules) {
		const probability = probabilities.get(rule.id);
		if (probability === undefined) continue;
		const at = pct(probability);
		let outcome: DecisionOutcome;
		let why: string;
		if (probability < RULE_THRESHOLDS[rule.action]) {
			outcome = "below";
			why = `Not a match (${at})`;
		} else if (acted) {
			outcome = "earlier";
			why = `Matched at ${at}, but an earlier rule acted first`;
		} else if (protectedSender && REMOVING_ACTIONS.has(rule.action)) {
			outcome = "protected";
			why = `Matched at ${at}, but you write to this sender, so it stayed`;
		} else {
			outcome = "applied";
			why = `Matched "${quote(rule.criteria)}" at ${at} (${ENGINE_NAME[engine]})`;
			acted = true;
		}
		decisions.push({ rule, probability, outcome, why });
	}
	return decisions;
}

function clamp(p: number): number {
	return Math.max(0, Math.min(1, p));
}
