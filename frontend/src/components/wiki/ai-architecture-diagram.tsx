import { cn } from "@/lib/utils"

type Column = { domain: string; agent: string; bases: string[] }

const COLUMNS: Column[] = [
  { domain: "Faturamento", agent: "Especialista de Faturamento", bases: ["Contestação de Contas", "Segunda Via de Conta", "Negociação de Débito"] },
  { domain: "Retenção", agent: "Especialista de Retenção e Cancelamento", bases: ["Cancelamento de Produtos e Serviços"] },
  { domain: "Suporte Técnico", agent: "Especialista de Suporte Técnico", bases: ["Reparo de Banda Larga", "Troca de CHIP"] },
]

const BOX = "rounded-md border px-3 py-2 text-center text-xs font-medium shadow-xs"

/**
 * Diagrama conceitual da especialização por domínio — cards + conectores CSS, sem biblioteca de
 * diagramação (mesma decisão do WorkflowDiagram da Wiki). Mostra três domínios de exemplo; o
 * catálogo completo está em ai-catalog-data.ts.
 */
export function AiArchitectureDiagram() {
  return (
    <figure className="overflow-x-auto rounded-lg border border-border bg-muted/20 p-4" aria-label="Arquitetura: Orquestrador acima de especialistas por domínio, cada um com suas bases">
      <div className="mx-auto flex min-w-[560px] max-w-3xl flex-col items-center gap-0">
        <div className={cn(BOX, "border-indigo-400/50 bg-indigo-500/10 text-indigo-900 dark:text-indigo-200")}>Orquestrador do domínio · coordena só quando há mais de uma competência</div>
        <div className="h-4 w-px bg-border" />
        <div className="h-px w-2/3 bg-border" />
        <div className="grid w-full grid-cols-3 gap-4">
          {COLUMNS.map((column) => (
            <div key={column.domain} className="flex flex-col items-center gap-0">
              <div className="h-4 w-px bg-border" />
              <div className={cn(BOX, "w-full border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-900 dark:text-fuchsia-200")}>
                <span className="block text-[10px] uppercase tracking-wide opacity-70">{column.domain}</span>
                {column.agent}
              </div>
              <div className="h-4 w-px bg-border" />
              <ul className="w-full space-y-1">
                {column.bases.map((base) => (
                  <li key={base} className={cn(BOX, "border-emerald-400/50 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200")}>
                    KB · {base}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-muted-foreground">
        O Workflow chama o especialista diretamente quando já sabe o domínio; o orquestrador entra para escolher, combinar e sintetizar. Cada
        especialista só enxerga as bases do seu domínio, e cada request recebe só os trechos pertinentes delas.
      </figcaption>
    </figure>
  )
}
