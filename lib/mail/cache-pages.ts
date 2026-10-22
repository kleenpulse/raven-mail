import type { InfiniteData } from "@tanstack/react-query";
import type { MailSummary } from "@/lib/mail/types";

export type MessagesPage = { messages: MailSummary[]; count: number };

/** A folder list in the cache: pages keyed by UID cursor (`before` = lowest UID already held). */
export type MessagesCache = InfiniteData<MessagesPage, string | null>;

/** Rewrite every cached page of a list; `countDelta` adjusts the folder total on each page. */
export function mapCachedPages(
  old: MessagesCache | undefined,
  fn: (messages: MailSummary[], pageIndex: number) => MailSummary[],
  countDelta = 0,
): MessagesCache | undefined {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map((page, i) => ({
      ...page,
      messages: fn(page.messages, i),
      count: Math.max(0, page.count + countDelta),
    })),
  };
}
