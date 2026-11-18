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

describe("buildRawMessage inline images", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");

  test("a cid image sits beside the HTML (multipart/related); a plain file stays a normal attachment", async () => {
    const { raw } = await buildRawMessage(makeSession({ dev: false }), {
      ...draft("a@x.com"),
      text: "[image: shot.png]",
      html: '<p><img src="cid:abc123@raven.mail" alt="shot.png" width="560"></p>',
      attachments: [
        { filename: "shot.png", contentType: "image/png", contentBase64: png, cid: "abc123@raven.mail" },
        { filename: "notes.pdf", contentType: "application/pdf", contentBase64: "aGk=" },
      ],
    });
    const mime = raw.toString();
    const mixed = mime.indexOf("Content-Type: multipart/mixed");
    const related = mime.indexOf("Content-Type: multipart/related");
    const image = mime.indexOf("Content-Type: image/png");
    const pdf = mime.indexOf("Content-Type: application/pdf");
    expect(mixed).toBeGreaterThan(-1);
    expect(related).toBeGreaterThan(mixed);
    expect(image).toBeGreaterThan(related);
    expect(pdf).toBeGreaterThan(image);
    expect(mime).toMatch(/^Content-ID: <abc123@raven\.mail>$/m);
    expect(mime.match(/^Content-ID:/gm)).toHaveLength(1);
    expect(mime).toMatch(/Content-Disposition: inline; filename="?shot\.png"?/);
    expect(mime).toMatch(/Content-Disposition: attachment; filename="?notes\.pdf"?/);
  });
});
