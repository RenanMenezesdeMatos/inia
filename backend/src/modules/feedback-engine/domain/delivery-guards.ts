/**
 * REGRAS DE ENTREGA ÚNICA (decisão de produto de 05/10/2026) — o colaborador nunca recebe o mesmo retorno duas vezes:
 *
 *   `ONE_MONITORING_PER_CALL_V1` — uma chamada recebe NO MÁXIMO UMA monitoria. Se ela já foi monitorada (por qualquer Workflow, por
 *   qualquer caminho de publicação), outro Workflow que a selecione não analisa de novo nem entrega um segundo feedback dela.
 *   `ONE_INDICATOR_FEEDBACK_PER_PERIOD_V1` — um indicador recebe NO MÁXIMO UM feedback por período oficial (fechamento) para a pessoa.
 *   Uma segunda execução do mesmo período (manual, retomada, outro Workflow) não investiga nem publica esse indicador de novo.
 *
 * A checagem acontece em dois momentos: ANTES de pagar análise/investigação (nada é chamado) e DENTRO da transação de publicação, com
 * trava por chave — duas execuções concorrentes nunca publicam as duas. "Entregue" = mensagem do motor com `delivered_at` ou, na
 * monitoria, feedback PUBLICADO com evidência da chamada (caminhos anteriores ao motor contam); feedback ocultado como artefato de
 * desenvolvimento (`feedback_follow_up_hides`) não conta.
 */
export const ONE_MONITORING_PER_CALL_VERSION = "ONE_MONITORING_PER_CALL_V1" as const
export const ONE_INDICATOR_FEEDBACK_PER_PERIOD_VERSION = "ONE_INDICATOR_FEEDBACK_PER_PERIOD_V1" as const

export const CALL_ALREADY_MONITORED = "CALL_ALREADY_MONITORED" as const
export const PERIOD_ALREADY_DELIVERED = "PERIOD_ALREADY_DELIVERED" as const

/** A monitoria que já existe para a chamada: mensagem do motor entregue ou feedback publicado (qualquer caminho). */
export type DeliveredMonitoring = { source: "ENGINE_MESSAGE" | "PUBLISHED_FEEDBACK"; id: string; deliveredAt: Date }

/** Chave de um indicador num período oficial (datas locais inclusivas, como a investigação as grava). */
export const indicatorPeriodKey = (indicatorCode: string, periodStart: string, periodEnd: string) => `${indicatorCode}|${periodStart}|${periodEnd}`

/** Por que uma publicação não aconteceu — a execução segue (não é falha), e o motivo fica na saída do nó. */
export type DeliverySkip =
  | { reason: typeof CALL_ALREADY_MONITORED; interactionId: string; existing: DeliveredMonitoring }
  | { reason: typeof PERIOD_ALREADY_DELIVERED; periods: string[] }

export const deliverySkipText = (skip: DeliverySkip): string =>
  skip.reason === CALL_ALREADY_MONITORED
    ? `Não publicado: esta chamada já tem uma monitoria entregue (${skip.existing.deliveredAt.toISOString().slice(0, 10)}) — uma chamada é monitorada uma vez só.`
    : `Não publicado: já existe feedback entregue deste indicador no mesmo período (${skip.periods.join(", ")}) — um feedback por indicador e período.`
