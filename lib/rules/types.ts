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
