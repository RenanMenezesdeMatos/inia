"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { FlaskConical, Info, Lightbulb, MessageSquareText } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useBestPracticesMetaQuery } from "@/queries/best-practices/use-best-practices"

import { AnalysesPanel } from "./analyses-panel"
import { GuidancePreview } from "./guidance-preview"
import { PatternDetailDialog } from "./pattern-detail-dialog"
import { PatternList } from "./pattern-list"

/**
 * BASE DE BOAS PRÁTICAS — o que os operadores com melhores resultados fazem nas conversas que pode ajudar os outros. Complementa o
 * Diagnóstico (que mostra se o processo foi seguido): aqui só entram comportamentos OPCIONAIS, com associação sustentada, evidência
 * rastreável e revisão humana. `?pattern=<id>` abre o detalhe (link do Diagnóstico e do feedback).
 */
export function BestPracticesPage() {
  const router = useRouter()
  const params = useSearchParams()
  const meta = useBestPracticesMetaQuery()
  const [patternId, setPatternId] = useState<string | null>(params.get("pattern"))
  const open = (id: string | null) => {
    setPatternId(id)
    router.replace(id ? `/best-practices?pattern=${encodeURIComponent(id)}` : "/best-practices", { scroll: false })
  }
  const showPreview = (meta.data?.datasets.length ?? 0) > 0

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Boas práticas</h1>
        <p className="text-sm text-muted-foreground">Comportamentos observados com mais frequência nas chamadas dos operadores com melhores resultados do que no grupo de referência, no mesmo contexto. Não é cumprimento de processo — isso fica no Diagnóstico.</p>
      </header>

      <Collapsible className="rounded-lg border border-border bg-card/60 px-3 py-2 text-sm">
        <CollapsibleTrigger className="flex items-center gap-2 font-medium"><Info className="size-4 text-primary" aria-hidden /> Como a base é construída</CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Grupos pelo quartil oficial do indicador; comparação sempre dentro do mesmo contexto (motivo/submotivo), população (Grupo ou Subgrupo) e período.</li>
            <li>A IA levanta hipóteses, lê cada chamada sem saber o grupo (com trecho literal conferido) e confere se o comportamento é obrigação do processo. Os números e a força são calculados pelo sistema.</li>
            <li>Uma frase isolada, um único operador ou poucos dados nunca viram padrão; obrigação e o que contraria o processo são descartados; na dúvida, o padrão fica pendente.</li>
            <li>Só padrão aprovado por uma pessoa, sustentado e de dados reais orienta operadores. É associação, nunca causa.</li>
            {(meta.data?.method ?? []).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </CollapsibleContent>
      </Collapsible>

      <Tabs defaultValue="patterns">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="patterns"><Lightbulb /> Padrões</TabsTrigger>
          <TabsTrigger value="analyses"><FlaskConical /> Análises</TabsTrigger>
          {showPreview ? <TabsTrigger value="preview"><MessageSquareText /> Testar a orientação</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="patterns" className="mt-4"><PatternList meta={meta.data} onOpen={open} /></TabsContent>
        <TabsContent value="analyses" className="mt-4"><AnalysesPanel meta={meta.data} /></TabsContent>
        {showPreview && meta.data ? <TabsContent value="preview" className="mt-4"><GuidancePreview meta={meta.data} /></TabsContent> : null}
      </Tabs>

      <PatternDetailDialog patternId={patternId} onClose={() => open(null)} />
    </main>
  )
}
