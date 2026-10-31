"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { isAppPath, ravenDesktop } from "@/lib/desktop/bridge";

/** In the desktop app, goes where a clicked notification points, without reloading the page. */
export function DesktopOpen() {
	const router = useRouter();
	React.useEffect(() => {
		return ravenDesktop()?.onOpen((path) => {
			if (isAppPath(path)) router.push(path);
		});
	}, [router]);
	return null;
}
