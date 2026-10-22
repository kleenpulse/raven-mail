export const RULE_ACTIONS = ["move", "archive", "star", "read", "trash"] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

/** At most this many rules per mailbox. */
export const RULE_LIMIT = 50;
export const RULE_CRITERIA_MAX = 300;

/** What the client sees: the sealed parts opened, no tenant key. */
export type RuleDTO = {
	id: string;
	criteria: string;
	action: RuleAction;
	/** Destination for `move`. */
	folder?: string;
	enabled: boolean;
	position: number;
	createdAt: string;
	updatedAt: string;
};

/** Which engine judged a message. */
export const RULE_ENGINES = ["jev", "kage"] as const;
export type RuleEngine = (typeof RULE_ENGINES)[number];

/** How sure a rule must be before it acts. Trash asks for more, since it's the costliest mistake. */
export const RULE_THRESHOLDS: Record<RuleAction, number> = { move: 0.7, archive: 0.7, star: 0.7, read: 0.7, trash: 0.85 };

/** Probabilities are stored as `real`, so 0.7 reads back as 0.6999999881. */
export const STORED_SLACK = 1e-6;

/**
 * Worth showing in Recent activity: what a rule did, or would have done but
 * held back (people you write to, an earlier rule, a failed move). Plain
 * non-matches are kept only so a message isn't judged twice.
 */
export function isNotable(e: { applied: boolean; action: RuleAction; probability: number }): boolean {
	return e.applied || e.probability >= RULE_THRESHOLDS[e.action] - STORED_SLACK;
}

/** Actions that take mail out of the Inbox: never applied to people you write to. */
export const REMOVING_ACTIONS: ReadonlySet<RuleAction> = new Set(["move", "archive", "trash"]);

/** One run moves at most this many messages; a new-mail run takes at most this many uids. */
export const RUN_MOVE_LIMIT = 50;
export const RUN_UID_LIMIT = 20;
/** "Run rules now" and previews look at this many of the newest Inbox messages. */
export const RUN_RECENT = 50;

/** One judgment in Recent activity. */
export type RuleEventDTO = {
	id: string;
	ruleId: string;
	action: RuleAction;
	probability: number;
	applied: boolean;
	undone: boolean;
	engine: RuleEngine;
	subject: string;
	from: string;
	/** Where the message was, and where it went (moves only). */
	folder: string;
	uid: string;
	dest?: string;
	newUid?: string;
	why: string;
	/** Applied move, archive or trash with a known new uid, not yet undone. */
	undoable: boolean;
	createdAt: string;
};

export type RunSummary = { checked: number; judged: number; applied: number; engine: RuleEngine | null };

/**
 * One message in a preview. `outcome`: applied (it would act), below (not a
 * match), protected (you write to the sender), earlier (another rule acts
 * first), outranked (it fits, but another rule takes the match).
 */
export type PreviewItem = {
	uid: string;
	subject: string;
	from: string;
	probability: number;
	wouldApply: boolean;
	outcome: "applied" | "below" | "protected" | "earlier" | "outranked";
	why: string;
};
