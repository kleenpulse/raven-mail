import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import { OverviewBoard } from "@/components/overview/board";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const session = await getSession();
  const firstName = session?.displayName.split(/\s+/)[0] || "there";
  const jevLive = Boolean(process.env.TYPESAFE_API_KEY?.trim());
  return <OverviewBoard firstName={firstName} jevLive={jevLive} />;
}
