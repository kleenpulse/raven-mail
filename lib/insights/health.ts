import type { WeatherState } from "@/lib/insights/types";

export type WeatherInput = {
  needsReply: number;
  oldestNeedsReplyHours: number;
  urgentToday: number;
  waitingOn: number;
  /** Today's arrivals so far ÷ the usual count by this hour on this weekday (1 = typical). */
  paceRatio: number | null;
  weekdayName: string;
  front: string | null;
};

const STATES: { min: number; state: WeatherState; label: string }[] = [
  { min: 80, state: "clear", label: "Clear" },
  { min: 65, state: "fair", label: "Fair" },
  { min: 50, state: "cloudy", label: "Cloudy" },
  { min: 35, state: "rain", label: "Rain" },
  { min: 0, state: "storm", label: "Storm" },
];

/**
 * "Inbox weather": one calm-to-stormy number from what you owe, what's urgent,
 * who you're chasing, and whether today runs hotter than your own baseline.
 */
export function inboxWeather(input: WeatherInput): {
  score: number;
  state: WeatherState;
  label: string;
  forecast: string;
} {
  let score = 100;
  score -= Math.min(36, input.needsReply * 6);
  if (input.oldestNeedsReplyHours > 96) score -= 18;
  else if (input.oldestNeedsReplyHours > 48) score -= 10;
  score -= Math.min(24, input.urgentToday * 8);
  score -= Math.min(12, input.waitingOn * 3);
  const pace = input.paceRatio;
  if (pace !== null) {
    if (pace > 1.3) score -= 10;
    else if (pace > 1.1) score -= 5;
    else if (pace < 0.8) score += 4;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  const bucket = STATES.find((s) => score >= s.min) ?? STATES[STATES.length - 1]!;
  const base =
    pace === null
      ? `No typical ${input.weekdayName} to compare yet`
      : `${pace < 0.8 ? "Lighter than" : pace > 1.2 ? "Busier than" : "About"} a usual ${input.weekdayName}`;
  const forecast = `${base}${input.front ? ` · heavy front ${input.front}` : ""}`;
  return { score, state: bucket.state, label: bucket.label, forecast };
}
