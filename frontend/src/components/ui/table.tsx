"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * MOLDURA DE TABELA do app: superfície de cartão (destaca do fundo da página), borda, cantos `rounded-xl` e a rolagem horizontal
 * POR DENTRO (no `table-container`), para os cantos continuarem arredondados quando a tabela é mais larga que a tela. Use no contêiner
 * que envolve a `<Table>`; para rolagem vertical, some `max-h-* overflow-auto`.
 *
 * CABEÇALHO (decisão do responsável em 2026-11-10): o roxo da marca da barra superior (`topbar`, roxo nos dois temas — o `primary` do
 * escuro é rosa) com texto branco em seminegrito, em TODA tabela do app. A cor fica na célula (`TableHead`), então um `TableHeader`
 * com fundo próprio não apaga o padrão. Sobre o roxo, caixa de seleção e botão (ordenar) ficam claros e o foco é branco.
 */
export const TABLE_FRAME = "overflow-hidden rounded-xl border border-border bg-card shadow-xs"
/** Cores do cabeçalho padrão para tabela de DADOS montada à mão (`<th>` fora do kit, ex.: grade do calendário da equipe). */
export const TABLE_HEAD_COLORS = "bg-topbar text-topbar-foreground"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-muted/60 [&_tr]:border-b [&>tr:first-child>th:first-child]:rounded-tl-lg [&>tr:first-child>th:last-child]:rounded-tr-lg", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 bg-topbar px-2 text-left align-middle text-[0.8125rem] font-semibold whitespace-nowrap text-topbar-foreground [&:has([role=checkbox])]:pr-0",
        "[&_[role=checkbox]]:border-topbar-foreground/70 [&_[role=checkbox][data-state=checked]]:bg-topbar-foreground [&_[role=checkbox][data-state=checked]]:text-topbar [&_button:focus-visible]:ring-topbar-foreground/70",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
