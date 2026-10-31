"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getJson } from "@/hooks/use-mail";
import { qk } from "@/lib/query-keys";
import type { WeatherPlace } from "@/lib/weather/places";

/** "Choose your city": a typed search for where local weather comes from. */
export function WeatherCityPicker({ onPick, className }: { onPick: (place: WeatherPlace) => void; className?: string }) {
	const { email } = useAccount();
	const [open, setOpen] = React.useState(false);
	const [text, setText] = React.useState("");
	const query = useDebouncedValue(text.trim(), 300);
	const ready = query.length >= 2;

	const search = useQuery({
		queryKey: qk.weatherPlaces(email, query.toLowerCase()),
		queryFn: ({ signal }) => getJson<{ places: WeatherPlace[] }>(`/api/weather/places?q=${encodeURIComponent(query)}`, signal),
		enabled: open && ready,
		staleTime: 24 * 60 * 60_000,
		retry: false,
	});
	const places = ready ? (search.data?.places ?? []) : [];

	const note = !ready
		? "Type the name of your city."
		: search.isFetching && !search.data
			? "Looking…"
			: search.isError && !search.data
				? "Couldn't look that up right now. Try again in a moment."
				: places.length === 0
					? "No place by that name."
					: null;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger render={<button type="button" className={className} />}>
				<MapPin className="size-3.5" aria-hidden />
				Choose your city for the weather
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-0">
				<Command shouldFilter={false} label="Choose your city">
					<CommandInput value={text} onValueChange={setText} placeholder="City" autoFocus />
					<CommandList>
						{note && <p className="px-2 py-3 text-[13px] text-ink-2">{note}</p>}
						{places.map((place) => (
							<CommandItem
								key={place.label}
								value={place.label}
								onSelect={() => {
									onPick(place);
									setOpen(false);
								}}
							>
								{place.label}
							</CommandItem>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
