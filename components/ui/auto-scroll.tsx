"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Hover-reveal auto-hide scrollbar classes (also usable without this component). */
export const autoScrollClasses = "auto-scroll";

export function AutoScroll({
  className,
  children,
  onScroll,
  ...rest
}: React.ComponentProps<"div">) {
  const [scrolling, setScrolling] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div
      {...rest}
      data-scrolling={scrolling || undefined}
      onScroll={(e) => {
        onScroll?.(e);
        setScrolling(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setScrolling(false), 1000);
      }}
      className={cn("auto-scroll", className)}
    >
      {children}
    </div>
  );
}
