"use client"

import Link from "next/link"
import { PenSquare } from "lucide-react"

import { Button } from "@/components/ui/button"

import { newPublicationPath } from "./publications-route"

/**
 * "Publicar" no cabeçalho do perfil de quem publica comunicados: botão com texto (antes era só o ícone do megafone) que abre a
 * área editorial da Administração já numa publicação nova.
 */
export function PublishButton() {
  return (
    <Button asChild size="sm" className="mb-0.5 shadow-sm">
      <Link href={newPublicationPath}>
        <PenSquare data-icon="inline-start" />
        Publicar
      </Link>
    </Button>
  )
}
