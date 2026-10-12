export { fakeJev } from "../state";

type Answer = Record<string, unknown>;

/** Shape a `systemOne` response: `{ answers: { key: {...} } }`. */
export function answers(map: Record<string, Answer>) {
	return { answers: map };
}
