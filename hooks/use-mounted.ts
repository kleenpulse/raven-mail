"use client";

import * as React from "react";

const subscribe = () => () => {};

/** False during SSR + hydration, true after — for clock/timezone-dependent UI. */
export function useMounted(): boolean {
	return React.useSyncExternalStore(subscribe, () => true, () => false);
}
