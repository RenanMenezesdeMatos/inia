import { DEMO_EMAIL_DOMAIN, DEMO_EXTERNAL_PREFIX, DEMO_STRUCTURE, EXISTING_B2B_OPERATION_ID } from "./demo-constants.js"
import { DemoIdRegistry } from "./demo-ids.js"
import { CANONICAL_OPERATORS } from "./demo-identities.js"
import { DEMO_GROUPS, type GroupSpec } from "./indicator-catalog.js"
import { NameGenerator, type Gender } from "./names.js"
import { PERSONA_DECK, type Persona } from "./personas.js"
import type { Random } from "./random.js"

/**
 * Estrutura organizacional GRANDE, com os dois desenhos reais da empresa:
 *
 *   Diretor → 4 Gerentes Sêniores → 4 Gerentes cada (16)
 *   Gerente ímpar  → 1 Coordenador → 5 Supervisores → 25 Operadores   (8 gerentes)
 *   Gerente par    → 5 Supervisores diretos          → 25 Operadores   (8 gerentes)
 *
 * = 1 + 4 + 16 + 8 + 80 + 2.000 pessoas, todas com login. Cada Gerente responde por UM Grupo
 * (alguns Grupos têm 2 gerentes); Supervisores/Operadores herdam o Grupo e recebem Subgrupo
 * conforme o desenho da equipe (um só, misto, ou parte sem Subgrupo). Gerentes Sêniores 1–2 são
 * B2C e 3–4 são B2B.
 */
export type DemoRole = "DIRECTOR" | "SENIOR_MANAGER" | "MANAGER" | "COORDINATOR" | "SUPERVISOR" | "OPERATOR"

export type DemoOperation = { id: string; key: string; name: string; existing: boolean }
export type DemoTeam = { id: string; key: string; name: string; operationId: string; spec: GroupSpec }
export type DemoSubteam = { id: string; key: string; name: string; teamId: string; teamKey: string }

export type DemoPerson = {
  id: string
  key: string
  role: DemoRole
  name: string
  gender: Gender
  jobTitle: string
  matricula: string
  email: string
  teamKey: string | null
  subteamKey: string | null
  reportsToKey: string | null
  hiredAt: string
  /** Só operadores. */
  persona: Persona | null
  /** Operador admitido dentro da janela de 6 meses — sem histórico antes da admissão. */
  lateHire: boolean
  /** Operador afastado na última competência — sem fechamento nem chamadas em setembro. */
  absentLastPeriod: boolean
  /** Índice sequencial dentro do papel (1-based) — base de e-mail/matrícula. */
  ordinal: number
  /**
   * Pessoa que JÁ EXISTIA no banco antes da massa (cadeia legada das migrations — ver
   * legacy-adoption.ts): `id` é o dela, identidade/conta/dados próprios são preservados; a massa
   * só a posiciona na estrutura e completa o histórico onde não há dado.
   */
  adopted?: AdoptedIdentity
}

export type AdoptedIdentity = {
  /** `external_code` do Grupo legado — pra devolver a pessoa a ele no reset. */
  legacyTeamExternalCode: string | null
  /** E-mail da conta existente (null = não tinha login; a massa cria um `.demo`). */
  accountEmail: string | null
  /** A pessoa já tinha `hired_at` no banco — a massa não sobrescreve. */
  hasHiredAt: boolean
  /**
   * Operador legado com gravações REPOSICIONADO no Subgrupo de diagnóstico (legacy-adoption.ts,
   * `DIAGNOSTIC_LEGACY_OPERATORS`): aqui fica a vaga de origem (Grupo/Subgrupo/supervisor legado) e o
   * cargo que a própria massa teria escrito para ela — só um `job_title` igual a ESSE é trocado pelo
   * do Grupo novo; cargo digitado por alguém fica.
   */
  relocatedFrom?: { teamKey: string; subteamKey: string | null; reportsToKey: string; seedJobTitle: string }
}

export type DemoStructure = {
  operations: DemoOperation[]
  teams: DemoTeam[]
  subteams: DemoSubteam[]
  people: DemoPerson[]
  byKey: Map<string, DemoPerson>
  teamByKey: Map<string, DemoTeam>
  subteamByKey: Map<string, DemoSubteam>
}

/** Grupo de cada Gerente (1..16), na ordem: SM1 = mgr 1–4, SM2 = 5–8 (B2C); SM3 = 9–12, SM4 = 13–16 (B2B). */
const MANAGER_GROUP_KEYS = [
  "b2c-atendimento-geral", "b2c-atendimento-geral", "b2c-faturamento", "b2c-faturamento",
  "b2c-retencao", "b2c-suporte-tecnico", "b2c-suporte-tecnico", "b2c-digital",
  "b2b-atendimento-pme", "b2b-atendimento-pme", "b2b-grandes-contas", "b2b-faturamento-empresarial",
  "b2b-faturamento-empresarial", "b2b-suporte-empresarial", "b2b-suporte-empresarial", "b2b-retencao",
] as const

/** Supervisor cuja equipe tem operadores de DOIS Grupos (legítimo no modelo: `team_id` é por pessoa). */
const MIXED_GROUP_SUPERVISOR = { supervisorOrdinal: 40, secondaryGroupKey: "b2c-atendimento-geral", secondarySubgroup: "WhatsApp", operators: 5 }

/**
 * SUBGRUPO DEMO DE DIAGNÓSTICO (Tools de investigação, 2026-09-17): a equipe canônica do
 * Supervisor 01 (25 operadores com personas conhecidas, todos com 10 interações + transcrição)
 * fica concentrada num Subgrupo próprio do MESMO Grupo — massa de teste para comparação entre
 * operadores, com o Subgrupo e com o Grupo, mesmo assunto, flags e indicadores operacionais.
 * Só demo/dev: nada muda na regra estrutural (Grupo, gestor, cargo, situação funcional
 * preservados; o quartil oficial é coorte por Grupo, então o fechamento não muda). O Subgrupo
 * fica FORA de `spec.subgroups` de propósito: não altera o sorteio de subgrupo dos demais
 * operadores (determinismo da massa).
 */
export const DIAGNOSTIC_SUBGROUP = { teamKey: "b2c-atendimento-geral", name: "Diagnóstico IA — Operadores com gravações", supervisorOrdinal: 1 } as const

/**
 * Competência a partir da qual os operadores legados com gravações (legacy-adoption.ts,
 * `DIAGNOSTIC_LEGACY_OPERATORS`) pertencem ao Subgrupo de diagnóstico. É uma DATA DE TRANSFERÊNCIA
 * fixa — não a data em que o seed roda: tudo que é anterior (fechamento oficial, medição diária,
 * chamada gerada) continua sendo produzido para a vaga de origem, porque um snapshot histórico
 * nunca é reprocessado pela estrutura atual (`placementAt`).
 */
export const DIAGNOSTIC_RELOCATION_EFFECTIVE_PERIOD = "2026-09"

export type Placement = { teamKey: string | null; subteamKey: string | null }

/**
 * Posição (Grupo/Subgrupo) da pessoa VIGENTE numa competência ("AAAA-MM") ou dia ("AAAA-MM-DD").
 * ESTRUTURA ATUAL ≠ SNAPSHOT HISTÓRICO: quem foi reposicionado (`adopted.relocatedFrom`) tem a vaga
 * de origem como posição de tudo que é anterior à transferência; todo o resto usa a posição atual.
 * Geradores de fechamento oficial, diária e chamada passam por aqui — nunca por `person.teamKey`
 * direto quando há data envolvida. Também define a coorte do quartil demo (Grupo × competência).
 */
export function placementAt(person: DemoPerson, when: string): Placement {
  const origin = person.adopted?.relocatedFrom
  if (origin && when.slice(0, 7) < DIAGNOSTIC_RELOCATION_EFFECTIVE_PERIOD) return { teamKey: origin.teamKey, subteamKey: origin.subteamKey }
  return { teamKey: person.teamKey, subteamKey: person.subteamKey }
}

export function managerHasCoordinator(managerOrdinal: number): boolean {
  return managerOrdinal % 2 === 1
}

export function subteamKey(teamKey: string, subgroup: string): string {
  return `${teamKey}/${subgroup}`
}

export function pad(value: number, width: number): string {
  return String(value).padStart(width, "0")
}

export function demoEmail(localPart: string): string {
  return `${localPart}.demo@${DEMO_EMAIL_DOMAIN}`
}

export function titled(gender: Gender, masculine: string, feminine: string): string {
  return gender === "F" ? feminine : masculine
}

export function isoDate(random: Random, fromYear: number, toYear: number): string {
  const year = random.int(fromYear, toYear)
  const month = random.int(1, 12)
  const day = random.int(1, 28)
  return `${year}-${pad(month, 2)}-${pad(day, 2)}`
}

export function generateStructure(random: Random): DemoStructure {
  const ids = new DemoIdRegistry()
  const names = new NameGenerator(random.fork("names"))
  const dates = random.fork("hired")
  const decks = random.fork("personas")
  const teamMix = random.fork("subgroups")

  const operations: DemoOperation[] = [
    { id: EXISTING_B2B_OPERATION_ID, key: "b2b", name: "Atendimento B2B", existing: true },
    { id: ids.claim("operation:b2c"), key: "b2c", name: "Atendimento B2C", existing: false },
  ]
  const teams: DemoTeam[] = DEMO_GROUPS.map((spec) => ({
    id: ids.claim(`team:${spec.key}`),
    key: spec.key,
    name: spec.name,
    operationId: spec.segment === "B2B" ? operations[0]!.id : operations[1]!.id,
    spec,
  }))
  const teamByKey = new Map(teams.map((team) => [team.key, team]))
  const subteams: DemoSubteam[] = teams.flatMap((team) =>
    team.spec.subgroups.map((subgroup) => ({
      id: ids.claim(`subteam:${subteamKey(team.key, subgroup)}`),
      key: subteamKey(team.key, subgroup),
      name: subgroup,
      teamId: team.id,
      teamKey: team.key,
    })),
  )
  const diagnosticTeam = teamByKey.get(DIAGNOSTIC_SUBGROUP.teamKey)!
  subteams.push({
    id: ids.claim(`subteam:${subteamKey(diagnosticTeam.key, DIAGNOSTIC_SUBGROUP.name)}`),
    key: subteamKey(diagnosticTeam.key, DIAGNOSTIC_SUBGROUP.name),
    name: DIAGNOSTIC_SUBGROUP.name,
    teamId: diagnosticTeam.id,
    teamKey: diagnosticTeam.key,
  })
  const subteamByKey = new Map(subteams.map((subteam) => [subteam.key, subteam]))

  const people: DemoPerson[] = []
  const reservedCanonical = new Map(CANONICAL_OPERATORS.map((canonical) => [canonical.operatorOrdinal, canonical]))
  for (const canonical of CANONICAL_OPERATORS) names.reserve(canonical.name, canonical.gender)

  const addPerson = (person: Omit<DemoPerson, "id">): DemoPerson => {
    const full = { ...person, id: ids.claim(`person:${person.key}`) }
    people.push(full)
    return full
  }

  const directorName = names.next()
  const director = addPerson({
    key: "director:01", role: "DIRECTOR", name: directorName.fullName, gender: directorName.gender,
    jobTitle: titled(directorName.gender, "Diretor de Operações", "Diretora de Operações"),
    matricula: `${DEMO_EXTERNAL_PREFIX}-DIR-001`, email: demoEmail("diretor"), teamKey: null, subteamKey: null, reportsToKey: null,
    hiredAt: isoDate(dates, 2012, 2018), persona: null, lateHire: false, absentLastPeriod: false, ordinal: 1,
  })

  let managerOrdinal = 0
  let coordinatorOrdinal = 0
  let supervisorOrdinal = 0
  let operatorOrdinal = 0

  for (let seniorIndex = 1; seniorIndex <= DEMO_STRUCTURE.seniorManagersPerDirector; seniorIndex += 1) {
    const segment = seniorIndex <= 2 ? "B2C" : "B2B"
    const seniorName = names.next()
    const senior = addPerson({
      key: `senior-manager:${pad(seniorIndex, 2)}`, role: "SENIOR_MANAGER", name: seniorName.fullName, gender: seniorName.gender,
      jobTitle: `Gerente Sênior — ${segment}`, matricula: `${DEMO_EXTERNAL_PREFIX}-GS-${pad(seniorIndex, 3)}`,
      email: demoEmail(`gerentesenior${pad(seniorIndex, 2)}`), teamKey: null, subteamKey: null, reportsToKey: director.key,
      hiredAt: isoDate(dates, 2014, 2020), persona: null, lateHire: false, absentLastPeriod: false, ordinal: seniorIndex,
    })

    for (let managerIndex = 1; managerIndex <= DEMO_STRUCTURE.managersPerSeniorManager; managerIndex += 1) {
      managerOrdinal += 1
      const team = teamByKey.get(MANAGER_GROUP_KEYS[managerOrdinal - 1]!)!
      const managerName = names.next()
      const manager = addPerson({
        key: `manager:${pad(managerOrdinal, 2)}`, role: "MANAGER", name: managerName.fullName, gender: managerName.gender,
        jobTitle: `Gerente — ${team.name}`, matricula: `${DEMO_EXTERNAL_PREFIX}-GER-${pad(managerOrdinal, 3)}`,
        email: demoEmail(`gerente${pad(managerOrdinal, 2)}`), teamKey: team.key, subteamKey: null, reportsToKey: senior.key,
        hiredAt: isoDate(dates, 2015, 2022), persona: null, lateHire: false, absentLastPeriod: false, ordinal: managerOrdinal,
      })

      let supervisorsReportTo = manager.key
      if (managerHasCoordinator(managerOrdinal)) {
        coordinatorOrdinal += 1
        const coordinatorName = names.next()
        const coordinator = addPerson({
          key: `coordinator:${pad(coordinatorOrdinal, 2)}`, role: "COORDINATOR", name: coordinatorName.fullName, gender: coordinatorName.gender,
          jobTitle: titled(coordinatorName.gender, `Coordenador — ${team.name}`, `Coordenadora — ${team.name}`),
          matricula: `${DEMO_EXTERNAL_PREFIX}-COORD-${pad(coordinatorOrdinal, 3)}`, email: demoEmail(`coordenador${pad(coordinatorOrdinal, 2)}`),
          teamKey: team.key, subteamKey: null, reportsToKey: manager.key,
          hiredAt: isoDate(dates, 2016, 2023), persona: null, lateHire: false, absentLastPeriod: false, ordinal: coordinatorOrdinal,
        })
        supervisorsReportTo = coordinator.key
      }

      for (let supervisorIndex = 1; supervisorIndex <= DEMO_STRUCTURE.supervisorsPerManager; supervisorIndex += 1) {
        supervisorOrdinal += 1
        const supervisorName = names.next()
        const design = teamDesign(team.spec, supervisorIndex)
        const diagnosticTeamHere = supervisorOrdinal === DIAGNOSTIC_SUBGROUP.supervisorOrdinal && team.key === DIAGNOSTIC_SUBGROUP.teamKey
        const supervisor = addPerson({
          key: `supervisor:${pad(supervisorOrdinal, 2)}`, role: "SUPERVISOR", name: supervisorName.fullName, gender: supervisorName.gender,
          jobTitle: titled(supervisorName.gender, `Supervisor — ${team.name}`, `Supervisora — ${team.name}`),
          matricula: `${DEMO_EXTERNAL_PREFIX}-SUP-${pad(supervisorOrdinal, 3)}`, email: demoEmail(`supervisor${pad(supervisorOrdinal, 2)}`),
          teamKey: team.key, subteamKey: diagnosticTeamHere ? subteamKey(team.key, DIAGNOSTIC_SUBGROUP.name) : design.primary ? subteamKey(team.key, design.primary) : null, reportsToKey: supervisorsReportTo,
          hiredAt: isoDate(dates, 2017, 2024), persona: null, lateHire: false, absentLastPeriod: false, ordinal: supervisorOrdinal,
        })

        const deck = decks.shuffle(PERSONA_DECK)
        const isCanonicalTeam = supervisorOrdinal === 1
        for (let operatorIndex = 1; operatorIndex <= DEMO_STRUCTURE.operatorsPerSupervisor; operatorIndex += 1) {
          operatorOrdinal += 1
          const canonical = reservedCanonical.get(operatorOrdinal)
          const operatorName = canonical ? { fullName: canonical.name, gender: canonical.gender } : names.next()
          const mixedGroup = supervisorOrdinal === MIXED_GROUP_SUPERVISOR.supervisorOrdinal && operatorIndex > DEMO_STRUCTURE.operatorsPerSupervisor - MIXED_GROUP_SUPERVISOR.operators
          const operatorTeam = mixedGroup ? teamByKey.get(MIXED_GROUP_SUPERVISOR.secondaryGroupKey)! : team
          // O sorteio roda SEMPRE (determinismo dos demais); a equipe de diagnóstico sobrescreve o resultado.
          const drawnSubgroup = mixedGroup ? MIXED_GROUP_SUPERVISOR.secondarySubgroup : pickOperatorSubgroup(teamMix, design, team.spec)
          const subgroup = diagnosticTeamHere ? DIAGNOSTIC_SUBGROUP.name : drawnSubgroup
          const lateHire = !isCanonicalTeam && !canonical && teamMix.chance(0.04)
          const absentLastPeriod = !isCanonicalTeam && !canonical && !lateHire && teamMix.chance(0.005)
          addPerson({
            key: `operator:${pad(operatorOrdinal, 4)}`, role: "OPERATOR", name: operatorName.fullName, gender: operatorName.gender,
            jobTitle: titled(operatorName.gender, `Operador de Atendimento — ${operatorTeam.name}`, `Operadora de Atendimento — ${operatorTeam.name}`),
            matricula: `${DEMO_EXTERNAL_PREFIX}-OP-${pad(operatorOrdinal, 4)}`, email: demoEmail(`operador${pad(operatorOrdinal, 4)}`),
            teamKey: operatorTeam.key, subteamKey: subgroup ? subteamKey(operatorTeam.key, subgroup) : null, reportsToKey: supervisor.key,
            hiredAt: lateHire ? lateHireDate(dates) : isoDate(dates, 2018, 2025),
            persona: canonical?.persona ?? (lateHire ? "MEDIA" : deck[operatorIndex - 1]!),
            lateHire, absentLastPeriod, ordinal: operatorOrdinal,
          })
        }
      }
    }
  }

  const byKey = new Map(people.map((person) => [person.key, person]))
  return { operations, teams, subteams, people, byKey, teamByKey, subteamByKey }
}

export type TeamDesign = { primary: string | null; secondary: string | null; noSubgroupShare: number }

/**
 * Desenho da equipe de cada Supervisor dentro do Grupo (índice 1..5 dentro do Gerente):
 *   1, 2, 5 → um único Subgrupo;  3 → dois Subgrupos misturados;  4 → um Subgrupo com ~20% da
 *   equipe ainda sem Subgrupo. Grupos sem Subgrupo (Retenção B2B) → todos `subteam_id` nulo.
 */
export function teamDesign(spec: GroupSpec, supervisorIndex: number): TeamDesign {
  const subgroups = spec.subgroups
  if (subgroups.length === 0) return { primary: null, secondary: null, noSubgroupShare: 1 }
  const primary = subgroups[(supervisorIndex - 1) % subgroups.length]!
  const secondary = supervisorIndex === 3 && subgroups.length > 1 ? subgroups[supervisorIndex % subgroups.length]! : null
  return { primary, secondary, noSubgroupShare: supervisorIndex === 4 ? 0.2 : 0.04 }
}

export function pickOperatorSubgroup(random: Random, design: TeamDesign, spec: GroupSpec): string | null {
  if (spec.subgroups.length === 0 || random.chance(design.noSubgroupShare)) return null
  if (design.secondary && random.chance(0.4)) return design.secondary
  return design.primary
}

function lateHireDate(random: Random): string {
  const month = random.int(5, 7)
  return `2026-${pad(month, 2)}-${pad(random.int(1, 15), 2)}`
}

/** Competência ("AAAA-MM") a partir da qual um operador tem fechamento oficial: mês seguinte à admissão. */
export function firstPerformancePeriod(person: DemoPerson): string {
  const [year, month] = person.hiredAt.split("-").map(Number) as [number, number, number]
  const next = new Date(Date.UTC(year, month, 1))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1, 2)}`
}

