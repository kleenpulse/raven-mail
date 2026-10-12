import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { MAIL_LAYOUT_COOKIE, parseMailLayout } from "@/lib/mail/reader-layout";

export const metadata: Metadata = { title: "Mail" };

export default async function MailPage() {
  const layout = parseMailLayout((await cookies()).get(MAIL_LAYOUT_COOKIE)?.value);
  return <AppShell initialLayout={layout} />;
}
