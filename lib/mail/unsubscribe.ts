import "server-only";
import { HttpError } from "@/lib/server/guard";
import { parseHttpUrl } from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { outboundPolicy, safeFetch } from "@/lib/integrations/safe-fetch";

const TIMEOUT_MS = 10_000;

/**
 * RFC 8058 one-click: a bare POST of `List-Unsubscribe=One-Click`, no cookies,
 * no redirects followed, private networks blocked at the socket. A 3xx counts:
 * senders often answer the POST with a redirect to a "you're out" page.
 */
export async function oneClickUnsubscribe(target: string): Promise<void> {
  let ok = false;
  try {
    const url = parseHttpUrl(target, outboundPolicy());
    if (url.protocol !== "https:") throw new IntegrationError("insecure_url");
    const res = await safeFetch(
      {
        method: "POST",
        url,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      },
      { timeoutMs: TIMEOUT_MS },
    );
    ok = res.status >= 200 && res.status < 400;
  } catch (err) {
    if (err instanceof IntegrationError && err.code === "unconfirmed") {
      throw new HttpError(502, "Their server didn't answer in time. It may still have worked.", "unsubscribe_unconfirmed");
    }
    if (!(err instanceof IntegrationError)) console.error("[unsubscribe]", err);
  }
  if (!ok) throw new HttpError(502, "Their server didn't confirm it.", "unsubscribe_failed");
}
