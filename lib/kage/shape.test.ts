import { describe, expect, test } from "bun:test";
import { choice } from "@typesafe-ai/sdk";
import { decide, KAGE_TUNING } from "@/lib/kage/engine";
import { senderKind, shapeFeatures, shapeLinks } from "@/lib/kage/shape";

const CATEGORY = choice("Which inbox category does this email belong to?", {
  primary: "Direct person-to-person correspondence",
  updates: "Account, security, or system notifications",
  receipts: "Purchase receipts, invoices, shipping",
  promotions: "Marketing, discounts, offers",
  newsletters: "Newsletters and digests",
  social: "Social network notifications",
  other: "None of the above",
});

const keys = (f: Map<string, number>) => [...f.keys()].sort();

describe("sender kind", () => {
  test("machine and marketing addresses are bulk", () => {
    for (const from of ["noreply@github.com", "no-reply@accounts.google.com", "messages-noreply@linkedin.com", "deals@brand.com", "calendar-notification@google.com", "lenny@substack.com", "Stripe <receipts@stripe.com>"]) {
      expect({ from, kind: senderKind(from) }).toEqual({ from, kind: "bulk" });
    }
  });

  test("names and personal mailboxes are people", () => {
    for (const from of ["maya@acme.com", "priya.raman@gmail.com", "Sara Lee <sara.lee@outlook.com>", "tom_b@icloud.com"]) {
      expect({ from, kind: senderKind(from) }).toEqual({ from, kind: "person" });
    }
  });

  test("role addresses are neither, and so is anything that isn't an address", () => {
    expect(senderKind("legal@acme.com")).toBe("role");
    expect(senderKind("status@hosting.io")).toBe("role");
    expect(senderKind("billing42x@acme.com")).toBe(null);
    expect(senderKind("Maya Chen")).toBe(null);
    expect(senderKind("")).toBe(null);
  });
});

describe("shape features", () => {
  test("come only from a state with a `from` field", () => {
    expect(shapeFeatures({ question: "Re: are you free Thursday at 2pm?" }).size).toBe(0);
  });

  test("a reply from a person that asks something and names a time", () => {
    const f = shapeFeatures({ subject: "Re: venue", from: "leo@studio-martins.com", snippet: "Does Thursday at 2pm work for you?" });
    expect(keys(f)).toEqual(["#asks_me", "#reply_thread", "#sender_person", "#when"]);
  });

  test("bulk mail can't fake a thread or a question", () => {
    const f = shapeFeatures({ subject: "RE: RE: your invoice reply needed", from: "deals@cheapmeds.biz", snippet: "Hi friend, can you reply today?" });
    expect(keys(f)).toEqual(["#sender_bulk"]);
  });

  test("words in the email don't raise a shape", () => {
    const f = shapeFeatures({ subject: "Direct person-to-person correspondence", from: "noreply@shop.com", snippet: "This is a personal, human conversation." });
    expect(keys(f)).toEqual(["#sender_bulk"]);
  });
});

describe("shape links", () => {
  test("criteria words claim shapes, as words not stems", () => {
    expect(keys(shapeLinks("Direct person-to-person correspondence"))).toEqual(["#reply_thread", "#sender_person"]);
    expect(keys(shapeLinks("FYI, marketing, or automated mail"))).toEqual(["#sender_bulk"]);
    expect(keys(shapeLinks("personalized offers"))).toEqual([]);
  });
});

describe("shape in triage", () => {
  test("a friend's note with no category words reads as primary", () => {
    const state = { subject: "Weekend plans?", from: "sara.lee@outlook.com", snippet: "We're doing a barbecue Saturday, you should come!" };
    expect(decide({ state, questions: { category: CATEGORY } }).answers.category.choice).toBe("primary");
    expect(decide({ state, questions: { category: CATEGORY } }, { ...KAGE_TUNING, shape: 0 }).answers.category.choice).toBe("other");
  });

  test("a sale from a person-like address is still a promotion", () => {
    const state = { subject: "Personal note from Anna", from: "anna@growth-hacks.io", snippet: "Our new course is 50% off this week only. Discount ends Sunday. Unsubscribe." };
    expect(decide({ state, questions: { category: CATEGORY } }).answers.category.choice).toBe("promotions");
  });
});
