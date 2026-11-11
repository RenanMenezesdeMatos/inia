"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * VOLTAR — o único botão de volta do app (decisão do responsável em 2026-11-10; antes eram 4 estilos: botão fantasma, link cinza,
 * "← Reports" e só o ícone). Fica acima do cabeçalho da página, alinhado à esquerda, com a seta e o nome de para onde volta
 * ("Workflows", "Central de Dados"). `href` navega; `onClick` serve para voltar dentro da própria tela (lista ↔ detalhe).
 */
export type BackLinkProps = { label: string; className?: string } & ({ href: string; onClick?: never } | { onClick: () => void; href?: never })

export function BackLink({ label, className, ...target }: BackLinkProps) {
  const classes = cn("-ml-2 w-fit text-muted-foreground hover:text-foreground", className)
  if (target.href !== undefined) {
    return (
      <Button asChild variant="ghost" size="sm" className={classes}>
        <Link href={target.href}>
          <ArrowLeft data-icon="inline-start" aria-hidden />
          {label}
        </Link>
      </Button>
    )
  }
  return (
    <Button type="button" variant="ghost" size="sm" className={classes} onClick={target.onClick}>
      <ArrowLeft data-icon="inline-start" aria-hidden />
      {label}
    </Button>
  )
}
