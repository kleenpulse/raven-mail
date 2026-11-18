import type { NextConfig } from "next";
import pkg from "./package.json";
import { SEND_LIMITS } from "./lib/mail/send-limits";

// Send and Save are Server Actions that carry a message's files as base64. Next's
// default body limit is 1 MB, which a single screenshot can pass. The whole body
// is read before the action checks the session, so this is also the most one
// request without a login can make the server hold: 26 MB on Docker and desktop
// (desktop listens on loopback only). Vercel caps requests at 4.5 MB itself.
// Adding a proxy.ts would cap bodies at 10 MB again (proxyClientMaxBodySize).
const sendLimits = process.env.VERCEL ? SEND_LIMITS.vercel : SEND_LIMITS.selfHosted;

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image; Vercel ignores it.
  output: "standalone",
  // Bottom-left is the nav rail's account button.
  devIndicators: { position: "bottom-right" },
  env: {
    // Busts the persisted query cache (IndexedDB) on every build, so a cached
    // payload never meets code that expects another shape.
    BUILD_STAMP: String(Date.now()),
    // Inlined, so client code gets the version without bundling package.json.
    APP_VERSION: pkg.version,
    // "1" only for the desktop app's builds. Code that loads PGlite checks it,
    // so web builds compile that code away and never bundle the wasm.
    RAVEN_DESKTOP_BUILD: process.env.RAVEN_DESKTOP_BUILD ?? "",
    // What compose lets one message weigh, kept under the body limit below.
    SEND_BUDGET_BYTES: String(sendLimits.budget),
  },
  // sanitize-html stays bundled: it's CommonJS but require()s the ESM-only
  // htmlparser2 12, which crashed at runtime on Vercel (ERR_REQUIRE_ESM).
  // PGlite reads its wasm next to its own files, which bundling would break.
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "@typesafe-ai/sdk", "@electric-sql/pglite"],
  experimental: {
    // Offline detection + HEAD polling behind `useOffline` (next/offline); bridged into TanStack in QueryProvider.
    useOffline: true,
    serverActions: { bodySizeLimit: sendLimits.body },
  },
};

export default nextConfig;
