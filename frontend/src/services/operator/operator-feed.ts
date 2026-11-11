import { apiGet, toQueryString } from "@/lib/api/api-client"
import { formatFeedTimestamp } from "@/lib/format/date"
import type { OperatorIndicatorHistory } from "@/schemas/operator"
import { operatorFeedbackPageSchema, type OperatorFeedbackRow } from "@/schemas/operator/operator-overview.schema"

/**
 * Acompanhamento do colaborador — sem dependência de servidor: o SSR (operator-service.ts) usa o mesmo mapeamento na primeira
 * página e o feed pede as seguintes daqui, pelo cursor que veio com a anterior.
 */
export function mapOperatorFeedbackHistory(rows: OperatorFeedbackRow[]): OperatorIndicatorHistory[] {
  return rows.map((row) => {
    const kind = row.kind === "MONITORING" ? "monitoria_feedback" : row.kind === "INDICATOR" ? "indicator_feedback" : "reading"
    return {
      id: row.id,
      title: row.heading?.title ?? row.impactedIndicator ?? (kind === "indicator_feedback" ? "Feedback de indicador" : "Feedback da INIA"),
      subtitle: row.heading?.subtitle ?? null,
      message: row.summary || row.recommendation || row.evidenceFound || "Novo feedback disponível.",
      occurredAt: row.occurredAt ?? row.createdAt,
      timestamp: formatFeedTimestamp(row.occurredAt ?? row.createdAt),
      kind,
      presentation:
        kind === "monitoria_feedback"
          ? { label: "Monitoria", iconKey: "clipboard-check", tone: "warning" }
          : kind === "indicator_feedback"
            ? { label: "Indicador", iconKey: "target", tone: "quality" }
            : { label: "Leitura do dia", iconKey: "sun", tone: "info" },
      feedback: {
        recommendation: row.recommendation ?? undefined,
        evidenceFound: row.evidenceFound ?? undefined,
        observedBehavior: row.observedBehavior ?? undefined,
        relatedProcedure: row.relatedProcedure ?? undefined,
        supportMaterials: row.supportMaterials ?? [],
        view: row.feedbackView ?? null,
      },
      origin: row.origin ?? null,
      // Só feedbacks publicados podem receber ciência (e a escolha que vai com ela) — para os demais os campos ficam ausentes.
      ...(row.status === "PUBLISHED" ? { acknowledgedAt: row.acknowledgedAt, evaluation: row.evaluation ?? null } : {}),
    }
  })
}

/** Página do Acompanhamento depois de `cursor` (client-side, cookie de sessão) — sempre do próprio colaborador. */
export async function fetchOperatorFeedbackPage(cursor: string): Promise<{ history: OperatorIndicatorHistory[]; nextCursor: string | null }> {
  const page = operatorFeedbackPageSchema.parse(await apiGet<unknown>(`/api/v1/operator/feedbacks${toQueryString({ cursor })}`))
  return { history: mapOperatorFeedbackHistory(page.items), nextCursor: page.nextCursor }
}
