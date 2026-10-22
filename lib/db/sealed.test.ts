import { describe, expect, test } from "bun:test";
import { blockFingerprint, openRow, sealRow } from "@/lib/db/sealed";

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
});
