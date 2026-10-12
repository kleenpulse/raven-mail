import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { AccountProvider } from "@/components/providers/account-provider";
import { PersistedQueries } from "@/components/providers/persisted-queries";
import { WorkspaceFrame } from "@/components/shell/workspace-frame";
import { PrefsDom } from "@/components/providers/prefs-dom";
import { WhatsNew } from "@/components/whats-new/whats-new";
import { releases } from "@/lib/changelog/data";
import { sessionKey } from "@/lib/server/session-key";
import { TourMount } from "@/components/tour/tour-mount";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const account = {
    email: session.email,
    displayName: session.displayName,
    provider: session.dev ? "dev · local mailbox" : session.provider,
  };

  return (
    <>
      {/* First in the app's markup: prefs land on <html> before anything paints. */}
      <PrefsDom />
      <AccountProvider account={account}>
        <PersistedQueries>
          <WhatsNew releases={releases}>
            <WorkspaceFrame>{children}</WorkspaceFrame>
            <TourMount owner={sessionKey(session)} />
          </WhatsNew>
        </PersistedQueries>
      </AccountProvider>
    </>
  );
}
