"use client"

import * as React from "react"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { DayButton, DayPicker, getDefaultClassNames } from "react-day-picker"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"

function Calendar({ className, classNames, showOutsideDays = true, captionLayout = "label", buttonVariant = "ghost", formatters, components, ...props }: React.ComponentProps<typeof DayPicker> & { buttonVariant?: React.ComponentProps<typeof Button>["variant"] }) {
  const defaults = getDefaultClassNames()
  return <DayPicker
    showOutsideDays={showOutsideDays}
    className={cn("bg-background p-3", className)}
    captionLayout={captionLayout}
    formatters={{ formatMonthDropdown: (date) => date.toLocaleString("pt-BR", { month: "short" }), ...formatters }}
    classNames={{
      root: cn("w-fit", defaults.root), months: "flex flex-col gap-4 sm:flex-row", month: "flex w-full flex-col gap-4",
      nav: "absolute inset-x-0 top-0 flex w-full items-center justify-between", button_previous: cn(buttonVariants({ variant: buttonVariant }), "size-8 p-0"), button_next: cn(buttonVariants({ variant: buttonVariant }), "size-8 p-0"),
      month_caption: "flex h-8 items-center justify-center px-8", caption_label: "text-sm font-medium", month_grid: "w-full border-collapse", weekdays: "flex", weekday: "w-9 text-center text-xs font-normal text-muted-foreground", week: "mt-2 flex w-full", day: "relative size-9 p-0 text-center", range_start: "rounded-l-md bg-accent", range_middle: "rounded-none bg-accent", range_end: "rounded-r-md bg-accent", today: "rounded-md bg-accent text-accent-foreground", outside: "text-muted-foreground opacity-50", disabled: "text-muted-foreground opacity-50", hidden: "invisible", ...classNames,
    }}
    components={{
      Chevron: ({ orientation, className: iconClassName }) => orientation === "left" ? <ChevronLeft className={cn("size-4", iconClassName)}/> : orientation === "right" ? <ChevronRight className={cn("size-4", iconClassName)}/> : <ChevronDown className={cn("size-4", iconClassName)}/>,
      DayButton: CalendarDayButton,
      ...components,
    }}
    {...props}
  />
}

function CalendarDayButton({ className, day, modifiers, ...props }: React.ComponentProps<typeof DayButton>) {
  return <Button variant="ghost" size="icon" data-day={day.date.toLocaleDateString()} data-selected-single={modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle} className={cn("size-9 font-normal data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground", className)} {...props}/>
}

export { Calendar, CalendarDayButton }
