"use client"

import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { type VariantProps } from "class-variance-authority"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { TAB_SPRING } from "@/lib/motion"

import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
    /** Pill groups: pressed values + a per-group id for the sliding indicator. */
    value?: readonly unknown[]
    layoutId?: string
    /** false: no sliding pill; the pressed item marks itself with text color alone. */
    indicator?: boolean
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
})

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  value,
  indicator = true,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
    indicator?: boolean
  }) {
  const layoutId = React.useId()
  return (
    <ToggleGroupPrimitive
      value={value}
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-vertical:flex-col data-vertical:items-stretch",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation, value, layoutId, indicator }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)
  // Pill groups draw one shared indicator that springs between items
  // (Shadow Garden pill-tabs); the pressed item itself stays transparent.
  const pill = (context.variant || variant) === "pill"
  const pressed = pill && context.indicator !== false && context.value?.includes(props.value)

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-lg group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-lg group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-lg group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-lg group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        // Important radius: the spacing-0 segmented rules above would square the ends.
        pill && "relative isolate rounded-full! aria-pressed:bg-transparent dark:aria-pressed:bg-transparent",
        className
      )}
      {...props}
    >
      {pressed && (
        <motion.span
          layoutId={context.layoutId}
          // Animate only when the selection changes. Without this every re-render
          // (a live test run, a streaming list) re-measures the pill, and if the
          // group moved on the page it springs over from the old spot.
          layoutDependency={context.value?.join("\u0000")}
          aria-hidden
          transition={TAB_SPRING}
          // Radius via style so motion counter-scales it while the pill stretches between widths.
          style={{ borderRadius: 9999 }}
          className="absolute inset-0 -z-10 bg-inverse dark:bg-signal-soft"
        />
      )}
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
