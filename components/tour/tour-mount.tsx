"use client";

import "driver.js/dist/driver.css";
import "./tour.css";
import { useEffect } from "react";
import { initTourState } from "@/lib/tour/state";
import { useTour } from "./use-tour";

// Mounted once in the (app) layout, which persists across page swaps, so the
// engine never lives in page state. `owner` is an opaque per-mailbox id: the
// device copy of the tour is only trusted when it belongs to this mailbox.
export function TourMount({ owner }: { owner: string }) {
	useEffect(() => {
		initTourState(owner);
	}, [owner]);
	useTour();
	return null;
}
