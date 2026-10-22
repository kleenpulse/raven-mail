export const BLOCK_KINDS = ["address", "domain"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/** At most this many blocked senders per mailbox. */
export const BLOCK_LIMIT = 500;

export type BlockDTO = { id: string; kind: BlockKind; value: string; createdAt: string };
