"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { devLoginAction } from "@/lib/actions/auth";

export function DevLoginButton() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function handleDevLogin() {
    startTransition(async () => {
      const result = await devLoginAction();
      if (result.ok) {
        toast.success(`Dev mailbox ready — ${result.data.email}`);
        router.push("/overview");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="mt-5 space-y-3">
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border dark:bg-glass-border" />
        <span className="readout">or</span>
        <span className="h-px flex-1 bg-border dark:bg-glass-border" />
      </div>

      <Button
        type="button"
        variant="surface"
        size="pill"
        className="h-11 w-full"
        disabled={pending}
        onClick={handleDevLogin}
      >
        {pending ? (
          <>
            <LoaderCircle className="animate-spin" />
            Loading dev mailbox…
          </>
        ) : (
          <>
            <FlaskConical />
            Continue in dev mode
          </>
        )}
      </Button>

      <p className="text-center text-[12px] leading-relaxed text-ink-2">
        Seeded mock mailbox — no account, no network. Off in production.
      </p>
    </div>
  );
}
