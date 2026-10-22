import { describe, expect, test } from "bun:test";
import { blockFingerprint, openRow, ruleMessageFingerprint, sealRow } from "@/lib/db/sealed";

describe("sealed rows", () => {
  test("round trip, and nothing readable in the stored token", () => {
    const token = sealRow("rules", { criteria: "anything from bob@acme.com" }, "acct-a", "id-1");
    expect(token).not.toContain("bob");
    expect(openRow<{ criteria: string }>("rules", token, "acct-a", "id-1")).toEqual({ criteria: "anything from bob@acme.com" });
  });

  test("bound to its account, its row and its feature", () => {
    const token = sealRow("blocks", "bob@acme.com", "acct-a", "id-1");
    expect(() => openRow("blocks", token, "acct-b", "id-1")).toThrow();
    expect(() => openRow("blocks", token, "acct-a", "id-2")).toThrow();
    expect(() => openRow("rules", token, "acct-a", "id-1")).toThrow();
  });

  test("block fingerprints ignore case and spaces, and differ per account and kind", () => {
    const a = blockFingerprint("acct-a", "address", " Bob@Acme.com ");
    expect(a).toBe(blockFingerprint("acct-a", "address", "bob@acme.com"));
    expect(a).not.toBe(blockFingerprint("acct-b", "address", "bob@acme.com"));
    expect(a).not.toBe(blockFingerprint("acct-a", "domain", "bob@acme.com"));
    expect(a).not.toContain("acme");
  });

  describe("rule fingerprints", () => {
    const rule = { id: "rule-1", criteria: "receipts from vendors" };
    const msg = { messageId: "<r1@shop.example>", folder: "INBOX", uidValidity: "7", uid: "42" };

    test("a Message-ID names the message wherever it sits", () => {
      const a = ruleMessageFingerprint("acct-a", rule, msg);
      expect(ruleMessageFingerprint("acct-a", rule, { ...msg, folder: "Archive", uidValidity: "9", uid: "3" })).toBe(a);
      expect(a).not.toContain("shop.example");
    });

    test("editing the wording judges again; another rule or mailbox is its own judgment", () => {
      const a = ruleMessageFingerprint("acct-a", rule, msg);
      expect(ruleMessageFingerprint("acct-a", { ...rule, criteria: "receipts and invoices" }, msg)).not.toBe(a);
      expect(ruleMessageFingerprint("acct-a", { ...rule, id: "rule-2" }, msg)).not.toBe(a);
      expect(ruleMessageFingerprint("acct-b", rule, msg)).not.toBe(a);
    });

    test("no Message-ID: folder, UIDVALIDITY and uid name it instead", () => {
      const bare = { folder: "INBOX", uidValidity: "7", uid: "42" };
      const a = ruleMessageFingerprint("acct-a", rule, bare);
      expect(ruleMessageFingerprint("acct-a", rule, bare)).toBe(a);
      expect(ruleMessageFingerprint("acct-a", rule, { ...bare, uid: "43" })).not.toBe(a);
      expect(ruleMessageFingerprint("acct-a", rule, { ...bare, uidValidity: "8" })).not.toBe(a);
      expect(ruleMessageFingerprint("acct-a", rule, { ...bare, folder: "Archive" })).not.toBe(a);
      expect(a).not.toBe(ruleMessageFingerprint("acct-a", rule, msg));
    });
  });
});
