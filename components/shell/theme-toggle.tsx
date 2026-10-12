"use client";

import type * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ThemeChoice = "light" | "dark" | "system";

/**
 * Switches skin with a circular reveal grown from `origin` (a viewport point).
 * Shared by the rail toggle and Settings → Appearance.
 */
export function revealTheme(choice: ThemeChoice, setTheme: (theme: string) => void, origin?: { x: number; y: number }) {
  const root = document.documentElement;
  const next =
    choice === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : choice;
  const apply = () => {
    // next-themes applies the class in an effect; the transition needs it now.
    root.classList.toggle("dark", next === "dark");
    root.classList.toggle("light", next === "light");
    root.style.colorScheme = next;
    setTheme(choice);
  };

  const reduced =
    root.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const unchanged = root.classList.contains("dark") === (next === "dark");
  if (reduced || unchanged || typeof document.startViewTransition !== "function") {
    apply();
    return;
  }
  const x = origin?.x ?? innerWidth / 2;
  const y = origin?.y ?? innerHeight / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.style.setProperty("--reveal-x", `${x}px`);
  root.style.setProperty("--reveal-y", `${y}px`);
  root.style.setProperty("--reveal-r", `${radius}px`);
  document.startViewTransition(apply);
}

/** Center of an element, in viewport coordinates, for the reveal origin. */
export function centerOf(el: Element) {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Ember ↔ Nebula. The new skin grows out of the toggle as a circle. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    revealTheme(resolvedTheme === "dark" ? "light" : "dark", setTheme, centerOf(event.currentTarget));
  }

  return (
    <Tip
      label={
        <>
          <span className="dark:hidden">Switch to Nebula</span>
          <span className="hidden dark:inline">Switch to Ember</span>
        </>
      }
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Switch skin"
          className={cn(className)}
          onClick={toggle}
        />
      }
    >
      {/* CSS-driven: resolvedTheme is unknown during SSR → hydration mismatch. */}
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Tip>
  );
}
