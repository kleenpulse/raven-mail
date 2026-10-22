import { describe, expect, test } from "bun:test";
import { onlySignature, withSignature } from "@/lib/mail/signature";
import { draftBody } from "@/lib/mail/reply";

describe("withSignature", () => {
  test("new mail: two blank lines, the -- delimiter, then the signature", () => {
    expect(withSignature("", "Sam\nRaven team")).toBe("\n\n-- \nSam\nRaven team");
  });

  test("no signature, or only spaces: the text is left alone", () => {
    expect(withSignature("", "")).toBe("");
    expect(withSignature("hi", "  \n ")).toBe("hi");
  });

  test("trailing blank lines in the signature are dropped", () => {
    expect(withSignature("", "Sam\n\n")).toBe("\n\n-- \nSam");
  });

  test("text already there stays above the signature", () => {
    expect(withSignature("unsubscribe", "Sam")).toBe("unsubscribe\n\n-- \nSam");
  });

  test("never twice: a reopened draft that has it keeps one", () => {
    const once = withSignature("Hello", "Sam");
    expect(withSignature(once, "Sam")).toBe(once);
    expect(withSignature(`${once}\n\nmore`, "Sam")).toBe(`${once}\n\nmore`);
  });

  test("on a reply the signature sits above the quoted original", () => {
    const text = withSignature("", "Sam");
    const sent = draftBody({ text: `Sounds good.${text}`, quote: { kind: "reply", header: "On Mon, Ana wrote:", body: "Ship it?" } });
    expect(sent).toBe("Sounds good.\n\n-- \nSam\n\nOn Mon, Ana wrote:\n> Ship it?");
  });
});

describe("onlySignature", () => {
  test("true until something is typed above the signature", () => {
    expect(onlySignature("\n\n-- \nSam")).toBe(true);
    expect(onlySignature("Hi\n\n-- \nSam")).toBe(false);
    expect(onlySignature("")).toBe(false);
  });
});
