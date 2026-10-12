import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseChangelog } from "./parse";

// The statically-analyzable process.cwd() join keeps CHANGELOG.md in the
// output file trace so `next start` and Vercel ship it. Module scope: parsed
// once per server boot.
export const releases = parseChangelog(readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8"));
