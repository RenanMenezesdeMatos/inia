/**
 * Constantes da MASSA DE DADOS DEMONSTRATIVA (estrutura grande + 6 competências + 20 mil
 * interações). Tudo que o gerador produz deriva destas constantes + do seed pseudoaleatório:
 * rodar duas vezes gera exatamente os mesmos ids, nomes, valores e transcrições.
 */
export const DEMO_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001"
/** Operação real já existente no banco (migration 001) — os grupos B2B da massa entram nela. */
export const EXISTING_B2B_OPERATION_ID = "00000000-0000-4000-8000-000000000010"

/** Seed fixo do gerador pseudoaleatório (Mulberry32). Mudar isso muda TODA a massa. */
export const DEMO_RANDOM_SEED = 20260915

/** Proveniência gravada em `source` onde a tabela tem essa coluna (performance, medições). */
export const DEMO_SOURCE = "DEMO_SEED"

/** Prefixo de todo `external_id`/`matricula` da massa — só localizador, nunca usado pra apagar. */
export const DEMO_EXTERNAL_PREFIX = "DEMO"

/** Tamanho mínimo da senha das contas demo (a política de cadastro exige 6+; aqui pedimos mais). */
export const DEMO_PASSWORD_MIN_LENGTH = 8

/**
 * Senha única de todos os usuários demo — vem de INIA_DEMO_PASSWORD (backend/.env; `npm run env:init` gera uma
 * aleatória), nunca do código. Só dev/test/demo local (o runner recusa produção).
 */
export function resolveDemoPassword(value: string | undefined): string {
  const password = value?.trim() ?? ""
  if (password.length < DEMO_PASSWORD_MIN_LENGTH) {
    throw new Error(`Defina INIA_DEMO_PASSWORD no backend/.env (${DEMO_PASSWORD_MIN_LENGTH}+ caracteres; npm run env:init gera uma): é a senha das contas de demonstração.`)
  }
  return password
}
export const DEMO_EMAIL_DOMAIN = "inia.local"

/** Quantidade de competências mensais OFICIAIS da massa (sempre meses civis completos, antes do mês da referência). */
export const DEMO_CLOSED_PERIOD_COUNT = 6
export type DemoReferencePeriod = string

/**
 * As N competências FECHADAS anteriores à data de referência ("AAAA-MM", da mais antiga pra mais
 * recente). Fechamento oficial só existe para mês civil completo: com referência em 16/09/2026,
 * o último fechamento é 2026-08 e o mês corrente (setembro) existe só na camada operacional
 * (DAILY). Nunca hardcode — sempre derivado da referência.
 */
export function closedReferencePeriods(referenceDate: string, count: number = DEMO_CLOSED_PERIOD_COUNT): DemoReferencePeriod[] {
  const year = Number(referenceDate.slice(0, 4))
  const month = Number(referenceDate.slice(5, 7))
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - index), 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
  })
}

/** Dia (AAAA-MM-DD) a partir do qual um operador "afastado" para de ter medição: dia 15 do último mês fechado. */
export function absenceStartFor(referenceDate: string): string {
  const periods = closedReferencePeriods(referenceDate)
  return `${periods[periods.length - 1]}-15`
}

/** Janela civil das interações: 1º dia da 1ª competência até a data "hoje" do ambiente demo. */
export const DEMO_INTERACTIONS_FROM = "2026-04-01"
export const DEMO_INTERACTIONS_UNTIL = "2026-09-14"

/** Fuso fixo -03:00, o mesmo assumido pelo motor (reference-period.ts). */
export const DEMO_TZ_OFFSET = "-03:00"

export const DEMO_STRUCTURE = {
  seniorManagersPerDirector: 4,
  managersPerSeniorManager: 4,
  supervisorsPerManager: 5,
  operatorsPerSupervisor: 25,
  interactionsPerOperator: 10,
} as const
