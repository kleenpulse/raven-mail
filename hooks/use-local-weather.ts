"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/components/providers/account-provider";
import { getJson } from "@/hooks/use-mail";
import { usePref } from "@/lib/prefs/store";
import { qk } from "@/lib/query-keys";
import type { WeatherReply } from "@/lib/weather/forecast";

/** Where the user said they are (rounded to about 1 km), or that they said no. This device only. */
const STORAGE_KEY = "raven:weather-place";

/** `label` is set when the user picked a city by name. */
type Place = { lat: number; lon: number; label?: string } | { declined: true };

const round = (n: number) => Math.round(n * 100) / 100;

/** The desktop app refuses location (Electron's location service needs a Google key), so it asks for a city. */
const DESKTOP = Boolean(process.env.RAVEN_DESKTOP_BUILD);

function parsePlace(stored: string | null): Place | null {
	try {
		const raw = JSON.parse(stored ?? "null") as Partial<{ lat: number; lon: number; label: string; declined: boolean }> | null;
		if (raw?.declined) return { declined: true };
		if (typeof raw?.lat === "number" && typeof raw.lon === "number") {
			const label = typeof raw.label === "string" && raw.label.length <= 80 ? raw.label : undefined;
			return label ? { lat: raw.lat, lon: raw.lon, label } : { lat: raw.lat, lon: raw.lon };
		}
	} catch {
		// Corrupt or blocked storage: start over.
	}
	return null;
}

const listeners = new Set<() => void>();
/** Used when storage is blocked (private mode), so a shared place still works for this visit. */
let memory: string | null = null;

function readStored(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY) ?? memory;
	} catch {
		return memory;
	}
}

function savePlace(place: Place) {
	memory = JSON.stringify(place);
	try {
		localStorage.setItem(STORAGE_KEY, memory);
	} catch {
		// Private mode: `memory` keeps it for this visit.
	}
	for (const notify of listeners) notify();
}

/** Drops a shared place or a "no" from this device: when the setting changes, and on sign-out. */
export function forgetWeatherPlace() {
	memory = null;
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Blocked storage held nothing.
	}
	for (const notify of listeners) notify();
}

function subscribe(notify: () => void) {
	listeners.add(notify);
	window.addEventListener("storage", notify);
	return () => {
		listeners.delete(notify);
		window.removeEventListener("storage", notify);
	};
}

/**
 * Local weather for the Overview. The server locates the user by IP where it
 * can (Vercel); elsewhere `canLocate` is true and `locate()` asks the browser
 * once. A "no" is remembered, so Raven doesn't ask again until the setting
 * is switched off and on; after a "no", and always on desktop, `canChoose`
 * offers typing a city instead. Off (`overview.localWeather`), nothing is
 * looked up.
 */
export function useLocalWeather() {
	const { email } = useAccount();
	const on = usePref("overview.localWeather");
	// undefined on the server and during hydration: localStorage only exists in the browser.
	const stored = React.useSyncExternalStore(subscribe, readStored, () => undefined);
	const place = React.useMemo(() => (stored === undefined ? undefined : parsePlace(stored)), [stored]);
	const [locating, setLocating] = React.useState(false);

	const coords = place && "lat" in place ? place : null;
	const query = useQuery({
		queryKey: qk.weather(email, coords ? `${coords.lat},${coords.lon}` : "ip"),
		queryFn: ({ signal }) =>
			getJson<WeatherReply>(coords ? `/api/weather?lat=${coords.lat}&lon=${coords.lon}` : "/api/weather", signal),
		enabled: on && place !== undefined,
		staleTime: 15 * 60_000,
		refetchInterval: 30 * 60_000,
		retry: false,
	});

	const locate = React.useCallback(() => {
		if (!("geolocation" in navigator)) return;
		setLocating(true);
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				const next = { lat: round(pos.coords.latitude), lon: round(pos.coords.longitude) };
				savePlace(next);
				setLocating(false);
			},
			(err) => {
				if (err.code === err.PERMISSION_DENIED) savePlace({ declined: true });
				setLocating(false);
			},
			{ enableHighAccuracy: false, maximumAge: 60 * 60_000, timeout: 10_000 },
		);
	}, []);

	const choosePlace = React.useCallback((picked: { lat: number; lon: number; label: string }) => {
		savePlace({ lat: round(picked.lat), lon: round(picked.lon), label: picked.label.slice(0, 80) });
	}, []);

	const declined = place !== undefined && place !== null && "declined" in place;
	const geolocation = !DESKTOP && typeof navigator !== "undefined" && "geolocation" in navigator;
	const unlocated = on && query.data?.located === false;
	return {
		on,
		reply: on ? query.data : undefined,
		/** The city the user picked, when they picked one. */
		placeLabel: coords?.label ?? null,
		canLocate: unlocated && !declined && geolocation,
		locate,
		locating,
		/** Typing a city: on desktop, and on the web once the browser's location was refused. */
		canChoose: unlocated && (declined || !geolocation),
		choosePlace,
	};
}
