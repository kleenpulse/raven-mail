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

describe("buildRawMessage bodies", () => {
  test("an HTML body goes out as multipart/alternative with the text part first", async () => {
    const { raw } = await buildRawMessage(makeSession({ dev: false }), {
      ...draft("a@x.com"),
      text: "- one\n- two",
      html: "<ul><li><p>one</p></li><li><p>two</p></li></ul>",
    });
    const mime = raw.toString();
    expect(mime).toMatch(/Content-Type: multipart\/alternative/);
    const plain = mime.indexOf("Content-Type: text/plain");
    const html = mime.indexOf("Content-Type: text/html");
    expect(plain).toBeGreaterThan(-1);
    expect(html).toBeGreaterThan(plain);
  });

  test("no HTML: a single text/plain body, as before", async () => {
    const mime = (await buildRawMessage(makeSession({ dev: false }), draft("a@x.com"))).raw.toString();
    expect(mime).not.toMatch(/multipart\/alternative/);
    expect(mime).toMatch(/Content-Type: text\/plain/);
  });
});
