import type pg from "pg"
import type { Database } from "../pool.js"
import { applyEmployeeStatusSnapshot } from "../../../modules/people/application/employment-status-service.js"
import { addDaysToDate, type EmploymentStatus } from "../../../modules/people/domain/employment-status.js"
import type { DemoMass } from "./build-demo-mass.js"
import { absenceStartFor, DEMO_ORGANIZATION_ID, DEMO_SOURCE } from "./demo-constants.js"
import { DEMO_GROUPS } from "./indicator-catalog.js"
import type { DemoPerson } from "./structure-generator.js"

/**
 * SITUAÇÃO FUNCIONAL na massa demo — fixtures auxiliares, relativas à data de referência, que
 * cobrem os casos canônicos de elegibilidade sem tocar nas personas narrativas (Larissa, Mariana,
 * Beatriz, Rafael, Diego…). Passam pelo serviço canônico (`applyEmployeeStatusSnapshot`) com
 * datas EXPLÍCITAS e source DEMO_SEED — idempotente por construção (seed 2× = mesmos períodos).
 *
 *   operador0011 — FÉRIAS cobrindo a janela inteira dos últimos 7 dias (0 dias elegíveis → SEM DADOS);
 *   operador0012 — férias parciais (começaram há 2 dias: cobertura só sobre os dias trabalhados);
 *   operador0013 — voltou de férias há 3 dias (elegibilidade retoma na data efetiva);
 *   operador0014 — INSS desde 30 dias atrás, em aberto;
 *   operador0015 — MATERNIDADE desde 40 dias atrás, em aberto (janela inteira → SEM DADOS);
 *   operador0016 — PATERNIDADE de 5 dias atrás até 14 dias à frente;
 *   operador0017 — TRANSFERIDO desde 20 dias atrás (conta continua; não participa de cálculo);
 *   operador0018 — PILOTO desde 10 dias atrás;
 *   operador0019 — APOSENTADO desde 60 dias atrás;
 *   operador0020 — ATIVIDADE OFF de 3 dias atrás até 2 dias à frente;
 *   operador0022 — INSS por 2 dias na última semana (combinado com escala 6x1 — ver demo-work-schedules.ts);
 *   afastados da massa (`absentLastPeriod`) — ATIVIDADE OFF desde o dia 15 da última competência
 *   fechada (o mesmo corte que já apagava fechamento/chamadas), agora como situação registrada.
 * Coerência PLANEJADO × OBSERVADO: durante uma situação não produtiva a massa NÃO gera medição
 * (uma empresa cujo RH diz "férias" não manda produção) — exceto o operador0014 (INSS), que continua
 * com medição diária de propósito: é a fixture canônica de "produção com situação funcional não
 * produtiva" → a medição fica no banco, fora do cálculo, e o job de reconciliação registra a
 * INCONSISTÊNCIA (a situação nunca muda sozinha).
 */
export type DemoStatusFixture = { operatorOrdinal?: number; person?: DemoPerson; status: EmploymentStatus; from: string; to: string | null; scenario: string; /** A massa gera medição mesmo na situação não produtiva (inconsistência deliberada). */ production?: boolean }

/** Fixtures por ordinal (relativas à data de referência) — reutilizadas pelo gerador de medições. */
export function demoStatusFixturesByOrdinal(ref: string): DemoStatusFixture[] {
  return [
    { operatorOrdinal: 11, status: "FERIAS", from: addDaysToDate(ref, -12), to: addDaysToDate(ref, 4), scenario: "Férias cobrindo a janela inteira (últimos 7 dias) — 0 dias elegíveis" },
    { operatorOrdinal: 12, status: "FERIAS", from: addDaysToDate(ref, -2), to: addDaysToDate(ref, 10), scenario: "Férias parciais — começaram há 2 dias" },
    { operatorOrdinal: 13, status: "FERIAS", from: addDaysToDate(ref, -20), to: addDaysToDate(ref, -4), scenario: "Retorno recente — férias encerradas há 4 dias" },
    { operatorOrdinal: 13, status: "EM_PRODUCAO", from: addDaysToDate(ref, -3), to: null, scenario: "Retorno recente — em produção desde a data efetiva" },
    { operatorOrdinal: 14, status: "INSS", from: addDaysToDate(ref, -30), to: null, scenario: "INSS há 30 dias, em aberto — com medição diária chegando (inconsistência de dados deliberada)", production: true },
    { operatorOrdinal: 15, status: "MATERNIDADE", from: addDaysToDate(ref, -40), to: null, scenario: "Licença-maternidade em aberto — janela inteira não elegível" },
    { operatorOrdinal: 16, status: "PATERNIDADE", from: addDaysToDate(ref, -5), to: addDaysToDate(ref, 14), scenario: "Licença-paternidade com início e fim explícitos" },
    { operatorOrdinal: 17, status: "TRANSFERIDO", from: addDaysToDate(ref, -20), to: null, scenario: "Transferido — conta preservada por histórico, fora de todo cálculo operacional" },
    { operatorOrdinal: 18, status: "PILOTO", from: addDaysToDate(ref, -10), to: null, scenario: "Piloto — não produtivo" },
    { operatorOrdinal: 19, status: "APOSENTADO", from: addDaysToDate(ref, -60), to: null, scenario: "Aposentado — não participa" },
    { operatorOrdinal: 20, status: "ATIVIDADE_OFF", from: addDaysToDate(ref, -3), to: addDaysToDate(ref, 2), scenario: "Atividade off por 6 dias" },
    { operatorOrdinal: 22, status: "INSS", from: addDaysToDate(ref, -4), to: addDaysToDate(ref, -3), scenario: "INSS por 2 dias na última semana (operador 6x1 que trabalha sábado)" },
  ]
}

/** Datas (AAAA-MM-DD) em que a massa NÃO gera medição para o operador por situação não produtiva das fixtures. */
export function demoNonProductiveDates(person: Pick<DemoPerson, "role" | "ordinal">, referenceDate: string): (date: string) => boolean {
  if (person.role !== "OPERATOR") return () => false
  const periods = demoStatusFixturesByOrdinal(referenceDate).filter((fixture) => fixture.operatorOrdinal === person.ordinal && fixture.status !== "EM_PRODUCAO" && !fixture.production)
  if (periods.length === 0) return () => false
  return (date) => periods.some((period) => period.from <= date && (period.to === null || period.to >= date))
}

export function demoEmploymentStatusFixtures(mass: DemoMass): DemoStatusFixture[] {
  const ref = mass.referenceDate
  const fixtures: DemoStatusFixture[] = demoStatusFixturesByOrdinal(ref)
  for (const person of mass.structure.people) {
    if (person.role === "OPERATOR" && person.absentLastPeriod) fixtures.push({ person, status: "ATIVIDADE_OFF", from: absenceStartFor(ref), to: null, scenario: "Atividade off desde o dia 15 da última competência fechada" })
  }
  return fixtures
}

export async function persistDemoEmploymentStatus(client: pg.PoolClient, mass: DemoMass): Promise<{ periods: number; people: number }> {
  const fixtures = demoEmploymentStatusFixtures(mass)
  const observedAt = new Date(`${mass.referenceDate}T12:00:00-03:00`)
  const people = new Set<string>()
  for (const fixture of fixtures) {
    const person = fixture.person ?? mass.structure.people.find((candidate) => candidate.role === "OPERATOR" && candidate.ordinal === fixture.operatorOrdinal)
    if (!person) continue
    people.add(person.id)
    // O serviço só usa `query` — o PoolClient da carga serve como Database.
    await applyEmployeeStatusSnapshot({ query: client.query.bind(client) } as unknown as Database, {
      organizationId: DEMO_ORGANIZATION_ID,
      personId: person.id,
      status: fixture.status,
      effectiveFrom: fixture.from,
      effectiveTo: fixture.to,
      observedAt,
      sourceUpdatedAt: observedAt,
      source: DEMO_SOURCE,
      sourceReference: fixture.scenario,
    })
    // Coerência da própria massa: medição DEMO_SEED gerada por um seed anterior dentro de uma situação
    // não produtiva (sem `production`) não seria gerada hoje — some. Só DEMO_SEED deste operador; medição
    // real de cliente nunca é apagada por causa de situação funcional.
    if (fixture.operatorOrdinal !== undefined && fixture.status !== "EM_PRODUCAO" && !fixture.production) {
      await client.query(
        `delete from indicator_measurements m where m.subject_type = 'PERSON' and m.subject_id = $1 and m.source = $2 and m.granularity = 'DAILY'
           and (m.period_start at time zone 'America/Fortaleza')::date between $3::date and coalesce($4::date, 'infinity'::date)`,
        [person.id, DEMO_SOURCE, fixture.from, fixture.to],
      )
    }
  }
  return { periods: fixtures.length, people: people.size }
}

/**
 * Cobertura mínima PADRÃO dos indicadores diários na demo (IndicatorDefinition.minimumCoverage —
 * só onde o admin ainda não configurou nada). É a fonte que Analytics/Profile usam e o valor
 * que o editor pré-preenche em Workflows. Indicadores amostrados por natureza (Monitoria, NPS,
 * Qualidade de análise: poucas avaliações por semana) recebem um mínimo menor.
 */
export const DEMO_MINIMUM_COVERAGE_DEFAULTS: { codes: string[]; minimumCoverage: number }[] = [
  { codes: ["MONITORIA_QUALIDADE", "NPS", "QUALIDADE_ANALISE"], minimumCoverage: 0.4 },
]
export const DEMO_MINIMUM_COVERAGE_DEFAULT = 0.6

export async function ensureIndicatorCoverageDefaults(client: pg.PoolClient): Promise<number> {
  let updated = 0
  for (const group of DEMO_MINIMUM_COVERAGE_DEFAULTS) {
    const result = await client.query(`update indicator_definitions set minimum_coverage = $2 where organization_id = $1 and daily_supported and minimum_coverage is null and code = any($3::text[])`, [DEMO_ORGANIZATION_ID, group.minimumCoverage, group.codes])
    updated += result.rowCount ?? 0
  }
  const rest = await client.query(`update indicator_definitions set minimum_coverage = $2 where organization_id = $1 and daily_supported and minimum_coverage is null`, [DEMO_ORGANIZATION_ID, DEMO_MINIMUM_COVERAGE_DEFAULT])
  return updated + (rest.rowCount ?? 0)
}

/**
 * CONFIGURAÇÃO demo de evidência de produção: o indicador de EFICIÊNCIA de cada Grupo (TMA/TMT/tempo
 * de diagnóstico — volume de atendimentos no denominador) é marcado como `proves_work_activity`.
 * É configuração de catálogo (a mesma que o admin faz na tela Indicadores), não regra por código no
 * motor: a INIA continua sem conhecer "TMA". Idempotente.
 */
export async function ensureWorkActivityEvidenceIndicators(client: pg.PoolClient): Promise<number> {
  const codes = [...new Set(DEMO_GROUPS.map((group) => group.efficiencyCode))]
  const result = await client.query(`update indicator_definitions set proves_work_activity = true where organization_id = $1 and daily_supported and not proves_work_activity and code = any($2::text[])`, [DEMO_ORGANIZATION_ID, codes])
  return result.rowCount ?? 0
}

/**
 * DISPONIBILIDADE demo: a massa grava direto nas tabelas (nunca por /ingestion), então os feeds demo da
 * Central não "rodam". Para que a reconciliação tenha como saber que as fontes ENTREGARAM os dias da massa,
 * a carga registra nos feeds relevantes (medições, interações, colaboradores) a última carga bem-sucedida =
 * agora e o último dado = data de referência da massa — o mesmo que uma carga real faria. As políticas
 * D-1/D-2 vêm do SQL da Central (seeds/demo/002_data_hub.sql); nada é presumido aqui.
 */
export async function touchDemoAvailabilityFeeds(client: pg.PoolClient, referenceDate: string): Promise<number> {
  const result = await client.query(
    `update data_feeds set last_success_at = now(), last_data_at = greatest(coalesce(last_data_at, '-infinity'::timestamptz), ($2::date::timestamp at time zone 'America/Sao_Paulo') + interval '23 hours 59 minutes')
      where organization_id = $1 and deleted_at is null and source_namespace = 'DEMO_SEED' and contract_key in ('INDICATOR_MEASUREMENTS', 'INTERACTIONS')`,
    [DEMO_ORGANIZATION_ID, referenceDate],
  )
  const employees = await client.query(`update data_feeds set last_success_at = now() where organization_id = $1 and deleted_at is null and contract_key in ('EMPLOYEES', 'EMPLOYEE_ABSENCES') and status <> 'DRAFT' and availability_policy is not null`, [DEMO_ORGANIZATION_ID])
  return (result.rowCount ?? 0) + (employees.rowCount ?? 0)
}
