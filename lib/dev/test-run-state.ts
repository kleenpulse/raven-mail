import { emptyCounts, type Counts, type TestHistory, type TestReport, type TestRunEvent, type TestStatus } from "./test-report";

export type RunDot = { status: TestStatus; name: string; file: string; ms?: number };

/** Live state of a run streamed from /api/dev/tests/run. */
export type RunState = {
	status: "idle" | "running" | "done" | "error";
	runId?: string;
	counts: Counts;
	currentFile?: string;
	files: number;
	/** One entry per finished test, in arrival order. */
	dots: RunDot[];
	report?: TestReport;
	history?: TestHistory;
	error?: string;
};

export const IDLE_RUN: RunState = { status: "idle", counts: emptyCounts(), files: 0, dots: [] };

export const RUNNING: RunState = { ...IDLE_RUN, status: "running" };

export function applyRunEvent(state: RunState, event: TestRunEvent): RunState {
	switch (event.type) {
		case "start":
			return { ...RUNNING, runId: event.runId };
		case "file":
			return { ...state, currentFile: event.file, files: state.files + 1 };
		case "test": {
			const counts = { ...state.counts, total: state.counts.total + 1, [event.status]: state.counts[event.status] + 1 };
			const dot: RunDot = { status: event.status, name: event.name, file: event.file, ...(event.ms === undefined ? {} : { ms: event.ms }) };
			return { ...state, counts, dots: [...state.dots, dot] };
		}
		case "done":
			return { ...state, status: "done", currentFile: undefined, counts: event.report.counts, report: event.report, history: event.history };
		case "error":
			return { ...state, status: "error", error: event.message };
	}
}
