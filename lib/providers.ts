export type ProviderId =
  | "gmail"
  | "outlook"
  | "yahoo"
  | "icloud"
  | "fastmail"
  | "proton"
  | "custom";

export type ServerEndpoint = {
  host: string;
  port: number;
  secure: boolean;
};

/**
 * What goes in the password field. "app" providers refuse the account
 * password over IMAP/SMTP outright, so the form asks for an app password only.
 */
export type PasswordKind = "app" | "app-or-account" | "bridge" | "account";

export type ProviderPreset = {
  id: ProviderId;
  label: string;
  hint: string;
  password: {
    kind: PasswordKind;
    /** Where to create one, when the provider has a stable page for it. */
    help?: { href: string; label: string };
  };
  imap: ServerEndpoint;
  smtp: ServerEndpoint;
};

export const PROVIDERS: ProviderPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    hint: "Google only accepts an app password here, not your Google password. It needs 2-Step Verification on, and IMAP enabled in Gmail settings.",
    password: { kind: "app", help: { href: "https://myaccount.google.com/apppasswords", label: "Create a Google app password" } },
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
  },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    hint: "Use an app password if two-step verification is on, otherwise your account password. IMAP must be enabled.",
    password: { kind: "app-or-account" },
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    hint: "Yahoo only accepts an app password here. Generate one under Account Security.",
    password: { kind: "app", help: { href: "https://login.yahoo.com/account/security", label: "Open Yahoo account security" } },
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
  },
  {
    id: "icloud",
    label: "iCloud Mail",
    hint: "iCloud only accepts an app-specific password here, from your Apple Account's Sign-In and Security page.",
    password: { kind: "app", help: { href: "https://account.apple.com", label: "Open your Apple Account" } },
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
  },
  {
    id: "fastmail",
    label: "Fastmail",
    hint: "Fastmail only accepts an app password with IMAP and SMTP access (Settings → Privacy & Security).",
    password: { kind: "app" },
    imap: { host: "imap.fastmail.com", port: 993, secure: true },
    smtp: { host: "smtp.fastmail.com", port: 465, secure: true },
  },
  {
    id: "proton",
    label: "Proton Mail (Bridge)",
    hint: "Requires Proton Bridge running locally. Password comes from Bridge.",
    password: { kind: "bridge" },
    imap: { host: "127.0.0.1", port: 1143, secure: false },
    smtp: { host: "127.0.0.1", port: 1025, secure: false },
  },
  {
    id: "custom",
    label: "Custom IMAP / SMTP",
    hint: "Enter your own server hosts, ports, and credentials.",
    password: { kind: "account" },
    imap: { host: "", port: 993, secure: true },
    smtp: { host: "", port: 465, secure: true },
  },
];

export function getProvider(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1]!;
}
