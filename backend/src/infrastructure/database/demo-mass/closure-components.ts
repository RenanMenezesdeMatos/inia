import type pg from "pg"
import { componentValueScale } from "../../../modules/indicators/domain/indicator-definition.js"
import type { OperationalAggregationKind } from "../../../modules/indicators/domain/operational-aggregation.js"
import { DEMO_ORGANIZATION_ID, DEMO_SOURCE } from "./demo-constants.js"
import { createRandom, hashSeed, roundTo } from "./random.js"

/**
 * NUMERADOR e DENOMINADOR dos fechamentos oficiais demo (contrato OFFICIAL_INDICATOR_PERFORMANCE@2,
 * migration 147). O VALOR oficial manda: os componentes são escolhidos para reproduzi-lo, nunca o
 * contrário — nenhum fechamento muda de valor, meta, atingimento, peso ou quartil. Só estratégias que
 * definem o valor por componentes (Taxa: ocorrências ÷ base × 100; Média ponderada: total ÷ volume, ex.:
 * segundos ÷ atendimentos) recebem os dois; as demais ficam nulas, como a fonte real mandaria.
 *
 * Determinístico pela CHAVE da linha (id do fechamento): o gerador (linha nova) e o preenchimento do banco
 * já populado (`fillDemoClosureComponents`) chegam ao mesmo número sem consumir o gerador pseudoaleatório
 * da pessoa — os fechamentos continuam byte a byte os mesmos.
 */

/**
 * Volume MENSAL plausível (denominador) por indicador da massa — dado de demonstração, coerente com as
 * faixas diárias de daily-measurement-generator.ts somadas num mês de ~21 dias trabalhados.
 */
const MONTHLY_VOLUME: Record<string, readonly [number, number]> = {
  // Atendimentos do mês.
  TMA: [450, 1700],
  FCR: [450, 1700],
  REINCIDENCIA_7D: [450, 1700],
  TAXA_TRANSFERENCIA: [450, 1700],
  RECHAMADA: [450, 1700],
  TAXA_ABANDONO: [450, 1700],
  TEMPO_SILENCIO: [450, 1700],
  // Casos/tratativas do mês.
  TMT: [170, 520],
  TEMPO_DIAGNOSTICO: [170, 520],
  TAXA_RETRABALHO: [170, 520],
  SLA_24H: [170, 520],
  TAXA_RETENCAO: [100, 420],
  RECONTATO_CANCELAMENTO: [100, 420],
  CONVERSAO_UPSELL: [60, 240],
  // Respostas de pesquisa e avaliações de qualidade do mês.
  NOTA_URA: [40, 220],
  TDNA: [40, 220],
  NPS: [25, 80],
  QUALIDADE_ANALISE: [15, 35],
  MONITORIA_QUALIDADE: [4, 12],
  QUALIDADE: [4, 12],
  // Minutos programados no mês.
  ADERENCIA: [7800, 10600],
  TEMPO_DISPONIVEL: [7400, 10100],
}
const DEFAULT_MONTHLY_VOLUME: readonly [number, number] = [200, 900]

function decimalsOf(value: number): number {
  const text = Math.abs(value).toString()
  const dot = text.indexOf(".")
  return /e/i.test(text) ? 6 : dot === -1 ? 0 : Math.min(6, text.length - dot - 1)
}

export type ClosureComponents = { numerator: number; denominator: number }

export function closureComponents(input: { rowKey: string; code: string; kind: OperationalAggregationKind; value: number }): ClosureComponents | null {
  const scale = componentValueScale(input.kind)
  if (scale === null) return null
  const [min, max] = MONTHLY_VOLUME[input.code] ?? DEFAULT_MONTHLY_VOLUME
  const start = createRandom(hashSeed(`closure-components:${input.rowKey}`)).int(min, max)
  const decimals = decimalsOf(input.value)
  const span = max - min + 1
  // Contagens inteiras sempre que possível: a partir do volume sorteado, o primeiro denominador da faixa
  // cujo numerador inteiro reproduz o valor oficial na precisão em que ele foi gravado.
  for (let step = 0; step < span; step += 1) {
    const denominator = min + ((start - min + step) % span)
    const numerator = Math.round((input.value / scale) * denominator)
    if (roundTo((numerator / denominator) * scale, decimals) === input.value) return { numerator, denominator }
  }
  // Nenhum inteiro da faixa reproduz (ex.: média de poucas avaliações com duas casas): total fracionário.
  return { numerator: roundTo((input.value / scale) * start, 6), denominator: start }
}

export type ClosureComponentsFill = { pending: number; filled: number; withoutComponents: number }

/**
 * Preenche numerador/denominador dos fechamentos DEMO (`source = 'DEMO_SEED'` da organização demo) que
 * ainda não os têm — banco populado antes da migration 147 e as linhas do seed SQL 001. Nunca toca valor,
 * meta, atingimento, peso, quartil, linha de outra origem nem componente já gravado. Idempotente: a segunda
 * rodada não encontra nada. `apply: false` só conta (dry-run).
 */
export async function fillDemoClosureComponents(client: pg.ClientBase, options: { apply: boolean } = { apply: true }, batchSize = 5000): Promise<ClosureComponentsFill> {
  const rows = await client.query<{ id: string; code: string; kind: OperationalAggregationKind; value: string }>(
    `select eip.id, idef.code, idef.operational_aggregation kind, eip.value::text value
       from employee_indicator_performance eip
       join indicator_definitions idef on idef.id = eip.indicator_definition_id
      where eip.organization_id = $1 and eip.source = $2 and eip.numerator is null and eip.denominator is null
      order by eip.id`,
    [DEMO_ORGANIZATION_ID, DEMO_SOURCE],
  )
  const updates: { id: string; numerator: number; denominator: number }[] = []
  for (const row of rows.rows) {
    const components = closureComponents({ rowKey: row.id, code: row.code, kind: row.kind, value: Number(row.value) })
    if (components) updates.push({ id: row.id, ...components })
  }
  const report: ClosureComponentsFill = { pending: updates.length, filled: 0, withoutComponents: rows.rows.length - updates.length }
  if (!options.apply) return report
  for (let index = 0; index < updates.length; index += batchSize) {
    const batch = updates.slice(index, index + batchSize)
    const result = await client.query(
      `update employee_indicator_performance eip set numerator = t.numerator, denominator = t.denominator
         from unnest($1::uuid[], $2::numeric[], $3::numeric[]) as t(id, numerator, denominator)
        where eip.id = t.id and eip.organization_id = $4 and eip.source = $5 and eip.numerator is null and eip.denominator is null`,
      [batch.map((row) => row.id), batch.map((row) => row.numerator), batch.map((row) => row.denominator), DEMO_ORGANIZATION_ID, DEMO_SOURCE],
    )
    report.filled += result.rowCount ?? 0
  }
  return report
}
