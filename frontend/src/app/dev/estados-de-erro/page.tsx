import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ErrorStatesPreview } from "@/components/error-states/error-states-preview"

export const metadata: Metadata = { title: "INIA · Estados de erro", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

/**
 * Galeria das telas de erro para conferência (instalação, ensaio na VM, revisão visual): DESLIGADA por padrão — só existe com
 * `INIA_ERROR_STATES_PREVIEW=ON` no ambiente da interface (lido a cada requisição). Usa as peças de produção; o estado 500 registra
 * uma ocorrência de verdade (é o ensaio do caminho completo). Nada aqui lê dado da organização.
 */
export default async function ErrorStatesPreviewPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  if (process.env.INIA_ERROR_STATES_PREVIEW !== "ON") notFound()
  const state = (await searchParams).estado
  return <ErrorStatesPreview state={typeof state === "string" ? state : null} />
}
