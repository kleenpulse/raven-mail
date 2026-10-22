export const FOLLOW_UP_STATUSES = ["open", "done"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

/** At most this many open reminders per mailbox. */
export const FOLLOW_UP_LIMIT = 200;

/** The sent message a reminder watches for a reply to. */
export type FollowUpTarget = { messageId: string; subject: string; to: string; folder: string; uid: string };

export type FollowUpDTO = FollowUpTarget & {
	id: string;
	dueAt: string;
	status: FollowUpStatus;
	createdAt: string;
	updatedAt: string;
};
