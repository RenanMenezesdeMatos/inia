import type pg from "pg"
import { DEMO_EXTERNAL_PREFIX, DEMO_ORGANIZATION_ID, DEMO_STRUCTURE } from "./demo-constants.js"
import { demoId } from "./demo-ids.js"
import { NameGenerator, type Gender, type PersonName } from "./names.js"
import { PERSONA_DECK } from "./personas.js"
import type { Random } from "./random.js"
import { demoEmail, DIAGNOSTIC_SUBGROUP, isoDate, pad, pickOperatorSubgroup, subteamKey, subteamKey as subteamKeyOf, teamDesign, titled, type DemoPerson, type DemoStructure } from "./structure-generator.js"

/**
 * ADOÇÃO DA CADEIA LEGADA pela massa demo.
 *
 * Antes da massa grande, as migrations (002/009/019/020/021/044) já criavam uma pequena
 * hierarquia de demonstração — Ana Lima, Mariana Costa, Roberto Alves, Bruno Teixeira… — com
 * chamadas reais transcritas, casos, feedbacks e fechamentos próprios. Ela vivia numa árvore à
 * parte (Diretor Paulo Ricardo → Gerente Sênior Fernanda Dias), fora dos Grupos demo e sem o
 * histórico de 6 competências / medições diárias que os 2.000 operadores gerados têm.
 *
 * Esta etapa encaixa essas pessoas na árvore demo SEM recriá-las:
 *   - Diretor e Gerente Sênior legados saem (a árvore tem um Diretor: o da massa);
 *   - os dois Gerentes legados passam a responder às Gerentes Sêniores B2B da massa, cada um
 *     dono de um Grupo demo equivalente ao antigo;
 *   - Coordenadora, Supervisores e Operadores legados seguem sob seus gestores de hoje, com o
 *     Grupo demo correspondente ao Grupo antigo (mapa `LEGACY_TEAM_BY_GROUP`);
 *   - a massa COMPLETA o desenho: novos Supervisores até cada Gerente ter 5 e novos Operadores
 *     até cada Supervisor ter 25 — gerados como qualquer outro (login `.demo`, persona, 6
 *     competências, diárias, chamadas), com ordinais que continuam a sequência (81+, 2001+).
 *
 * O que já existe é PRESERVADO: id, nome, e-mail/senha, `hired_at`, chamadas reais, casos,
 * feedbacks, fechamentos e medições de outras fontes. A massa só preenche onde não há dado
 * (fechamentos por competência inexistente, medições por dia/indicador sem outra fonte). Os
 * operadores "TESTE …" (fixtures de Workflow) ficam de fora: continuam com seus supervisores,
 * nos Subgrupos TESTE, sem Grupo demo nem dado gerado — e não contam nos 25.
 *
 * Os ids legados NÃO são determinísticos (as migrations inserem por nome), então a resolução é
 * por (organização, nome, papel) no momento da carga — `loadLegacyPeople`. Pessoa ausente = não
 * adotada (log), nunca criada aqui.
 */
export type LegacySupervisorSpec = { name: string; groupKey: string; operators: readonly string[] }
export type LegacyManagerSpec = {
  name: string
  /** Gerente Sênior demo (ordinal 1..4) a quem passa a responder — 3 e 4 são B2B. */
  seniorManagerOrdinal: number
  groupKey: string
  /** Coordenador(a) legado(a) que fica entre o Gerente e TODOS os seus Supervisores (desenho "Gerente ímpar"). */
  coordinator: string | null
  supervisors: readonly LegacySupervisorSpec[]
}

/** Grupo legado (`teams.external_code`, derivado do nome pela migration 056) → Grupo demo. */
export const LEGACY_TEAM_BY_GROUP: Readonly<Record<string, string>> = {
  "b2b-retencao": "RETENCAO_FIDELIZACAO",
  "b2b-atendimento-pme": "ATENDIMENTO_GERAL",
  "b2b-faturamento-empresarial": "FATURAS",
  "b2b-suporte-empresarial": "SUPORTE_TECNICO",
}

/** Gerente Sênior e Diretor legados (ids fixos da migration 009) — removidos pela adoção, de baixo pra cima (a Sênior reportava ao Diretor). */
export const LEGACY_REMOVED_LEADERS: readonly { id: string; name: string }[] = [
  { id: "00000000-0000-4000-8000-000000000034", name: "Fernanda Dias" },
  { id: "00000000-0000-4000-8000-000000000035", name: "Paulo Ricardo" },
]

export const LEGACY_MANAGERS: readonly LegacyManagerSpec[] = [
  {
    name: "Roberto Alves", seniorManagerOrdinal: 3, groupKey: "b2b-retencao", coordinator: "Patrícia Coordenadora",
    supervisors: [
      { name: "Mariana Costa", groupKey: "b2b-retencao", operators: ["Ana Lima", "Luzia Ingrid da Silva Nobre"] },
      { name: "Vanessa Lopes", groupKey: "b2b-atendimento-pme", operators: ["Icaro Elias", "Karoline Wokysbly", "Luana Brenda"] },
    ],
  },
  {
    name: "Roberta Gaspar", seniorManagerOrdinal: 4, groupKey: "b2b-faturamento-empresarial", coordinator: null,
    supervisors: [
      { name: "Bruno Teixeira", groupKey: "b2b-faturamento-empresarial", operators: ["Camila Pereira", "Gustavo Santos", "Pamella Albuquerque"] },
      { name: "Thiago Barreto", groupKey: "b2b-suporte-empresarial", operators: ["Denisy Feitoza", "Juliana Prado", "Samuel Avelino"] },
    ],
  },
]

/**
 * OPERADORES LEGADOS COM GRAVAÇÕES → SUBGRUPO DE DIAGNÓSTICO (2026-09-18).
 *
 * Auditoria do banco de desenvolvimento antes da decisão (interações por operador): 2.238
 * operadores gerados têm exatamente 10 chamadas (as da massa); 1 tem 11 (uma sobra de QA); os ÚNICOS
 * com massa própria de gravações são os 11 operadores legados abaixo — cada um com 10 transcrições
 * escritas à mão nas migrations/scripts antigos (`ANA-LIMA-nn`, `LUANA-BRENDA-nn`…) além das 10
 * geradas, num total de 20 a 30 chamadas com transcrição. Critério: ter corpus próprio além da
 * massa gerada (≥ 20 interações), não um número inventado. Ninguém entra "só pra encher".
 *
 * Eles passam a ser posicionados no MESMO universo de comparação das personas canônicas: Grupo
 * `B2C · Atendimento Geral`, Subgrupo "Diagnóstico IA — Operadores com gravações", sob a
 * Supervisora 01 (a dona do Subgrupo — nenhum supervisor novo é inventado). A vaga de origem
 * continua consumida (mesmo ordinal, persona, matrícula/e-mail, nome do gerado seguinte inalterado):
 * o supervisor legado fica com 25 − n operadores, o que é uma estrutura válida; nada é recriado.
 * Fechamentos/diárias DEMO_SEED passam a seguir o catálogo do Grupo novo (como qualquer operador do
 * Grupo); o que a massa tinha gerado para o Grupo antigo e não existe mais no catálogo é removido
 * (`pruneRelocatedGeneratedRows`) — fechamentos/medições de OUTRAS fontes (seed SQL, chamadas reais,
 * QA) nunca são tocados. No reset, `legacyTeamExternalCode` continua devolvendo cada um ao Grupo legado.
 */
export const DIAGNOSTIC_LEGACY_OPERATORS: readonly string[] = [
  "Ana Lima", "Luzia Ingrid da Silva Nobre",
  "Icaro Elias", "Karoline Wokysbly", "Luana Brenda",
  "Camila Pereira", "Gustavo Santos", "Pamella Albuquerque",
  "Denisy Feitoza", "Juliana Prado", "Samuel Avelino",
]
const DIAGNOSTIC_SUPERVISOR_KEY = `supervisor:${pad(DIAGNOSTIC_SUBGROUP.supervisorOrdinal, 2)}`

export type LegacyPersonRow = {
  id: string
  name: string
  role: DemoPerson["role"]
  jobTitle: string | null
  matricula: string | null
  hiredAt: string | null
  accountEmail: string | null
}

/** Pessoas do banco com nome legado (pode haver homônimo gerado pela própria massa — filtrado na adoção). Vazio = nada a adotar. */
export type LegacyPeople = readonly LegacyPersonRow[]
export const NO_LEGACY_PEOPLE: LegacyPeople = []

export function legacyPersonNames(): string[] {
  const names: string[] = []
  for (const manager of LEGACY_MANAGERS) {
    names.push(manager.name)
    if (manager.coordinator) names.push(manager.coordinator)
    for (const supervisor of manager.supervisors) names.push(supervisor.name, ...supervisor.operators)
  }
  return names
}

export async function loadLegacyPeople(client: pg.PoolClient): Promise<LegacyPeople> {
  const result = await client.query<LegacyPersonRow>(
    `select p.id, p.name, p.role, p.job_title "jobTitle", p.matricula, p.hired_at::text "hiredAt", u.email "accountEmail"
       from people p
       left join user_accounts u on u.person_id = p.id
      where p.organization_id = $1 and p.name = any($2::text[])`,
    [DEMO_ORGANIZATION_ID, legacyPersonNames()],
  )
  return result.rows
}

/** Só pra concordância do cargo gerado quando a pessoa não tem `job_title` — os nomes legados são conhecidos. */
const LEGACY_FEMININE_FIRST_NAMES = new Set(["Ana", "Luzia", "Juliana", "Denisy", "Camila", "Pamella", "Karoline", "Luana", "Mariana", "Vanessa", "Roberta", "Patrícia"])
function genderOf(name: string): Gender {
  return LEGACY_FEMININE_FIRST_NAMES.has(name.split(" ")[0]!) ? "F" : "M"
}

export type LegacyAdoptionReport = { adopted: DemoPerson[]; generated: DemoPerson[]; missing: string[] }

/**
 * Estende a estrutura gerada com a cadeia legada + preenchimento. Determinístico para o mesmo
 * conjunto de pessoas legadas (ids vêm do banco; tudo o mais deriva do seed).
 */
export type LegacyAdoptionOptions = {
  /** `false` só em TESTE: posiciona os operadores legados na vaga de origem (como antes de 2026-09-18) para provar que o snapshot oficial não depende disso. */
  relocateDiagnosticOperators?: boolean
}

export function extendStructureWithLegacy(structure: DemoStructure, legacy: LegacyPeople, random: Random, options: LegacyAdoptionOptions = {}): LegacyAdoptionReport {
  const report: LegacyAdoptionReport = { adopted: [], generated: [], missing: [] }
  if (legacy.length === 0) return report
  // Homônimo gerado pela massa (ex.: há uma "Camila Pereira" entre os 2.000) nunca é confundido com a pessoa legada.
  const generatedIds = new Set(structure.people.map((person) => person.id))
  const candidates = new Map<string, LegacyPersonRow[]>()
  for (const row of legacy) {
    if (generatedIds.has(row.id)) continue
    candidates.set(row.name, [...(candidates.get(row.name) ?? []), row])
  }

  const names = new NameGenerator(random.fork("names"))
  // Nomes já usados (massa base) e os legados (adotados ou não) nunca saem do gerador de preenchimento.
  for (const taken of [...structure.people.map((person) => person.name), ...legacyPersonNames()]) {
    try {
      names.reserve(taken, "F")
    } catch {
      // Repetido — só queremos marcá-lo como usado.
    }
  }
  const dates = random.fork("hired")
  const decks = random.fork("personas")
  const teamMix = random.fork("subgroups")
  const ordinals = nextOrdinals(structure)

  const add = (person: DemoPerson): DemoPerson => {
    structure.people.push(person)
    structure.byKey.set(person.key, person)
    ;(person.adopted ? report.adopted : report.generated).push(person)
    return person
  }
  const adopt = (name: string, role: DemoPerson["role"], ordinal: number, teamKey: string | null, subteamKey: string | null, reportsToKey: string | null, persona: DemoPerson["persona"]): DemoPerson | null => {
    const matches = (candidates.get(name) ?? []).filter((candidate) => candidate.role === role)
    const row = matches.length === 1 ? matches[0]! : null
    if (!row) {
      report.missing.push(`${name} (${role}${matches.length > 1 ? ", ambíguo" : ""})`)
      return null
    }
    const gender = genderOf(name)
    // Operador legado com gravações: a VAGA é a do supervisor legado (ordinal/persona), a POSIÇÃO é o Subgrupo de diagnóstico.
    const relocated = role === "OPERATOR" && DIAGNOSTIC_LEGACY_OPERATORS.includes(name) && options.relocateDiagnosticOperators !== false
    const slotTeam = teamKey ? structure.teamByKey.get(teamKey)! : null
    const placement = relocated
      ? { teamKey: DIAGNOSTIC_SUBGROUP.teamKey, subteamKey: subteamKeyOf(DIAGNOSTIC_SUBGROUP.teamKey, DIAGNOSTIC_SUBGROUP.name), reportsToKey: DIAGNOSTIC_SUPERVISOR_KEY }
      : { teamKey, subteamKey, reportsToKey }
    if (relocated && !structure.byKey.has(DIAGNOSTIC_SUPERVISOR_KEY)) throw new Error(`Supervisor ${DIAGNOSTIC_SUPERVISOR_KEY} (dono do Subgrupo de diagnóstico) não existe na estrutura`)
    const team = placement.teamKey ? structure.teamByKey.get(placement.teamKey)! : null
    // Cargo: o existente fica — exceto quando é exatamente o que a massa escreveu para o Grupo da vaga
    // (reposicionado): aí vale o padrão do Grupo novo. Cargo digitado por alguém nunca muda.
    const slotSeedJobTitle = defaultJobTitle(role, gender, slotTeam?.name ?? null)
    const jobTitle = row.jobTitle === null || (relocated && row.jobTitle === slotSeedJobTitle) ? defaultJobTitle(role, gender, team?.name ?? null) : row.jobTitle
    return add({
      id: row.id, key: `adopted:${slug(name)}`, role, name, gender,
      jobTitle,
      matricula: row.matricula ?? `${DEMO_EXTERNAL_PREFIX}-LEG-${pad(ordinal, 4)}`,
      email: row.accountEmail ?? demoEmail(`${emailPrefix(role)}${pad(ordinal, role === "OPERATOR" ? 4 : 2)}`),
      ...placement,
      hiredAt: row.hiredAt ?? isoDate(dates, 2019, 2024),
      persona, lateHire: false, absentLastPeriod: false, ordinal,
      // O Grupo legado vem do MAPA estático, não do banco: numa segunda carga a pessoa já está no Grupo demo.
      adopted: {
        legacyTeamExternalCode: teamKey ? (LEGACY_TEAM_BY_GROUP[teamKey] ?? null) : null, accountEmail: row.accountEmail, hasHiredAt: row.hiredAt !== null,
        ...(relocated && teamKey && reportsToKey ? { relocatedFrom: { teamKey, subteamKey, reportsToKey, seedJobTitle: slotSeedJobTitle } } : {}),
      },
    })
  }

  // Gestor legado ausente no banco (ex.: banco recém-migrado, onde só parte da cadeia existe) →
  // uma pessoa GERADA ocupa o lugar dele, pra quem está abaixo continuar tendo estrutura.
  // Toda vaga consome um nome do gerador, adotada ou não: o nome de cada gerado fica estável
  // independentemente de quais legados existem no banco.
  const generateManager = (ordinal: number, name: PersonName, teamName: string, teamKey: string, reportsToKey: string): DemoPerson => {
    return add({
      key: `manager:${pad(ordinal, 2)}`, id: demoId(`person:manager:${pad(ordinal, 2)}`), role: "MANAGER", name: name.fullName, gender: name.gender,
      jobTitle: `Gerente — ${teamName}`, matricula: `${DEMO_EXTERNAL_PREFIX}-GER-${pad(ordinal, 3)}`, email: demoEmail(`gerente${pad(ordinal, 2)}`),
      teamKey, subteamKey: null, reportsToKey, hiredAt: isoDate(dates, 2015, 2022), persona: null, lateHire: false, absentLastPeriod: false, ordinal,
    })
  }
  const generateSupervisor = (ordinal: number, name: PersonName, teamName: string, teamKey: string, subteam: string | null, reportsToKey: string): DemoPerson => {
    return add({
      key: `supervisor:${pad(ordinal, 2)}`, id: demoId(`person:supervisor:${pad(ordinal, 2)}`), role: "SUPERVISOR", name: name.fullName, gender: name.gender,
      jobTitle: titled(name.gender, `Supervisor — ${teamName}`, `Supervisora — ${teamName}`),
      matricula: `${DEMO_EXTERNAL_PREFIX}-SUP-${pad(ordinal, 3)}`, email: demoEmail(`supervisor${pad(ordinal, 2)}`),
      teamKey, subteamKey: subteam, reportsToKey, hiredAt: isoDate(dates, 2017, 2024), persona: null, lateHire: false, absentLastPeriod: false, ordinal,
    })
  }

  for (const managerSpec of LEGACY_MANAGERS) {
    const senior = structure.people.find((person) => person.role === "SENIOR_MANAGER" && person.ordinal === managerSpec.seniorManagerOrdinal)
    if (!senior) throw new Error(`Gerente Sênior demo ${managerSpec.seniorManagerOrdinal} não existe na estrutura`)
    const managerTeam = structure.teamByKey.get(managerSpec.groupKey)!
    const managerOrdinal = ordinals.manager++
    const managerName = names.next()
    const manager = adopt(managerSpec.name, "MANAGER", managerOrdinal, managerTeam.key, null, senior.key, null) ?? generateManager(managerOrdinal, managerName, managerTeam.name, managerTeam.key, senior.key)

    let supervisorsReportTo = manager.key
    if (managerSpec.coordinator) {
      const coordinator = adopt(managerSpec.coordinator, "COORDINATOR", ordinals.coordinator++, managerTeam.key, null, manager.key, null)
      if (coordinator) supervisorsReportTo = coordinator.key
    }

    for (let supervisorIndex = 1; supervisorIndex <= DEMO_STRUCTURE.supervisorsPerManager; supervisorIndex += 1) {
      const legacySupervisor = managerSpec.supervisors[supervisorIndex - 1] ?? null
      const team = structure.teamByKey.get(legacySupervisor?.groupKey ?? managerTeam.key)!
      const design = teamDesign(team.spec, supervisorIndex)
      const supervisorOrdinal = ordinals.supervisor++
      const supervisorSubteam = design.primary ? subteamKey(team.key, design.primary) : null
      const supervisorName = names.next()
      const supervisor =
        (legacySupervisor ? adopt(legacySupervisor.name, "SUPERVISOR", supervisorOrdinal, team.key, supervisorSubteam, supervisorsReportTo, null) : null) ??
        generateSupervisor(supervisorOrdinal, supervisorName, team.name, team.key, supervisorSubteam, supervisorsReportTo)

      const deck = decks.shuffle(PERSONA_DECK)
      // Vagas FIXAS por ordinal (25 por supervisor): a vaga de um legado ausente recebe uma pessoa
      // gerada com o mesmo ordinal — a identidade de cada gerado não depende de quem existe no banco.
      for (let slot = 0; slot < DEMO_STRUCTURE.operatorsPerSupervisor; slot += 1) {
        const operatorOrdinal = ordinals.operator++
        const subgroup = pickOperatorSubgroup(teamMix, design, team.spec)
        const operatorSubteam = subgroup ? subteamKey(team.key, subgroup) : null
        const persona = deck[slot % deck.length]!
        const legacyName = legacySupervisor?.operators[slot] ?? null
        const operatorName = names.next()
        if (legacyName && adopt(legacyName, "OPERATOR", operatorOrdinal, team.key, operatorSubteam, supervisor.key, persona)) continue
        add({
          key: `operator:${pad(operatorOrdinal, 4)}`, id: demoId(`person:operator:${pad(operatorOrdinal, 4)}`), role: "OPERATOR", name: operatorName.fullName, gender: operatorName.gender,
          jobTitle: titled(operatorName.gender, `Operador de Atendimento — ${team.name}`, `Operadora de Atendimento — ${team.name}`),
          matricula: `${DEMO_EXTERNAL_PREFIX}-OP-${pad(operatorOrdinal, 4)}`, email: demoEmail(`operador${pad(operatorOrdinal, 4)}`),
          teamKey: team.key, subteamKey: operatorSubteam, reportsToKey: supervisor.key,
          hiredAt: isoDate(dates, 2018, 2025), persona, lateHire: false, absentLastPeriod: false, ordinal: operatorOrdinal,
        })
      }
    }
  }
  return report
}

function nextOrdinals(structure: DemoStructure): Record<"manager" | "coordinator" | "supervisor" | "operator", number> {
  const max = (role: DemoPerson["role"]) => structure.people.filter((person) => person.role === role).reduce((best, person) => Math.max(best, person.ordinal), 0)
  return { manager: max("MANAGER") + 1, coordinator: max("COORDINATOR") + 1, supervisor: max("SUPERVISOR") + 1, operator: max("OPERATOR") + 1 }
}

function slug(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

function emailPrefix(role: DemoPerson["role"]): string {
  return role === "OPERATOR" ? "operador" : role === "SUPERVISOR" ? "supervisor" : role === "COORDINATOR" ? "coordenador" : "gerente"
}

function defaultJobTitle(role: DemoPerson["role"], gender: Gender, teamName: string | null): string {
  const suffix = teamName ? ` — ${teamName}` : ""
  if (role === "OPERATOR") return titled(gender, `Operador de Atendimento${suffix}`, `Operadora de Atendimento${suffix}`)
  if (role === "SUPERVISOR") return titled(gender, `Supervisor${suffix}`, `Supervisora${suffix}`)
  if (role === "COORDINATOR") return titled(gender, `Coordenador${suffix}`, `Coordenadora${suffix}`)
  return `Gerente${suffix}`
}

export type LeaderRemovalReport = { removed: string[]; deactivated: { name: string; references: string[] }[] }

/** Referências que impedem apagar uma pessoa (dado de domínio real apontando pra ela). */
const LEADER_REFERENCES: readonly { table: string; column: string }[] = [
  { table: "people", column: "reports_to_id" },
  { table: "supervision_cases", column: "operator_id" },
  { table: "supervision_cases", column: "assignee_id" },
  { table: "feedbacks", column: "operator_id" },
  { table: "feedbacks", column: "author_id" },
  { table: "workflow_outputs", column: "recipient_id" },
  { table: "workflow_enrollments", column: "scheduled_subject_id" },
  { table: "development_plans", column: "operator_id" },
  { table: "development_plans", column: "owner_id" },
  { table: "performance_escalations", column: "operator_id" },
  { table: "assistant_interactions", column: "operator_id" },
  { table: "assistant_conversations", column: "owner_person_id" },
  { table: "qa_runs", column: "executed_by" },
  { table: "workflows", column: "created_by" },
  { table: "workflow_versions", column: "created_by" },
  { table: "audit_logs", column: "actor_id" },
  { table: "case_timeline_events", column: "actor_id" },
  { table: "agent_history", column: "changed_by_person_id" },
  { table: "assistant_orchestrators", column: "created_by" },
  { table: "org_config_values", column: "updated_by" },
  { table: "interventions", column: "person_id" },
  { table: "interventions", column: "responsible_id" },
  { table: "interventions", column: "approver_id" },
  { table: "intervention_policy_evaluations", column: "person_id" },
]

/**
 * Remove o Diretor e a Gerente Sênior legados (a árvore demo já tem Diretor; os Gerentes legados
 * passam a responder às Sêniores da massa). Os alertas endereçados a eles saem junto (Sino). Se
 * algum dado de domínio real ainda apontar pra pessoa, ela é DESATIVADA (pessoa + conta) em vez
 * de apagada — nunca se apaga dado de domínio pra caber na demo. Idempotente.
 */
export async function removeLegacyLeaders(client: pg.PoolClient): Promise<LeaderRemovalReport> {
  const report: LeaderRemovalReport = { removed: [], deactivated: [] }
  for (const leader of LEGACY_REMOVED_LEADERS) {
    const exists = await client.query(`select 1 from people where id = $1 and organization_id = $2`, [leader.id, DEMO_ORGANIZATION_ID])
    if (exists.rowCount === 0) continue
    const references: string[] = []
    for (const reference of LEADER_REFERENCES) {
      const count = await client.query<{ count: string }>(`select count(*)::text from ${reference.table} where ${reference.column} = $1`, [leader.id])
      if (Number(count.rows[0]!.count) > 0) references.push(`${reference.table}.${reference.column}`)
    }
    await client.query("begin")
    try {
      if (references.length > 0) {
        await client.query(`update people set active = false where id = $1`, [leader.id])
        await client.query(`update user_accounts set active = false, updated_at = now() where person_id = $1`, [leader.id])
        report.deactivated.push({ name: leader.name, references })
      } else {
        await client.query(`delete from alerts where recipient_id = $1`, [leader.id])
        await client.query(`delete from user_role_assignments where person_id = $1`, [leader.id])
        await client.query(`delete from access_role_assignments where user_account_id in (select id from user_accounts where person_id = $1)`, [leader.id])
        await client.query(`delete from user_accounts where person_id = $1`, [leader.id])
        await client.query(`delete from people where id = $1`, [leader.id])
        report.removed.push(leader.name)
      }
      await client.query("commit")
    } catch (error) {
      await client.query("rollback")
      throw error
    }
  }
  return report
}
