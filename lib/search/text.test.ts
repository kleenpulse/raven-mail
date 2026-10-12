import { describe, expect, test } from "bun:test";
import { fold, parseQuery, scoreTerms, searchText, tokenize, withinOneEdit, type TextField } from "@/lib/search/text";

type Doc = { title: string; body: string };
const fields = (d: Doc): TextField[] => [
  { text: d.title, weight: 4 },
  { text: d.body, weight: 1 },
];
const docs: Doc[] = [
  { title: "Schedule a posting", body: "Pick a date and time." },
  { title: "Reset your password", body: "Use the link we email you." },
  { title: "Invoice for March", body: "Your café receipt is attached." },
];
const titles = (q: string) => searchText(docs, q, fields).map((h) => h.item.title);

type Mail = { subject: string; from: string; body: string };
const mailFields = (m: Mail): TextField[] => [
  { text: m.subject, weight: 4, key: "subject" },
  { text: m.from, weight: 3, key: "from" },
  { text: m.body, weight: 1 },
];
const mails: Mail[] = [
  { subject: "Q3 roadmap — need your sign-off", from: "Maya Chen maya.chen@northwind.example", body: "Can you look at the pricing section?" },
  { subject: "Security alert: new sign-in", from: "Accounts Security", body: "We noticed a new sign-in from Chrome on Windows." },
  { subject: "[RAV-320] Maya Chen commented", from: "Linear", body: "Maya Chen: added a screen recording from the call." },
  { subject: "Notes from the Harbor call", from: "Maya Chen maya.chen@northwind.example", body: "They want webhooks before SSO." },
  { subject: "Harbor kickoff", from: "Sam Okafor", body: "Agenda attached." },
  { subject: "Invoice for March", from: "Stripe", body: "Amount paid: $48.00" },
];
const subjects = (q: string) => searchText(mails, q, mailFields).map((h) => h.item.subject);

describe("folding + tokens", () => {
  test("case and diacritics fold", () => {
    expect(fold("CAFÉ")).toBe("cafe");
  });

  test("tokens split on non-letters and dedupe", () => {
    expect(tokenize("Maya@Acme.com maya")).toEqual(["maya", "acme", "com"]);
    expect(tokenize(["q3", "Roadmap"])).toEqual(["q3", "roadmap"]);
  });
});

describe("parseQuery", () => {
  test("natural 'from X' is a soft sender filter; filler drops", () => {
    expect(parseQuery("from maya about harbor")).toEqual([
      { token: "maya", field: "from", soft: true },
      { token: "harbor" },
    ]);
  });

  test("operators are hard filters, value may follow a space", () => {
    expect(parseQuery("from:maya subject: Harbor")).toEqual([
      { token: "maya", field: "from" },
      { token: "harbor", field: "subject" },
    ]);
  });

  test("'from' before filler stays filler", () => {
    expect(parseQuery("notes from the harbor call")).toEqual([
      { token: "notes" },
      { token: "harbor" },
      { token: "call" },
    ]);
  });

  test("filler survives when it's all there is", () => {
    expect(parseQuery("about")).toEqual([{ token: "about" }]);
  });
});

describe("withinOneEdit", () => {
  test.each([
    ["password", "pasword"], // deletion
    ["pasword", "password"], // insertion
    ["password", "passwerd"], // substitution
    ["password", "passwrod"], // transposition
  ])("%s ≈ %s", (a, b) => expect(withinOneEdit(a, b)).toBe(true));

  test("two edits miss", () => {
    expect(withinOneEdit("password", "pswrd")).toBe(false);
    expect(withinOneEdit("password", "pasxwrdd")).toBe(false);
  });
});

describe("searchText", () => {
  test("prefix matches typing in progress", () => {
    expect(titles("sched")).toEqual(["Schedule a posting"]);
  });

  test("one-edit typo lands", () => {
    expect(titles("pasword")).toEqual(["Reset your password"]);
  });

  test("fuzzy needs ≥ 4 chars", () => {
    expect(titles("pst")).toEqual([]);
  });

  test("diacritics match both ways", () => {
    expect(titles("cafe")).toEqual(["Invoice for March"]);
  });

  test("every term must land when possible", () => {
    expect(titles("invoice march")).toEqual(["Invoice for March"]);
  });

  test("coverage fallback keeps ties", () => {
    expect(titles("invoice password").sort()).toEqual(["Invoice for March", "Reset your password"]);
  });

  test("title beats body; exact in heaviest field scores 1", () => {
    const hits = searchText(
      [
        { title: "Notes", body: "roadmap" },
        { title: "Roadmap", body: "" },
      ],
      "roadmap",
      fields,
    ).sort((a, b) => b.score - a.score);
    expect(hits[0]?.item.title).toBe("Roadmap");
    expect(hits[0]?.score).toBe(1);
  });

  test("prefix outranks substring", () => {
    const pre = scoreTerms([{ token: "road" }], [{ text: "roadmap", weight: 1 }]);
    const sub = scoreTerms([{ token: "road" }], [{ text: "railroads", weight: 1 }]);
    expect(pre).toBeGreaterThan(sub);
  });
});

describe("mail queries", () => {
  test("natural-language sender + topic", () => {
    expect(subjects("from maya about harbor")).toEqual(["Notes from the Harbor call"]);
  });

  test("sender filter skips mail that only mentions them", () => {
    expect(subjects("from maya")).not.toContain("[RAV-320] Maya Chen commented");
  });

  test("soft sender relaxes to plain text before giving up", () => {
    expect(subjects("invoice from march")).toEqual(["Invoice for March"]);
  });

  test("coverage fallback keeps the best-covered, not any match", () => {
    expect(subjects("harbor webhooks zebra")).toEqual(["Notes from the Harbor call"]);
  });

  test("hard operators stay filters in the fallback", () => {
    expect(subjects("from:sam roadmap")).toEqual([]);
  });
});
