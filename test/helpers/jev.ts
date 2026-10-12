import type { Jev } from "@/lib/jev/client";
import { fakeJev } from "../state";

export { fakeJev };

/** The Jev a caller gets while `fakeJev.enabled`, else null. Read at call time. */
export function testJev(): Jev | null {
	return fakeJev.enabled ? fakeJevAccess("server") : null;
}

export function fakeJevAccess(source: Jev["source"]): Jev {
	return { client: fakeJev.client as unknown as Jev["client"], source };
}

type Answer = Record<string, unknown>;

/** Shape a `systemOne` response: `{ answers: { key: {...} } }`. */
export function answers(map: Record<string, Answer>) {
	return { answers: map };
}
