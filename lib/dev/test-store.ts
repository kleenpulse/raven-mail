import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TestHistory, TestReport } from "./test-report";

/** Written by `scripts/test-report.ts`; gitignored. */
export const RESULTS_DIR = path.join(process.cwd(), ".test-results");

async function readJsonFile<T>(file: string): Promise<T | null> {
	try {
		const data = JSON.parse(await readFile(path.join(RESULTS_DIR, file), "utf8")) as { schema?: number };
		return data?.schema === 1 ? (data as T) : null;
	} catch {
		return null;
	}
}

export const readLatest = () => readJsonFile<TestReport>("latest.json");
export const readHistory = () => readJsonFile<TestHistory>("history.json");
