"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, CircleAlert, Eye, EyeOff, LoaderCircle, Server, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { loginAction, type LoginResult } from "@/lib/actions/auth";
import { PROVIDERS, type PasswordKind, type ProviderId } from "@/lib/providers";
import { cn } from "@/lib/utils";

const fieldClass = "h-11 rounded-xl px-3.5";

// Lets <SelectValue> show "Gmail" rather than the raw id.
const PROVIDER_ITEMS = PROVIDERS.map((p) => ({ value: p.id, label: p.label }));

const EMAIL_PLACEHOLDER: Record<ProviderId, string> = {
  gmail: "you@gmail.com",
  outlook: "you@outlook.com",
  yahoo: "you@yahoo.com",
  icloud: "you@icloud.com",
  fastmail: "you@fastmail.com",
  proton: "you@proton.me",
  custom: "you@example.com",
};

const PASSWORD_FIELD: Record<PasswordKind, { label: string; placeholder: string }> = {
  app: { label: "App password", placeholder: "abcd efgh ijkl mnop" },
  "app-or-account": { label: "Password or app password", placeholder: "••••••••••••" },
  bridge: { label: "Bridge password", placeholder: "From Proton Bridge" },
  account: { label: "Password", placeholder: "••••••••••••" },
};

type Failure = Extract<LoginResult, { ok: false }>;

/** Stays on screen (unlike a toast) so the fix can be read while doing it. */
function LoginError({ failure }: { failure: Failure }) {
  return (
    <div
      role="alert"
      className="rounded-[18px] bg-critical/8 px-4 py-3.5 text-[13px] ring-1 ring-critical/25"
    >
      <p className="flex items-start gap-2 font-medium text-foreground">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />
        {failure.error}
      </p>
      {failure.hint && <p className="mt-1.5 pl-6 leading-relaxed text-ink-2">{failure.hint}</p>}
      {failure.help && (
        <a
          href={failure.help.href}
          target="_blank"
          rel="noreferrer"
          className="mt-2 ml-6 inline-flex items-center gap-1 text-signal-ink hover:underline dark:text-signal"
        >
          {failure.help.label}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      )}
      {failure.detail && (
        <details className="mt-2 pl-6 text-[12px] text-ink-2">
          <summary className="cursor-pointer select-none hover:text-foreground">What the server said</summary>
          <p className="mt-1.5 font-mono text-[11px] leading-relaxed break-words">{failure.detail}</p>
        </details>
      )}
    </div>
  );
}

function CustomRow({
  name,
  label,
  defaultPort,
  defaultSecure,
  invalid,
  describedBy,
}: {
  name: "imap" | "smtp";
  label: string;
  defaultPort: number;
  defaultSecure: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <fieldset className="grid gap-3 rounded-[20px] bg-card-nested p-4 ring-1 ring-border dark:ring-glass-border">
      <legend className="sr-only">{label} server</legend>
      <div aria-hidden className="readout">
        {label}
      </div>
      <div className="grid grid-cols-[1fr_5.5rem] gap-2">
        <Input
          name={`${name}Host`}
          aria-label={`${label} host`}
          placeholder={name === "imap" ? "imap.example.com" : "smtp.example.com"}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={fieldClass}
        />
        <Input
          name={`${name}Port`}
          aria-label={`${label} port`}
          type="number"
          defaultValue={defaultPort}
          inputMode="numeric"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(fieldClass, "font-mono tabular")}
        />
      </div>
      <label className="flex items-center gap-2.5 text-[12px] leading-snug text-ink-2">
        <Checkbox name={`${name}Secure`} defaultChecked={defaultSecure} value="on" />
        TLS on connect (port {name === "imap" ? 993 : 465}) — uncheck for STARTTLS ({name === "imap" ? 143 : 587})
      </label>
    </fieldset>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [provider, setProvider] = React.useState<ProviderId>("gmail");
  const selected = PROVIDERS.find((p) => p.id === provider)!;
  const passwordField = PASSWORD_FIELD[selected.password.kind];
  const passwordRef = React.useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const emailRef = React.useRef<HTMLInputElement>(null);

  const [state, formAction, pending] = useActionState<LoginResult | null, FormData>(loginAction, null);
  // Switching provider makes the last error stale, so it's hidden until the next attempt.
  const [dismissed, setDismissed] = React.useState<LoginResult | null>(null);
  const failure = state && !state.ok && state !== dismissed ? state : null;
  const errorId = React.useId();
  const serverInvalid = failure?.field === "server" ? { invalid: true, describedBy: errorId } : {};

  React.useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(`Connected ${state.data.email}`);
      router.push("/overview");
      router.refresh();
    } else if (state.field === "password") {
      passwordRef.current?.select();
    } else if (state.field === "email") {
      emailRef.current?.focus();
    }
  }, [state, router]);

  return (
    <form
      action={formAction}
      // Submitting through a transition skips React's automatic form reset, so a
      // failed attempt keeps what was typed (the action path would clear it all).
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        React.startTransition(() => formAction(data));
      }}
      className="mt-6 space-y-4"
    >
      <input type="hidden" name="provider" value={provider} />

      <div className="space-y-2">
        <Label htmlFor="provider">Provider</Label>
        <Select
          items={PROVIDER_ITEMS}
          value={provider}
          onValueChange={(value) => {
            setProvider(value as ProviderId);
            setDismissed(state);
          }}
        >
          <SelectTrigger
            id="provider"
            className="w-full rounded-xl bg-sheet px-3.5 data-[size=default]:h-11 dark:bg-card-nested dark:hover:bg-card-nested"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[12px] leading-relaxed text-ink-2">{selected.hint}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          placeholder={EMAIL_PLACEHOLDER[provider]}
          ref={emailRef}
          aria-invalid={failure?.field === "email" || undefined}
          aria-describedby={failure?.field === "email" ? errorId : undefined}
          className={fieldClass}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="password">{passwordField.label}</Label>
          {selected.password.help && (
            <a
              href={selected.password.help.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-[12px] text-signal-ink hover:underline dark:text-signal"
            >
              Create one
              <ArrowUpRight aria-hidden className="size-3" />
            </a>
          )}
        </div>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            spellCheck={false}
            placeholder={passwordField.placeholder}
            ref={passwordRef}
            aria-invalid={failure?.field === "password" || undefined}
            aria-describedby={failure?.field === "password" ? errorId : undefined}
            className={cn(fieldClass, "pr-11")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            // Keep the caret in the field while toggling.
            onMouseDown={(e) => e.preventDefault()}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-controls="password"
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-1 my-auto grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="displayName">
          Display name <span className="font-normal text-ink-2">optional</span>
        </Label>
        <Input
          id="displayName"
          name="displayName"
          placeholder="Ada Lovelace"
          autoComplete="name"
          className={fieldClass}
        />
      </div>

      {provider === "custom" && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-[12px] text-ink-2">
            <Server aria-hidden className="size-3.5" />
            Custom servers
          </p>
          <CustomRow name="imap" label="IMAP" defaultPort={993} defaultSecure {...serverInvalid} />
          <CustomRow name="smtp" label="SMTP" defaultPort={465} defaultSecure {...serverInvalid} />
        </div>
      )}

      {failure && (
        <div id={errorId}>
          <LoginError failure={failure} />
        </div>
      )}

      <div className="space-y-3 pt-1">
        <Button type="submit" size="pill" className="h-11 w-full" disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="animate-spin" />
              Verifying connection…
            </>
          ) : (
            <>
              Connect mailbox
              <ArrowRight data-icon="inline-end" />
            </>
          )}
        </Button>
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-2">
          <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Credentials are encrypted into an http-only session cookie on this device — never
          stored in a database.
        </p>
      </div>
    </form>
  );
}
