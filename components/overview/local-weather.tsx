"use client";

import * as React from "react";
import {
	Cloud,
	CloudDrizzle,
	CloudFog,
	CloudHail,
	CloudLightning,
	CloudMoon,
	CloudRain,
	CloudSnow,
	CloudSun,
	MapPin,
	Moon,
	Sun,
} from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { WeatherCityPicker } from "@/components/overview/weather-city-picker";
import { useLocalWeather, useTemperatureUnit } from "@/hooks/use-local-weather";
import { setPref } from "@/lib/prefs/store";
import { describeSky, formatTemperature, type SkyKind } from "@/lib/weather/codes";

const ICON: Record<SkyKind, { day: typeof Sun; night: typeof Sun }> = {
	clear: { day: Sun, night: Moon },
	partly: { day: CloudSun, night: CloudMoon },
	cloudy: { day: Cloud, night: Cloud },
	fog: { day: CloudFog, night: CloudFog },
	drizzle: { day: CloudDrizzle, night: CloudDrizzle },
	rain: { day: CloudRain, night: CloudRain },
	snow: { day: CloudSnow, night: CloudSnow },
	storm: { day: CloudLightning, night: CloudLightning },
	hail: { day: CloudHail, night: CloudHail },
};

const LINE = "mt-1 flex h-[18px] w-fit items-center gap-1.5 text-[12px] text-ink-2";

const UNIT_CHOICE =
	"-my-px h-[18px] rounded-pill px-1.5 leading-none text-foreground tabular ring-1 ring-border outline-none transition-colors hover:bg-signal-soft focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] dark:ring-glass-border";

/** The real weather where the user is, under the date. Says nothing rather than guess; off in Settings, shows nothing. */
export function LocalWeather() {
	const { on, reply, placeLabel, canLocate, locate, locating, canChoose, choosePlace } = useLocalWeather();
	const { unit, answered } = useTemperatureUnit();
	if (!on) return null;
	const sky = reply?.weather ? describeSky(reply.weather.code) : null;

	if (reply?.weather && sky) {
		const Icon = ICON[sky.kind][reply.weather.isDay ? "day" : "night"];
		const celsius = reply.weather.temperatureC;

		// The first time the weather shows, the user picks the unit by clicking the reading they know.
		if (!answered) {
			return (
				<Tip label="Pick how Raven shows the temperature. You can change it later in Settings." render={<div role="group" aria-label="Temperature unit" className={LINE} />}>
					<Icon className="size-3.5 text-signal-ink dark:text-signal" aria-hidden />
					<span>{sky.label}</span>
					<span aria-hidden>·</span>
					<button type="button" aria-label="Show in Celsius" onClick={() => setPref("overview.temperatureUnit", "celsius")} className={UNIT_CHOICE}>
						{formatTemperature(celsius, false)}
					</button>
					<span>or</span>
					<button type="button" aria-label="Show in Fahrenheit" onClick={() => setPref("overview.temperatureUnit", "fahrenheit")} className={UNIT_CHOICE}>
						{formatTemperature(celsius, true)}
					</button>
					<span aria-hidden className="-ml-1">?</span>
				</Tip>
			);
		}

		const temperature = formatTemperature(celsius, unit === "fahrenheit");
		const place = reply.place ?? placeLabel;
		const where = place ? ` in ${place}` : "";
		return (
			<Tip label={`${sky.label}${where}, ${temperature}. Weather from Open-Meteo.`} render={<div className={LINE} />}>
				<Icon className="size-3.5 text-signal-ink dark:text-signal" aria-hidden />
				<span>{sky.label}</span>
				<span aria-hidden>·</span>
				<span className="tabular">{temperature}</span>
			</Tip>
		);
	}

	if (canLocate) {
		return (
			<button type="button" onClick={locate} disabled={locating} className={`${LINE} transition-colors hover:text-foreground disabled:opacity-60`}>
				<MapPin className="size-3.5" aria-hidden />
				{locating ? "Finding you…" : "Show local weather"}
			</button>
		);
	}

	if (canChoose) {
		return <WeatherCityPicker onPick={choosePlace} className={`${LINE} transition-colors hover:text-foreground`} />;
	}

	// Keeps the date block from jumping when the weather arrives.
	return <div className={LINE} aria-hidden />;
}
