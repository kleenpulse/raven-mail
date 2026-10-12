import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAIL_LAYOUT,
  LIST_MAX,
  LIST_MIN,
  READER_MIN,
  clampListWidth,
  parseMailLayout,
  serializeMailLayout,
} from "@/lib/mail/reader-layout";

describe("mail layout cookie", () => {
  test("round-trips width and wide flag", () => {
    for (const layout of [
      { listWidth: 420, wide: false },
      { listWidth: 300, wide: true },
      { listWidth: null, wide: true },
      DEFAULT_MAIL_LAYOUT,
    ]) {
      expect(parseMailLayout(serializeMailLayout(layout))).toEqual(layout);
    }
  });

  test("missing or malformed values fall back to the default", () => {
    for (const raw of [undefined, null, "", "wide", "420", "420:2", "-5:0", "abc:1", "12345:0"]) {
      expect(parseMailLayout(raw)).toEqual(DEFAULT_MAIL_LAYOUT);
    }
  });

  test("a hand-edited width is clamped into range", () => {
    expect(parseMailLayout("9999:0").listWidth).toBe(LIST_MAX);
    expect(parseMailLayout("10:0").listWidth).toBe(LIST_MIN);
  });

  test("survives cookie encoding", () => {
    expect(parseMailLayout(encodeURIComponent("400:1"))).toEqual({ listWidth: 400, wide: true });
  });
});

describe("clampListWidth", () => {
  test("keeps room for the reader in a narrow container", () => {
    expect(clampListWidth(600, 900)).toBe(900 - READER_MIN);
  });

  test("never drops below the minimum, even when the container is tiny", () => {
    expect(clampListWidth(500, 500)).toBe(LIST_MIN);
  });
});
