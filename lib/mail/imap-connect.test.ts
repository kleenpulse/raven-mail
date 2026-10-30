import { afterEach, describe, expect, mock, test } from "bun:test";
import { makeSession } from "@/test/helpers/session";

// A stand-in imapflow whose connects fail as scripted, in order; an empty script connects.
const script: (Error | null)[] = [];
let created = 0;
let open = 0;

const failure = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(code), { code, ...extra });

class FakeImapFlow {
  usable = false;
  constructor() {
    created += 1;
  }
  async connect() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const err = script.shift();
    if (err) throw err;
    this.usable = true;
    open += 1;
  }
  async noop() {}
  async logout() {
    this.usable = false;
    open -= 1;
  }
  close() {
    if (this.usable) open -= 1;
    this.usable = false;
  }
}

mock.module("imapflow", () => ({ ImapFlow: FakeImapFlow }));
const { isStalledConnect, openClient, verifyCredentials, CONNECT_ATTEMPTS } = await import("@/lib/mail/imap");

afterEach(() => {
  script.length = 0;
  created = 0;
});

describe("connecting", () => {
  test("a stalled connect is tried once more on a fresh client", async () => {
    script.push(failure("CONNECT_TIMEOUT"));
    await verifyCredentials(makeSession({ dev: false }));
    expect(created).toBe(2);
  });

  test("a rejected login is never retried", async () => {
    script.push(failure("ETIMEOUT", { authenticationFailed: true }));
    await expect(verifyCredentials(makeSession({ dev: false }))).rejects.toThrow("ETIMEOUT");
    expect(created).toBe(1);
  });

  test(`gives up after ${CONNECT_ATTEMPTS} stalls, and frees the slot each time`, async () => {
    const session = makeSession({ dev: false });
    // More failed requests than the mailbox has slots: a leaked slot would hang the last ones.
    for (let i = 0; i < 6; i++) {
      script.push(failure("GREETING_TIMEOUT"), failure("GREETING_TIMEOUT"));
      await expect(openClient(session)).rejects.toThrow("GREETING_TIMEOUT");
    }
    expect(created).toBe(6 * CONNECT_ATTEMPTS);
    const { release } = await openClient(session);
    release();
    expect(open).toBe(0);
  });

  test("an aborted request doesn't retry", async () => {
    const controller = new AbortController();
    script.push(failure("CONNECT_TIMEOUT"));
    const pending = openClient(makeSession({ dev: false }), { signal: controller.signal });
    // Mid-connect: the first client exists and its connect hasn't failed yet.
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(created).toBe(1);
    controller.abort();
    // Not expect(pending).rejects: in bun 1.4.4 that spins forever on a promise still
    // pending after an abort.
    const err = await pending.catch((e: unknown) => e);
    expect(isStalledConnect(err)).toBe(true);
    expect(created).toBe(1);
  });

  test("only hangs and drops before sign-in count as stalls", () => {
    expect(isStalledConnect(failure("CONNECT_TIMEOUT"))).toBe(true);
    expect(isStalledConnect(failure("ECONNRESET"))).toBe(true);
    expect(isStalledConnect(failure("ENOTFOUND"))).toBe(false);
    expect(isStalledConnect(failure("ECONNREFUSED"))).toBe(false);
    expect(isStalledConnect(new Error("Command failed"))).toBe(false);
    expect(isStalledConnect(null)).toBe(false);
  });
});
