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
import { useLocalWeather } from "@/hooks/use-local-weather";
import { describeSky, formatTemperature, usesFahrenheit, type SkyKind } from "@/lib/weather/codes";

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

/** The real weather where the user is, under the date. Says nothing rather than guess; off in Settings, shows nothing. */
export function LocalWeather() {
	const { on, reply, placeLabel, canLocate, locate, locating, canChoose, choosePlace } = useLocalWeather();
	if (!on) return null;
	const sky = reply?.weather ? describeSky(reply.weather.code) : null;

	if (reply?.weather && sky) {
		const Icon = ICON[sky.kind][reply.weather.isDay ? "day" : "night"];
		const temperature = formatTemperature(reply.weather.temperatureC, usesFahrenheit(navigator.language));
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
