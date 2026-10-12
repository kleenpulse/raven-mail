import type { NextConfig } from "next";
import pkg from "./package.json";

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
  },
  // sanitize-html stays bundled: it's CommonJS but require()s the ESM-only
  // htmlparser2 12, which crashed at runtime on Vercel (ERR_REQUIRE_ESM).
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "@typesafe-ai/sdk"],
};

export default nextConfig;
