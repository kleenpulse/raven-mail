"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Hairline box that fills like the skin's selected pill: ink in Ember,
 * gold in Nebula. The border stays ≥3:1 against cards in both skins.
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			className={cn(
				"peer relative flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-foreground/50 bg-sheet text-inverse-foreground transition-[background-color,border-color,box-shadow] duration-150 outline-none",
				"after:absolute after:-inset-x-3 after:-inset-y-2",
				"hover:border-foreground/75 focus-visible:ring-2 focus-visible:ring-ring",
				"data-checked:border-inverse data-checked:bg-inverse data-indeterminate:border-inverse data-indeterminate:bg-inverse",
				"dark:bg-transparent dark:text-primary-foreground dark:data-checked:border-primary dark:data-checked:bg-primary dark:data-indeterminate:border-primary dark:data-indeterminate:bg-primary",
				"data-disabled:cursor-not-allowed data-disabled:opacity-40 group-has-disabled/field:opacity-50",
				"aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className="grid place-content-center text-current transition-none [&>svg]:size-3 [&>svg]:stroke-3"
			>
				<CheckIcon className="in-data-indeterminate:hidden" />
				<MinusIcon className="hidden in-data-indeterminate:block" />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
