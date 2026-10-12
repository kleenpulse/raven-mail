"use client";

import { RotateCw } from "lucide-react";
import { PaneState } from "@/components/mail/skeletons";
import { Button } from "@/components/ui/button";

/** Last line of defence; sections recover on their own via catchError first. */
export default function IntegrationsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="grid h-full place-items-center">
      <PaneState
        title="Integrations couldn't load"
        tone="critical"
        action={
          <Button variant="surface" size="pill-sm" onClick={() => retry()}>
            <RotateCw />
            Try again
          </Button>
        }
      >
        {error.message || "Something went wrong while drawing this page."}
      </PaneState>
    </div>
  );
}
