import { CLASSIFICATION_OUTCOME_LABELS, CLASSIFICATION_OUTCOMES, CLASSIFICATION_REASON_LABELS, CLASSIFICATION_REASONS, REQUEST_ORIGIN_LABELS, REQUEST_ORIGINS } from "../../human-support/domain/catalogs.js"
import type { Measure } from "../../human-support/domain/metrics-definitions.js"
import { supportDailyCounts } from "../../human-support/application/metrics-daily.js"
import { supportFunnel } from "../../human-support/application/metrics-service.js"
import { foldByBucket, type Bucket } from "../domain/success-metrics.js"
import type { Queryable, SuccessQuery, SuccessViewer } from "./success-query.js"

/**
 * APOIO COM ANJO — o que os Anjos (pessoas, papel ANJO) registram quando a INIA não resolve. Os totais vêm do leitor oficial do painel
 * do apoio (`supportFunnel`, medidas M7–M17, no alcance de `human_support.coordinate`, sobre o escopo CONGELADO de cada pedido).
 *
 * O que a classificação do Anjo É: o MOTIVO pelo qual o operador precisou do Anjo (catálogo `CLASSIFICATION_CATALOG_V2`) e o
 * RESULTADO do atendimento, escolhidos à parte. O que ela NÃO é: um julgamento da resposta da INIA como correta, parcialmente correta,
 * incorreta ou inconclusiva — por isso "Assertividade segundo o Anjo" e "Erro identificado pelo Anjo" não são calculáveis com os dados
 * gravados (lacuna documentada em `docs/dev/indicadores-de-sucesso-da-inia.md`).
 *
 * Referência temporal: pedidos pela data de criação; classificações e avaliações pela data de início do atendimento (as do funil).
 */
export type SupportSeriesPoint = { bucket: Bucket; requests: number; requestsByOrigin: Record<string, number>; classified: number; byReason: Record<string, number> }
export type SupportSummary = {
  measures: Measure[]
  disabledPeriods: { from: string; to: string | null }[]
  catalogs: { reasons: { key: string; label: string }[]; outcomes: { key: string; label: string }[]; origins: { key: string; label: string }[] }
  series: SupportSeriesPoint[]
}

export async function supportSummary(db: Queryable, viewer: SuccessViewer, query: SuccessQuery): Promise<SupportSummary> {
  const [funnel, days] = await Promise.all([
    supportFunnel(db, viewer, { from: query.from, to: query.to, teamId: query.teamId ?? undefined, subteamId: query.subteamId ?? undefined }),
    supportDailyCounts(db, viewer, { from: query.from, to: query.to, teamId: query.teamId ?? undefined, subteamId: query.subteamId ?? undefined }),
  ])
  const series = foldByBucket(days, query, () => ({ requests: 0, classified: 0 }) as Record<string, number>, (totals, row) => {
    const prefix = row.kind === "REQUEST" ? "origin:" : "reason:"
    totals[prefix + row.key] = (totals[prefix + row.key] ?? 0) + row.total
    if (row.kind === "REQUEST") totals.requests = (totals.requests ?? 0) + row.total
    else totals.classified = (totals.classified ?? 0) + row.total
  }).map(({ bucket, totals }) => ({
    bucket,
    requests: totals.requests ?? 0,
    classified: totals.classified ?? 0,
    requestsByOrigin: Object.fromEntries(REQUEST_ORIGINS.map((origin) => [origin, totals[`origin:${origin}`] ?? 0])),
    byReason: Object.fromEntries(CLASSIFICATION_REASONS.map((reason) => [reason, totals[`reason:${reason}`] ?? 0])),
  }))
  return {
    // M1–M6 (respostas da INIA) ficam no bloco das respostas: aqui só o apoio.
    measures: funnel.measures.filter((measure) => !["M1", "M2", "M3", "M4", "M5", "M6"].includes(measure.id)),
    disabledPeriods: funnel.cutoffs.disabledPeriods,
    catalogs: {
      reasons: CLASSIFICATION_REASONS.map((key) => ({ key, label: CLASSIFICATION_REASON_LABELS[key] })),
      outcomes: CLASSIFICATION_OUTCOMES.map((key) => ({ key, label: CLASSIFICATION_OUTCOME_LABELS[key] })),
      origins: REQUEST_ORIGINS.map((key) => ({ key, label: REQUEST_ORIGIN_LABELS[key] })),
    },
    series,
  }
}
