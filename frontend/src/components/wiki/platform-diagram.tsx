import Link from "next/link"
import { ArrowDown } from "lucide-react"

import { cn } from "@/lib/utils"

const BOX = "rounded-md border px-3 py-2 text-center text-xs font-medium shadow-xs sm:text-sm"

const LAYERS = {
  input: "border-sky-400/50 bg-sky-500/10 text-sky-900 dark:text-sky-200",
  core: "border-primary/40 bg-primary/10 text-foreground",
  module: "border-indigo-400/50 bg-indigo-500/10 text-indigo-900 hover:bg-indigo-500/20 dark:text-indigo-200",
  output: "border-emerald-400/50 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200",
  people: "border-amber-400/50 bg-amber-500/10 text-amber-900 dark:text-amber-200",
}

const MODULES: { label: string; href: string }[] = [
  { label: "Indicadores e Analytics", href: "/wiki/indicadores" },
  { label: "Workflow Engine", href: "/wiki/workflows" },
  { label: "Agents", href: "/wiki/agents" },
  { label: "Orchestrators", href: "/wiki/orchestrators" },
  { label: "Bases de Conhecimento", href: "/wiki/bases-conhecimento" },
  { label: "QA Lab", href: "/wiki/qa-lab" },
]

/**
 * Diagrama geral da plataforma (Home da Wiki): dados corporativos → pessoas/estrutura/
 * indicadores/interações → INIA (módulos) → Acompanhamento/Pendências/Notificações → operador e
 * liderança. Cards + conectores CSS, sem biblioteca de diagramação — mesma decisão do
 * WorkflowDiagram e do AiArchitectureDiagram.
 */
export function PlatformDiagram() {
  return (
    <figure className="overflow-x-auto rounded-lg border border-border bg-muted/20 p-4" aria-label="Fluxo geral da INIA, do dado de entrada até a entrega ao usuário">
      <div className="mx-auto flex min-w-[520px] max-w-3xl flex-col items-center gap-0">
        <div className={cn(BOX, "w-full", LAYERS.input)}>
          Dados corporativos
          <span className="block text-[11px] font-normal opacity-80">fechamentos oficiais de performance, cadastro de pessoas, interações com transcrição e flags</span>
        </div>
        <Connector />
        <div className="grid w-full grid-cols-4 gap-2">
          {["Pessoas", "Estrutura", "Indicadores", "Interações"].map((item) => (
            <div key={item} className={cn(BOX, LAYERS.input)}>
              {item}
            </div>
          ))}
        </div>
        <Connector />
        <div className={cn("w-full rounded-lg border p-3", LAYERS.core)}>
          <p className="mb-2 text-center font-heading text-sm font-bold tracking-tight">INIA</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MODULES.map((module) => (
              <Link key={module.href} href={module.href} className={cn(BOX, "transition-colors", LAYERS.module)}>
                {module.label}
              </Link>
            ))}
          </div>
        </div>
        <Connector />
        <div className="grid w-full grid-cols-3 gap-2">
          <Link href="/wiki/acompanhamento" className={cn(BOX, LAYERS.output)}>
            Acompanhamento
          </Link>
          <Link href="/wiki/pendencias" className={cn(BOX, LAYERS.output)}>
            Pendências
          </Link>
          <Link href="/wiki/notificacoes" className={cn(BOX, LAYERS.output)}>
            Notificações
          </Link>
        </div>
        <Connector />
        <div className="grid w-full grid-cols-2 gap-2">
          <div className={cn(BOX, LAYERS.people)}>Operador</div>
          <div className={cn(BOX, LAYERS.people)}>Liderança (Supervisor → Diretor)</div>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-muted-foreground">
        A INIA lê dados oficiais e interações, decide com regras determinísticas, aciona IA só onde há análise a fazer e entrega pelo Acompanhamento
        (ler), Pendências (decidir) e sino (algo novo aconteceu). Cada caixa é um link para a área correspondente.
      </figcaption>
    </figure>
  )
}

function Connector() {
  return <ArrowDown className="my-1.5 size-4 text-muted-foreground" aria-hidden />
}
