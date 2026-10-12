"use client";

import * as React from "react";
import { forgetPersistedQueries } from "@/lib/query-persist";

/** Reaching sign-in means the last session is over (signed out or expired): drop its cached mail. */
export function ForgetCachedMail() {
  React.useEffect(() => {
    void forgetPersistedQueries();
  }, []);
  return null;
}
