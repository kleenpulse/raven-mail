import "server-only";
import type { Snapshot } from "@/lib/insights/types";
import { devAllMessages, devListFolders } from "@/lib/mail/dev-store";
import { snapshotFromMessages } from "@/lib/mail/envelope-row";

/** Same shape as the IMAP snapshot, built from the in-memory dev mailbox. */
export function devSnapshot({ days, account }: { days: number; account: string }): Snapshot {
  const inbox = devListFolders().find((f) => f.path === "INBOX");
  return snapshotFromMessages(devAllMessages(), {
    now: Date.now(),
    days,
    account,
    inbox: { unseen: inbox?.unread ?? 0, total: inbox?.total ?? 0 },
  });
}
