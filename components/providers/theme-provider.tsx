"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/** The landing always wears Nebula, whatever skin the visitor picked inside the app. */
const NEBULA_ROUTES = new Set(["/"]);

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  const pathname = usePathname();
  return (
    <NextThemesProvider forcedTheme={NEBULA_ROUTES.has(pathname) ? "dark" : undefined} {...props}>
      {children}
    </NextThemesProvider>
  );
}
