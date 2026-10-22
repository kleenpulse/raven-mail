"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/** Hover-reveal auto-hide scrollbar classes (also usable without this component). */
export const autoScrollClasses = "auto-scroll";

export function AutoScroll({
  className,
  children,
  onScroll,
  ...rest
}: React.ComponentProps<typeof motion.div>) {
  const [scrolling, setScrolling] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // layoutScroll: active pills inside (sidebar folders) stay put when the list's scroll snaps; see LayoutScroll.
  return (
    <motion.div
      layoutScroll
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
    </motion.div>
  );
}
