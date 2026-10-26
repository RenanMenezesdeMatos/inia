"use client"

import { useState } from "react"

import { RichContent } from "@/components/rich-content/rich-content"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useGuidancePreviewQuery } from "@/queries/best-practices/use-best-practices"
import type { BestPracticesMeta } from "@/schemas/best-practices/best-practices.schema"

/**
 * Pré-visualização (só dados SINTÉTICOS, fora de produção): exatamente o que a ferramenta da INIA devolveria a um operador do
 * dataset que perguntasse "como melhoro esse indicador?" — práticas aprovadas, números da comparação, o que as chamadas DELE mostram
 * e as regras que a INIA segue ao responder.
 */
export function GuidancePreview({ meta }: { meta: BestPracticesMeta }) {
  const [datasetId, setDatasetId] = useState(meta.datasets[0]?.id ?? "")
  const dataset = meta.datasets.find((item) => item.id === datasetId)
  const [operatorRef, setOperatorRef] = useState<string | undefined>(dataset?.operatorList[1]?.ref)
  const [indicatorId, setIndicatorId] = useState<string | undefined>()
  const preview = useGuidancePreviewQuery(datasetId && operatorRef && indicatorId ? { datasetId, operatorRef, indicatorId } : null)
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">Escolha um operador FICTÍCIO do dataset e um indicador para ver a orientação que a INIA daria — só padrões aprovados entram (os sintéticos nunca chegam a operadores reais).</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label>Dataset</Label><Select value={datasetId} onValueChange={(value) => { setDatasetId(value); setOperatorRef(undefined) }}><SelectTrigger aria-label="Dataset"><SelectValue /></SelectTrigger><SelectContent>{meta.datasets.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label>Operador (fictício)</Label><Select value={operatorRef ?? ""} onValueChange={setOperatorRef}><SelectTrigger aria-label="Operador fictício"><SelectValue placeholder="Escolha" /></SelectTrigger><SelectContent>{(dataset?.operatorList ?? []).map((operator) => <SelectItem key={operator.ref} value={operator.ref}>{operator.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label>Indicador</Label><Select value={indicatorId ?? ""} onValueChange={setIndicatorId}><SelectTrigger aria-label="Indicador da pré-visualização"><SelectValue placeholder="Escolha" /></SelectTrigger><SelectContent>{meta.indicators.map((indicator) => <SelectItem key={indicator.id} value={indicator.id}>{indicator.name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      {preview.isFetching && !preview.data ? <Skeleton className="h-40 w-full" /> : null}
      {preview.data ? <div className="rounded-lg border border-border bg-card/60 p-4"><RichContent text={preview.data.text} /></div> : null}
    </section>
  )
}
