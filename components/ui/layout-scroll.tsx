"use client";

import * as React from "react";
import { motion } from "motion/react";

/**
 * A scrolling element that motion knows about. Shared-layout indicators
 * (pill tabs, nav highlights) are measured on screen; motion only corrects
 * for window scroll unless an ancestor has `layoutScroll`. Without it, when
 * the content shrinks and this element's scroll snaps up in the same render
 * (a short last page, a filter with fewer rows), the pill flies in from
 * where it sat before the snap. Use it for any scroller that holds one.
 */
export function LayoutScroll(props: React.ComponentProps<typeof motion.div>) {
  return <motion.div layoutScroll {...props} />;
}
