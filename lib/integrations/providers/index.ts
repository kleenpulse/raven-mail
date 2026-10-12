import type { ConnectionKind } from "../types";
import { discord } from "./discord";
import type { ProviderSpec } from "./shared";
import { slack } from "./slack";
import { webhook } from "./webhook";

export const PROVIDERS: Record<ConnectionKind, ProviderSpec> = { slack, discord, webhook };

export type { ParsedTarget, ProviderSpec, Target } from "./shared";
