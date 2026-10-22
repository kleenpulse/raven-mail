import { describe, expect, test } from "bun:test";
import { buildRawMessage } from "@/lib/mail/smtp";
import { makeSession } from "@/test/helpers/session";

const draft = (to: string, cc = "") => ({ to, cc, bcc: "", subject: "Hi", text: "Body" });

describe("buildRawMessage recipients", () => {
  test("a quoted 'Last, First' name is one recipient, not two", async () => {
    const { raw, envelope } = await buildRawMessage(
      makeSession({ dev: false }),
      draft(`"Chen, Maya" <maya@x.com>, b@y.org`, `"Ops; Night" <ops@x.com>`),
    );
    expect(envelope.to).toEqual(["maya@x.com", "b@y.org", "ops@x.com"]);
    const headers = raw.toString().split("\r\n\r\n")[0]!;
    expect(headers).toMatch(/^To: "Chen, Maya" <maya@x\.com>, b@y\.org$/m);
    expect(headers).toMatch(/^Cc: "Ops; Night" <ops@x\.com>$/m);
  });
});
