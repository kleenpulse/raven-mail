import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import { jevStatus } from "@/lib/jev/client";
import { OverviewBoard } from "@/components/overview/board";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const session = await getSession();
  const firstName = session?.displayName.split(/\s+/)[0] || "there";
  const jevLive = jevStatus(session).source !== null;
  return <OverviewBoard firstName={firstName} jevLive={jevLive} />;
}
