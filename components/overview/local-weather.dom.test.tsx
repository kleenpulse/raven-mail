import { jsonResponse } from "@/test/dom";
import { afterEach, describe, expect, test } from "bun:test";
import type { WeatherReply } from "@/lib/weather/forecast";

const React = await import("react");
const { render, screen, cleanup, waitFor, act, fireEvent } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { AccountProvider } = await import("@/components/providers/account-provider");
const { LocalWeather } = await import("./local-weather");
const { forgetWeatherPlace } = await import("@/hooks/use-local-weather");
const { getPref, resetPrefs, setPref, usePrefsStore } = await import("@/lib/prefs/store");

const realFetch = globalThis.fetch;
const urls: string[] = [];
let reply: WeatherReply = { located: true, place: "Lagos", weather: { code: 61, temperatureC: 24, isDay: true } };

function stubServer() {
	globalThis.fetch = (async (url: string) => {
		urls.push(url);
		return jsonResponse({ ok: true, data: reply });
	}) as typeof fetch;
}

afterEach(() => {
	cleanup();
	urls.length = 0;
	forgetWeatherPlace();
	resetPrefs();
	globalThis.fetch = realFetch;
	reply = { located: true, place: "Lagos", weather: { code: 61, temperatureC: 24, isDay: true } };
});

const account = { email: "me@home.example", displayName: "Me", provider: "custom", jev: { source: null, hint: null } } as never;

function wrap() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<AccountProvider account={account}>
				<LocalWeather />
			</AccountProvider>
		</QueryClientProvider>,
	);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("LocalWeather", () => {
	test("shows the sky and the temperature the server found", async () => {
		setPref("overview.temperatureUnit", "celsius");
		stubServer();
		wrap();
		await waitFor(() => expect(screen.getByText("Light rain")).toBeTruthy());
		expect(screen.getByText("24°C")).toBeTruthy();
		expect(screen.queryByText("75°F") === null).toBe(true);
		expect(urls).toEqual(["/api/weather"]);
	});

	test("the picked unit is the one it shows", async () => {
		setPref("overview.temperatureUnit", "fahrenheit");
		stubServer();
		wrap();
		await waitFor(() => expect(screen.getByText("75°F")).toBeTruthy());
		expect(screen.queryByRole("button", { name: /show in/i }) === null).toBe(true);
	});

	test("the first time, it asks °C or °F, and the answer sticks", async () => {
		stubServer();
		wrap();
		const fahrenheit = await waitFor(() => screen.getByRole("button", { name: "Show in Fahrenheit" }));
		expect(screen.getByRole("button", { name: "Show in Celsius" }).textContent).toBe("24°C");
		expect(fahrenheit.textContent).toBe("75°F");
		await act(async () => fireEvent.click(fahrenheit));
		expect(getPref("overview.temperatureUnit")).toBe("fahrenheit");
		expect(screen.queryByRole("button", { name: /show in/i }) === null).toBe(true);
		expect(screen.getByText("75°F")).toBeTruthy();
	});

	test("picking the guessed unit still counts as an answer", async () => {
		stubServer();
		wrap();
		const celsius = await waitFor(() => screen.getByRole("button", { name: "Show in Celsius" }));
		await act(async () => fireEvent.click(celsius));
		expect("overview.temperatureUnit" in usePrefsStore.getState().overrides).toBe(true);
		expect(screen.getByText("24°C")).toBeTruthy();
	});

	test("offers to ask the browser when the server can't place the user", async () => {
		reply = { located: false, place: null, weather: null };
		stubServer();
		Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition() {} }, configurable: true });
		wrap();
		await waitFor(() => expect(screen.getByRole("button", { name: /show local weather/i })).toBeTruthy());
	});

	test("a place shared earlier is what it asks about", async () => {
		localStorage.setItem("raven:weather-place", JSON.stringify({ lat: 51.51, lon: -0.13 }));
		stubServer();
		wrap();
		await waitFor(() => expect(urls).toEqual(["/api/weather?lat=51.51&lon=-0.13"]));
	});

	test("switched off in Settings, it shows nothing and looks nothing up", async () => {
		setPref("overview.localWeather", false);
		stubServer();
		const { container } = wrap();
		await act(async () => {
			await sleep(30);
		});
		expect(urls).toEqual([]);
		expect(container.innerHTML).toBe("");
	});

	test("forgetting drops a shared place and a 'no' alike", () => {
		localStorage.setItem("raven:weather-place", JSON.stringify({ declined: true }));
		forgetWeatherPlace();
		expect(localStorage.getItem("raven:weather-place") === null).toBe(true);
	});
});
