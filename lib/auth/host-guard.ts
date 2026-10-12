import "server-only";
import { lookup } from "node:dns/promises";
import { isLoopbackHost, isPrivateAddress } from "@/lib/auth/ip";

/**
 * Custom IMAP/SMTP hosts come from anonymous visitors of the login page; in
 * production they must not reach loopback/private networks (port scanning via
 * connection errors). Local dev and Proton Bridge setups opt in via env.
 */
export async function assertPublicMailHost(host: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.ALLOW_PRIVATE_MAIL_HOSTS === "true") return;
  if (isLoopbackHost(host) && process.env.ALLOW_LOOPBACK_MAIL_HOSTS === "true") return;

  let addresses: string[];
  try {
    addresses = (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw new Error(`Could not resolve ${host}.`);
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error("That mail server address is not allowed.");
  }
}
