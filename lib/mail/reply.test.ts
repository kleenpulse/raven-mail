import { describe, expect, test } from "bun:test";
import { buildReplyDraft, draftBody, draftFromMessage, prefixSubject, replyOptions } from "@/lib/mail/reply";
import type { ComposeDraft, MailMessage } from "@/lib/mail/types";

const message: MailMessage = {
  uid: "101",
  folder: "INBOX",
  subject: "Q3 roadmap",
  from: { name: "Maya Chen", address: "maya@northwind.example" },
  to: [{ address: "me@raven.dev" }, { name: "Sam", address: "sam@northwind.example" }],
  cc: [{ address: "lead@northwind.example" }, { address: "ME@raven.dev" }],
  bcc: [],
  date: "2026-09-24T09:00:00.000Z",
  flags: { seen: true, flagged: false, answered: false, draft: false },
  text: "Need sign-off.\n\nThanks",
  html: "",
  attachments: [],
  messageId: "<m1@northwind>",
  references: ["<m0@northwind>"],
  headers: {},
};

const body = (draft: Partial<ComposeDraft>, text = draft.text ?? "") => draftBody({ text, quote: draft.quote });

describe("prefixSubject", () => {
  test("no double prefixes", () => {
    expect(prefixSubject("Re: hi", "reply")).toBe("Re: hi");
    expect(prefixSubject("hi", "reply")).toBe("Re: hi");
    expect(prefixSubject("FW: hi", "forward")).toBe("FW: hi");
    expect(prefixSubject("", "forward")).toBe("Fwd: (no subject)");
  });
});

describe("buildReplyDraft", () => {
  test("reply goes to sender with threading headers; the quote stays out of the text box", () => {
    const draft = buildReplyDraft(message, "reply", "me@raven.dev");
    expect(draft.to).toBe("Maya Chen <maya@northwind.example>");
    expect(draft.cc).toBe("");
    expect(draft.subject).toBe("Re: Q3 roadmap");
    expect(draft.inReplyTo).toBe("<m1@northwind>");
    expect(draft.references).toEqual(["<m0@northwind>", "<m1@northwind>"]);
    expect(draft.source).toEqual({ folder: "INBOX", uid: "101" });
    expect(draft.text).toBe("");
    expect(draft.quote?.header).toContain("Maya Chen wrote:");
  });

  test("draftBody puts what you wrote first, then the > quote", () => {
    const draft = buildReplyDraft(message, "reply", "me@raven.dev");
    expect(body(draft)).toContain("Maya Chen wrote:\n> Need sign-off.\n>\n> Thanks");
    expect(body(draft, "Signed off.\n\n")).toMatch(/^Signed off\.\n\nOn .+Maya Chen wrote:\n> Need sign-off\./);
    expect(draftBody({ text: "Just text  \n" })).toBe("Just text");
  });

  test("reply-all excludes self and dedupes", () => {
    const draft = buildReplyDraft(message, "replyAll", "me@raven.dev");
    expect(draft.to).toBe("Maya Chen <maya@northwind.example>, Sam <sam@northwind.example>");
    expect(draft.cc).toBe("lead@northwind.example");
  });

  test("replyTo header wins", () => {
    const draft = buildReplyDraft({ ...message, replyTo: { address: "list@northwind.example" } }, "reply", "me@raven.dev");
    expect(draft.to).toBe("list@northwind.example");
  });

  test("reply to own sent message targets its recipients", () => {
    const sent = { ...message, from: { address: "me@raven.dev" }, to: [{ address: "maya@northwind.example" }] };
    expect(buildReplyDraft(sent, "reply", "me@raven.dev").to).toBe("maya@northwind.example");
  });

  test("forward has header block and no threading", () => {
    const draft = buildReplyDraft(message, "forward", "me@raven.dev");
    expect(draft.to).toBe("");
    expect(draft.subject).toBe("Fwd: Q3 roadmap");
    expect(draft.inReplyTo).toBeUndefined();
    expect(draft.quote?.kind).toBe("forward");
    expect(body(draft)).toContain("---------- Forwarded message ----------");
  });

  test("falls back to html text when plain part missing", () => {
    const draft = buildReplyDraft({ ...message, text: "", html: "<p>From html</p>" }, "reply", "me@raven.dev");
    expect(body(draft)).toContain("> From html");
  });
});

describe("replyOptions", () => {
  test("reply-all hidden when it reaches nobody new (your own one-to-one sent mail)", () => {
    const sent = { ...message, from: { address: "me@raven.dev" }, to: [{ address: "sam@northwind.example" }], cc: [] };
    expect(replyOptions(sent, "me@raven.dev").extra).toEqual([]);
  });

  test("counts the extra people and skips automated addresses", () => {
    const withBot = { ...message, cc: [...message.cc, { address: "notifications@linear.app" }] };
    const opts = replyOptions(withBot, "me@raven.dev");
    expect(opts.extra.map((a) => a.address)).toEqual(["sam@northwind.example", "lead@northwind.example"]);
    expect(opts.everyone).toHaveLength(3);
    expect(opts.preferReplyAll).toBe(false);
  });

  test("leads with reply-all for group addresses and when you were only Cc'd", () => {
    const group = { ...message, to: [{ address: "team@northwind.example" }, { address: "me@raven.dev" }] };
    expect(replyOptions(group, "me@raven.dev").preferReplyAll).toBe(true);
    const ccOnly = { ...message, to: [{ address: "sam@northwind.example" }] };
    expect(replyOptions(ccOnly, "me@raven.dev").preferReplyAll).toBe(true);
  });
});

describe("draftFromMessage", () => {
  const saved: MailMessage = {
    ...message,
    folder: "Drafts",
    subject: "Re: Q3 roadmap",
    to: [{ name: "Maya Chen", address: "maya@northwind.example" }],
    cc: [{ name: "Okafor, Sam", address: "sam@northwind.example" }, { address: "lead@northwind.example" }],
    bcc: [{ name: 'The "Boss"', address: "boss@northwind.example" }],
    text: "Looks good.\r\n\r\nOn Tue, Maya wrote:\r\n> Need sign-off.\r\n",
    inReplyTo: "<m1@northwind>",
    references: ["<m0@northwind>", "<m1@northwind>"],
  };

  test("fills every field compose has, threading included", () => {
    expect(draftFromMessage(saved)).toEqual({
      to: "Maya Chen <maya@northwind.example>",
      cc: "sam@northwind.example, lead@northwind.example",
      bcc: "boss@northwind.example",
      subject: "Re: Q3 roadmap",
      text: "Looks good.\n\nOn Tue, Maya wrote:\n> Need sign-off.",
      inReplyTo: "<m1@northwind>",
      references: ["<m0@northwind>", "<m1@northwind>"],
    });
  });

  test("names that would split the address list keep only the address", () => {
    const cc = draftFromMessage(saved).cc!;
    expect(cc.split(/[,;]/).map((s) => s.trim())).toEqual(["sam@northwind.example", "lead@northwind.example"]);
  });

  test("the empty-subject placeholder comes back empty", () => {
    expect(draftFromMessage({ ...saved, subject: "(no subject)" }).subject).toBe("");
  });

  test("an HTML-only draft falls back to its text", () => {
    expect(draftFromMessage({ ...saved, text: "", html: "<p>Hi <b>there</b></p>" }).text).toBe("Hi  there");
  });
});
