import { AlertCircle, CheckCircle2, Sparkles } from "lucide-react"

import { RichContent } from "@/components/rich-content/rich-content"

import { formatDateTime } from "@/lib/format/date"
import type { Insight, PersistedInsight } from "@/schemas/analytics/analytics.schema"

/**
 * "Pontos positivos" / "Pontos de atenção" determinísticos + "Análise da INIA" já persistida.
 * Nada aqui dispara IA: tudo veio pronto do backend a partir de fatos e de feedbacks publicados.
 */
export function InsightPanel({ positives, attentionPoints, persisted = [], compact = false }: { positives: Insight[]; attentionPoints: Insight[]; persisted?: PersistedInsight[]; compact?: boolean }) {
  return (
    <div className={compact ? "space-y-4" : "grid gap-4 md:grid-cols-2"}>
      <InsightList title="Pontos positivos" icon={<CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-300" aria-hidden />} items={positives} emptyText="Nenhum ponto positivo identificado nos dados deste período." />
      <InsightList title="Pontos de atenção" icon={<AlertCircle className="size-4 text-amber-700 dark:text-amber-300" aria-hidden />} items={attentionPoints} emptyText="Nenhum ponto de atenção identificado nos dados deste período." />
      {persisted.length > 0 ? (
        <section className="rounded-xl bg-primary/5 p-4 md:col-span-2" aria-label="Análise da INIA">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Sparkles className="size-4" aria-hidden /> Análise da INIA
          </h4>
          <ul className="mt-2 space-y-3">
            {persisted.map((item) => (
              <li key={item.id} className="text-sm leading-6 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_p+p]:mt-2">
                <RichContent text={item.recommendation} />
                <p className="mt-1 text-xs text-muted-foreground">Análise persistida em {formatDateTime(item.publishedAt)} · feedback de indicador publicado</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function InsightList({ title, icon, items, emptyText }: { title: string; icon: React.ReactNode; items: Insight[]; emptyText: string }) {
  return (
    <section className="rounded-xl bg-muted/50 p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        {icon} {title}
      </h4>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-sm leading-6">
          {items.map((item) => (
            <li key={item.text} className="flex gap-2">
              <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-current opacity-60" aria-hidden />
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
