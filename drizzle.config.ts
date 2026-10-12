import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read .env files itself. Mirror Next's precedence:
// .env.local wins over .env (loadEnvFile never overrides an already-set var).
for (const file of [".env.local", ".env"]) {
	try {
		process.loadEnvFile(file);
	} catch {
		// file absent — rely on the ambient environment
	}
}

// Migrations must use the direct connection: Neon's pooled endpoint (PgBouncer,
// transaction mode) drops session state that DDL tooling relies on.
function directUrl(): string {
	const direct = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL_DIRECT;
	if (direct) return direct;
	const pooled = process.env.DATABASE_URL;
	if (!pooled) throw new Error("DATABASE_URL is not set (see .env.example).");
	return pooled.replace("-pooler.", ".");
}

export default defineConfig({
	schema: "./lib/db/schema.ts",
	out: "./lib/db/migrations",
	dialect: "postgresql",
	dbCredentials: { url: directUrl() },
	strict: true,
	verbose: true,
});
