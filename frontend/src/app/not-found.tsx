import type { Metadata } from "next"

import { NotFoundScreen } from "@/components/error-states/not-found-screen"

export const metadata: Metadata = { title: "Página não encontrada | INIA" }

/** Endereço que não existe (ou `notFound()`): o Next responde 404 com esta tela. Não é falha — não gera registro no servidor. */
export default function NotFound() {
  return <NotFoundScreen />
}
