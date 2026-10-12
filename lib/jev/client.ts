import "server-only";
import { TypeSafeClient } from "@typesafe-ai/sdk";

let client: TypeSafeClient | null = null;

export function jevEnabled(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}

/** One client per process. Interactive asks can't wait out long retry chains. */
export function getJevClient(): TypeSafeClient {
  client ??= new TypeSafeClient({
    defaultModel: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || "jev-latest",
    timeout: 8_000,
    retry: { maxRetries: 1 },
  });
  return client;
}
