"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("w-full", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = React.useState<{ left: number; width: number } | null>(null)

  const updateIndicator = React.useCallback(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-state="active"]')
    if (!list || !active) {
      setIndicator(null)
      return
    }
    setIndicator({ left: active.offsetLeft, width: active.offsetWidth })
  }, [])

  React.useEffect(() => {
    updateIndicator()
    const list = listRef.current
    if (!list) return

    const mutationObserver = new MutationObserver(updateIndicator)
    mutationObserver.observe(list, { attributes: true, attributeFilter: ["data-state"], subtree: true })

    const resizeObserver = new ResizeObserver(updateIndicator)
    resizeObserver.observe(list)

    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [updateIndicator])

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      className={cn(
        "relative inline-flex items-center gap-6 border-b border-border text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      {indicator ? (
        <motion.div
          className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-primary"
          initial={false}
          animate={{ left: indicator.left, width: indicator.width }}
          transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.5 }}
        />
      ) : null}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex cursor-pointer items-center justify-center gap-1.5 px-0.5 pb-3 text-sm font-medium text-muted-foreground transition-colors",
        "hover:text-foreground",
        "data-[state=active]:font-semibold data-[state=active]:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("mt-2 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }