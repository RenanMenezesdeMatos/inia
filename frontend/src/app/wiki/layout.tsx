import type { Metadata } from "next"
import type { ReactNode } from "react"

import { WikiShell } from "@/components/wiki/wiki-shell"

// Rota deliberadamente FORA do grupo (app) — nunca passa por AuthenticatedAppShell (guarda
// client-side) nem por qualquer guarda de admin. O proxy (src/proxy.ts — o equivalente a
// middleware.ts nesta versão do Next.js) passa por todas as páginas para aplicar a CSP com
// nonce, mas só exige sessão nas áreas da lista AUTHENTICATED_PREFIXES (/admin, /operator,
// /supervisor…) — "/wiki" não está nela e continua pública. Documentação de produto, não área
// administrativa.
export const metadata: Metadata = {
  title: { default: "Wiki INIA", template: "%s | Wiki INIA" },
  description: "Documentação oficial da INIA — Pessoas e Estrutura, Indicadores, Acompanhamento, Workflow Engine, Agents, Orchestrators, Bases de Conhecimento, QA Lab e Segurança.",
}

export default function WikiLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <WikiShell>{children}</WikiShell>
    </div>
  )
}
