// Tour anchor registry — the only place data-tour ids are minted. Anchors and
// step definitions both import from here so they can't drift. Isomorphic: no
// "use client", no copy — safe in shell chunks and the bun audio script alike.
//
// One id may sit on several elements (rail + mobile tab bar): the engine
// spotlights the first *visible* match, so each viewport finds its own.

export const TOUR_TARGET = {
	heroAsk: "hero-ask",
	needsReply: "needs-reply",
	orbit: "orbit",
	navMail: "nav-mail",
	mailList: "mail-list",
	search: "search",
	compose: "compose",
	navIntegrations: "nav-integrations",
	navSettings: "nav-settings",
} as const;

export type TourTargetId = (typeof TOUR_TARGET)[keyof typeof TOUR_TARGET];

/** Spread onto the anchored element: `<button {...tourAttr(TOUR_TARGET.compose)}>` */
export function tourAttr(id: TourTargetId): { "data-tour": TourTargetId } {
	return { "data-tour": id };
}

/** CSS selector for a minted anchor id — what TOUR_STEPS target. */
export function tourSelector(id: TourTargetId): string {
	return `[data-tour="${id}"]`;
}
