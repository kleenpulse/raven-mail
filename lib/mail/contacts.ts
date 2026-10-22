import { isMachineAddress } from "@/lib/insights/metrics";
import type { EnvelopeRow } from "@/lib/insights/types";
import type { MailAddress } from "@/lib/mail/types";
import type { Contact } from "@/lib/mail/contact-match";

export type { Contact };

const DAY = 86_400_000;
// People you write to are the likeliest next recipients; people copied
// alongside you count for a little.
const WEIGHT = { sentTo: 3, from: 1, alsoCopied: 0.5 } as const;

/**
 * Address suggestions from the snapshot window, scored by how often and how
 * recently they appear (each sighting decays over about a week). Mailing
 * lists, no-reply and role addresses, and yourself are left out.
 */
export function rankContacts(
  rows: EnvelopeRow[],
  { self, now, limit = 300 }: { self: string[]; now: number; limit?: number },
): Contact[] {
  const mine = new Set(self.map((s) => s.trim().toLowerCase()));
  const seen = new Map<string, Contact & { namedAt: number }>();

  const add = (a: MailAddress | undefined, weight: number, at: number) => {
    const address = a?.address?.trim();
    if (!address || !address.includes("@")) return;
    const key = address.toLowerCase();
    if (mine.has(key) || isMachineAddress(key)) return;
    const age = Math.max(0, (now - at) / DAY);
    const entry = seen.get(key) ?? { address, score: 0, namedAt: -Infinity };
    entry.score += weight / (1 + age / 7);
    const name = a?.name?.trim();
    if (name && name.toLowerCase() !== key && at > entry.namedAt) {
      entry.name = name;
      entry.namedAt = at;
    }
    seen.set(key, entry);
  };

  for (const row of rows) {
    if (row.folder === "sent") {
      for (const a of [...row.to, ...row.cc]) add(a, WEIGHT.sentTo, row.date);
    } else {
      if (row.listId) continue;
      add(row.from, WEIGHT.from, row.date);
      for (const a of [...row.to, ...row.cc]) add(a, WEIGHT.alsoCopied, row.date);
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address))
    .slice(0, limit)
    .map(({ name, address, score }) => ({ ...(name ? { name } : {}), address, score: Math.round(score * 1000) / 1000 }));
}
