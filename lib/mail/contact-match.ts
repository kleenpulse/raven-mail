export type Contact = { name?: string; address: string; score: number };

/**
 * The typed text against the ranked list: any word of the name, or the
 * address (or its part after the @), starting with it. Keeps rank order.
 */
export function matchContacts(contacts: Contact[], query: string, exclude: Set<string>, limit = 6): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: Contact[] = [];
  for (const c of contacts) {
    if (exclude.has(c.address.toLowerCase())) continue;
    const address = c.address.toLowerCase();
    const words = (c.name ?? "").toLowerCase().split(/[\s,."'()-]+/).filter(Boolean);
    const hit =
      address.startsWith(q) ||
      address.split("@")[1]?.startsWith(q) ||
      words.some((w) => w.startsWith(q)) ||
      (c.name ?? "").toLowerCase().startsWith(q);
    if (hit) out.push(c);
    if (out.length === limit) break;
  }
  return out;
}
