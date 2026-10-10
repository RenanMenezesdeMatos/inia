import { describe, expect, it } from "vitest"
import { buildDemoMass, stubIndicatorDefinitions } from "./build-demo-mass.js"
import { DEMO_STRUCTURE } from "./demo-constants.js"
import { DIAGNOSTIC_LEGACY_OPERATORS, LEGACY_MANAGERS, LEGACY_TEAM_BY_GROUP, legacyPersonNames, type LegacyPeople, type LegacyPersonRow } from "./legacy-adoption.js"
import { DIAGNOSTIC_RELOCATION_EFFECTIVE_PERIOD, DIAGNOSTIC_SUBGROUP, placementAt, subteamKey, type DemoPerson } from "./structure-generator.js"

const DIAGNOSTIC_SUBTEAM_KEY = subteamKey(DIAGNOSTIC_SUBGROUP.teamKey, DIAGNOSTIC_SUBGROUP.name)

/** Cadeia legada como as migrations a deixam: ids aleatórios, alguns sem admissão/matrícula, Patrícia sem login. */
function fakeLegacy(overrides: Partial<Record<string, Partial<LegacyPersonRow>>> = {}): LegacyPeople {
  const roleOf = (name: string): DemoPerson["role"] => {
    for (const manager of LEGACY_MANAGERS) {
      if (manager.name === name) return "MANAGER"
      if (manager.coordinator === name) return "COORDINATOR"
      for (const supervisor of manager.supervisors) {
        if (supervisor.name === name) return "SUPERVISOR"
        if (supervisor.operators.includes(name)) return "OPERATOR"
      }
    }
    throw new Error(name)
  }
  return legacyPersonNames().map((name, index): LegacyPersonRow => ({
    id: `1111${String(index).padStart(4, "0")}-0000-4000-8000-000000000000`,
    name, role: roleOf(name), jobTitle: name === "Ana Lima" ? "Especialista de Atendimento B2B" : null, matricula: null,
    hiredAt: name === "Ana Lima" ? "2021-03-01" : null,
    accountEmail: name === "Patrícia Coordenadora" ? null : `${name.split(" ")[0]!.toLowerCase()}@inia.com`,
    // Como no banco de desenvolvimento: a própria massa já tinha escrito o cargo do Grupo legado para Luana.
    ...(name === "Luana Brenda" ? { jobTitle: "Operadora de Atendimento — B2B · Atendimento PME" } : {}),
    ...overrides[name],
  }))
}

const definitions = stubIndicatorDefinitions()
const base = buildDemoMass(definitions, 20260915, "2026-09-15")
const mass = buildDemoMass(definitions, 20260915, "2026-09-15", fakeLegacy())
// Homônimo gerado (há uma "Camila Pereira" entre os 2.000): o nome legado resolve para a pessoa ADOTADA.
const byName = (name: string) => mass.structure.people.find((person) => person.name === name && person.adopted) ?? mass.structure.people.find((person) => person.name === name)!

describe("adoção da cadeia legada na massa demo", () => {
  it("sem pessoas legadas a massa é exatamente a de sempre", () => {
    expect(base.adoption).toEqual({ adopted: [], generated: [], missing: [] })
    expect(base.structure.people).toHaveLength(1 + 4 + 16 + 8 + 80 + 2000)
  })

  it("adota as 18 pessoas (2 gerentes, 1 coordenadora, 4 supervisores, 11 operadores) com os ids do banco e gera só o que falta pra completar 5 supervisores × 25 operadores", () => {
    expect(mass.adoption.missing).toEqual([])
    expect(mass.adoption.adopted).toHaveLength(18)
    expect(mass.adoption.adopted.map((person) => person.role).filter((role) => role === "OPERATOR")).toHaveLength(11)
    expect(mass.adoption.generated.filter((person) => person.role === "SUPERVISOR")).toHaveLength(6)
    expect(mass.adoption.generated.filter((person) => person.role === "OPERATOR")).toHaveLength(2 * 5 * 25 - 11)
    expect(mass.adoption.generated.every((person) => !person.adopted && person.id.startsWith("de00"))).toBe(true)
    expect(byName("Ana Lima").id).toBe(fakeLegacy().find((row) => row.name === "Ana Lima")!.id)
  })

  it("não muda nada na massa base: as 2.109 pessoas originais mantêm id, nome, chefia e Grupo", () => {
    const original = new Map(base.structure.people.map((person) => [person.key, person]))
    for (const [key, person] of original) {
      const same = mass.structure.byKey.get(key)!
      expect([same.id, same.name, same.reportsToKey, same.teamKey, same.subteamKey, same.persona]).toEqual([person.id, person.name, person.reportsToKey, person.teamKey, person.subteamKey, person.persona])
    }
    // Ordinais/e-mails continuam a sequência — nunca colidem com os existentes.
    const emails = mass.structure.people.map((person) => person.email)
    expect(new Set(emails).size).toBe(emails.length)
    const ids = mass.structure.people.map((person) => person.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(mass.adoption.generated.filter((p) => p.role === "SUPERVISOR").map((p) => p.ordinal)).toEqual([83, 84, 85, 88, 89, 90])
    const extraOperators = [...mass.adoption.adopted, ...mass.adoption.generated].filter((p) => p.role === "OPERATOR").map((p) => p.ordinal).sort((a, b) => a - b)
    expect(extraOperators[0]).toBe(2001)
    expect(extraOperators[extraOperators.length - 1]).toBe(2250)
    // Um nome legado nunca é reproduzido pelo gerador de preenchimento.
    expect(mass.adoption.generated.some((person) => legacyPersonNames().includes(person.name))).toBe(false)
  })

  it("encaixa a cadeia no desenho da empresa: Gerente → (Coordenadora) → 5 Supervisores → 25 vagas de Operador, nos Grupos B2B equivalentes (operadores legados com gravações ocupam a vaga mas ficam no Subgrupo de diagnóstico)", () => {
    const roberto = byName("Roberto Alves")
    const roberta = byName("Roberta Gaspar")
    const senior3 = mass.structure.people.find((person) => person.role === "SENIOR_MANAGER" && person.ordinal === 3)!
    const senior4 = mass.structure.people.find((person) => person.role === "SENIOR_MANAGER" && person.ordinal === 4)!
    expect(roberto.reportsToKey).toBe(senior3.key)
    expect(roberta.reportsToKey).toBe(senior4.key)
    expect(roberto.teamKey).toBe("b2b-retencao")
    expect(roberta.teamKey).toBe("b2b-faturamento-empresarial")

    const patricia = byName("Patrícia Coordenadora")
    expect(patricia.reportsToKey).toBe(roberto.key)
    const underPatricia = mass.structure.people.filter((person) => person.reportsToKey === patricia.key)
    expect(underPatricia.map((person) => person.role)).toEqual(Array(5).fill("SUPERVISOR"))
    expect(underPatricia.map((person) => person.name)).toEqual(expect.arrayContaining(["Mariana Costa", "Vanessa Lopes"]))
    const underRoberta = mass.structure.people.filter((person) => person.reportsToKey === roberta.key)
    expect(underRoberta).toHaveLength(5)
    expect(underRoberta.map((person) => person.name)).toEqual(expect.arrayContaining(["Bruno Teixeira", "Thiago Barreto"]))

    for (const supervisor of [...underPatricia, ...underRoberta]) {
      const team = mass.structure.people.filter((person) => person.reportsToKey === supervisor.key)
      const relocatedFromHere = mass.structure.people.filter((person) => person.adopted?.relocatedFrom?.reportsToKey === supervisor.key)
      // A vaga do legado reposicionado continua consumida (ordinal/nome do gerado seguinte não mudam): 25 − n na equipe.
      expect(team.length + relocatedFromHere.length).toBe(DEMO_STRUCTURE.operatorsPerSupervisor)
      expect(team.every((person) => person.role === "OPERATOR" && person.teamKey === supervisor.teamKey && person.persona !== null)).toBe(true)
      for (const person of team) if (person.subteamKey) expect(mass.structure.subteamByKey.get(person.subteamKey)!.teamKey).toBe(person.teamKey)
    }
    expect(byName("Vanessa Lopes").teamKey).toBe("b2b-atendimento-pme")
    expect(byName("Thiago Barreto").teamKey).toBe("b2b-suporte-empresarial")
  })

  it("operadores legados com gravações (DIAGNOSTIC_LEGACY_OPERATORS) ficam no Subgrupo de diagnóstico, sob a Supervisora 01, sem nova pessoa e sem novo supervisor", () => {
    const legacyOperators = LEGACY_MANAGERS.flatMap((manager) => manager.supervisors.flatMap((supervisor) => supervisor.operators))
    expect([...DIAGNOSTIC_LEGACY_OPERATORS].sort()).toEqual([...legacyOperators].sort())
    const supervisor01 = mass.structure.byKey.get("supervisor:01")!
    const team = mass.structure.people.filter((person) => person.reportsToKey === "supervisor:01")
    expect(team).toHaveLength(25 + DIAGNOSTIC_LEGACY_OPERATORS.length)
    for (const name of DIAGNOSTIC_LEGACY_OPERATORS) {
      const person = byName(name)
      expect(person.adopted?.relocatedFrom).toBeDefined()
      expect(person.teamKey).toBe(DIAGNOSTIC_SUBGROUP.teamKey)
      expect(person.subteamKey).toBe(DIAGNOSTIC_SUBTEAM_KEY)
      expect(person.reportsToKey).toBe(supervisor01.key)
      expect(person.persona).not.toBeNull()
      expect(person.matricula).toMatch(/^DEMO-LEG-\d{4}$/)
      // A vaga de origem é a do supervisor legado, no Grupo legado equivalente.
      const origin = person.adopted!.relocatedFrom!
      expect(mass.structure.byKey.get(origin.reportsToKey)!.role).toBe("SUPERVISOR")
      expect(person.adopted!.legacyTeamExternalCode).toBe(LEGACY_TEAM_BY_GROUP[origin.teamKey])
    }
    expect(byName("Ana Lima").adopted!.relocatedFrom!.reportsToKey).toBe(byName("Mariana Costa").key)
    expect(byName("Denisy Feitoza").adopted!.relocatedFrom!.teamKey).toBe("b2b-suporte-empresarial")
    // O cargo que a massa escreveria para o Grupo antigo é conhecido (pra trocar só ele no banco); o cargo digitado de Ana fica.
    expect(byName("Luana Brenda").adopted!.relocatedFrom!.seedJobTitle).toBe("Operadora de Atendimento — B2B · Atendimento PME")
    expect(byName("Luana Brenda").jobTitle).toBe("Operadora de Atendimento — B2C · Atendimento Geral")
    expect(byName("Ana Lima").jobTitle).toBe("Especialista de Atendimento B2B")
    // Supervisores legados não mudam; nenhum supervisor novo aparece na equipe canônica.
    expect(mass.structure.people.filter((person) => person.role === "SUPERVISOR")).toHaveLength(base.structure.people.filter((person) => person.role === "SUPERVISOR").length + 10)
    expect(mass.structure.people).toHaveLength(base.structure.people.length + 18 + (2 * 5 * 25 - 11) + 6)
    // Fechamentos/diárias passam a seguir o catálogo do Grupo novo (B2C · Atendimento Geral).
    const luana = byName("Luana Brenda")
    const codes = new Set(mass.performance.indicatorRows.filter((row) => row.personId === luana.id).map((row) => row.indicatorCode))
    expect([...codes].sort()).toEqual(["ADERENCIA", "MONITORIA_QUALIDADE", "NOTA_URA", "REINCIDENCIA_7D", "TMA"])
  })

  it("ESTRUTURA ATUAL ≠ SNAPSHOT: reposicionar os legados no Subgrupo de diagnóstico não muda NENHUM fechamento oficial, PRV, quartil, diária ou chamada anterior à transferência (2026-09) — de ninguém", () => {
    const before = buildDemoMass(definitions, 20260915, "2026-09-15", fakeLegacy(), [], { relocateDiagnosticOperators: false })
    expect(before.structure.people.some((person) => person.adopted?.relocatedFrom)).toBe(false)
    expect(mass.structure.people.filter((person) => person.adopted?.relocatedFrom)).toHaveLength(DIAGNOSTIC_LEGACY_OPERATORS.length)
    const serialize = (rows: { id: string }[]) => new Map(rows.map((row) => [row.id, JSON.stringify(row)]))
    // Fechamentos de indicador: mesmo conjunto de ids, mesmo conteúdo (valor, meta, atingimento, peso, QUARTIL, subteam).
    const indicatorBefore = serialize(before.performance.indicatorRows)
    const indicatorAfter = serialize(mass.performance.indicatorRows)
    expect(indicatorAfter.size).toBe(indicatorBefore.size)
    expect([...indicatorAfter].filter(([id, row]) => indicatorBefore.get(id) !== row)).toEqual([])
    const prvBefore = serialize(before.performance.prvRows)
    const prvAfter = serialize(mass.performance.prvRows)
    expect(prvAfter.size).toBe(prvBefore.size)
    expect([...prvAfter].filter(([id, row]) => prvBefore.get(id) !== row)).toEqual([])
    // Todas as competências fechadas desta referência são anteriores à transferência: a posição vigente é a vaga de origem.
    expect(mass.closedPeriods.every((period) => period < DIAGNOSTIC_RELOCATION_EFFECTIVE_PERIOD)).toBe(true)
    const luana = byName("Luana Brenda")
    expect(placementAt(luana, "2026-08")).toEqual({ teamKey: "b2b-atendimento-pme", subteamKey: luana.adopted!.relocatedFrom!.subteamKey })
    expect(placementAt(luana, "2026-08-31")).toEqual(placementAt(luana, "2026-08"))
    expect(placementAt(luana, "2026-09-01")).toEqual({ teamKey: DIAGNOSTIC_SUBGROUP.teamKey, subteamKey: DIAGNOSTIC_SUBTEAM_KEY })
    expect(placementAt(luana, "2026-09")).toEqual({ teamKey: DIAGNOSTIC_SUBGROUP.teamKey, subteamKey: DIAGNOSTIC_SUBTEAM_KEY })
    expect(placementAt(byName("Larissa Monteiro"), "2026-04")).toEqual({ teamKey: byName("Larissa Monteiro").teamKey, subteamKey: byName("Larissa Monteiro").subteamKey })
    // Ana Lima (Retenção B2B de origem) continua com o catálogo de Retenção B2B em todos os meses fechados.
    const ana = byName("Ana Lima")
    const codes = new Set(mass.performance.indicatorRows.filter((row) => row.personId === ana.id).map((row) => row.indicatorCode))
    expect([...codes].sort()).toEqual(["MONITORIA_QUALIDADE", "NOTA_URA", "RECONTATO_CANCELAMENTO", "TAXA_RETENCAO", "TMA"])
    // Diárias e chamadas geradas: idênticas antes de setembro; em setembro seguem o Grupo novo (catálogo de Atendimento Geral, cenário B2C).
    for (const name of ["Ana Lima", "Luana Brenda", "Camila Pereira"]) {
      const after = byName(name)
      const previous = before.structure.people.find((person) => person.name === name && person.adopted)!
      const dailyBefore = new Map(before.dailyMeasurementsOf(previous).map((row) => [row.id, JSON.stringify(row)]))
      const dailyAfter = mass.dailyMeasurementsOf(after)
      expect(dailyAfter.filter((row) => row.day < "2026-09-01").every((row) => dailyBefore.get(row.id) === JSON.stringify(row))).toBe(true)
      expect(dailyAfter.filter((row) => row.day < "2026-09-01")).toHaveLength([...dailyBefore.values()].filter((row) => (JSON.parse(row) as { day: string }).day < "2026-09-01").length)
      const callsBefore = new Map(before.interactionsOf(previous).map((row) => [row.id, row.transcript.content]))
      for (const call of mass.interactionsOf(after)) if (call.startedAt < "2026-09") expect(callsBefore.get(call.id)).toBe(call.transcript.content)
    }
    // Setembro (mês corrente, só operacional) já é do Grupo novo: Ana ganha diárias de REINCIDENCIA_7D só onde há âncora — nunca inventada.
    const anaSeptember = mass.dailyMeasurementsOf(ana).filter((row) => row.day >= "2026-09-01")
    expect(anaSeptember.every((row) => ["ATENDIMENTOS", "MONITORIA_QUALIDADE", "NOTA_URA", "TMA"].includes(row.indicatorCode))).toBe(true)
    expect(anaSeptember.length).toBeGreaterThan(0)
  })

  it("preserva a identidade existente e só completa o que era nulo (admissão, matrícula, cargo, login)", () => {
    const ana = byName("Ana Lima")
    expect(ana.adopted).toEqual({
      legacyTeamExternalCode: "RETENCAO_FIDELIZACAO", accountEmail: "ana@inia.com", hasHiredAt: true,
      relocatedFrom: { teamKey: "b2b-retencao", subteamKey: null, reportsToKey: byName("Mariana Costa").key, seedJobTitle: "Operadora de Atendimento — B2B · Retenção B2B" },
    })
    expect(ana.hiredAt).toBe("2021-03-01")
    expect(ana.jobTitle).toBe("Especialista de Atendimento B2B")
    expect(ana.email).toBe("ana@inia.com")
    const luzia = byName("Luzia Ingrid da Silva Nobre")
    expect(luzia.adopted?.hasHiredAt).toBe(false)
    expect(luzia.hiredAt < "2026-01-01").toBe(true)
    expect(luzia.matricula).toMatch(/^DEMO-LEG-\d{4}$/)
    const patricia = byName("Patrícia Coordenadora")
    expect(patricia.email).toMatch(/^coordenador\d{2}\.demo@inia\.local$/)
    expect(patricia.adopted?.accountEmail).toBeNull()
    expect(Object.values(LEGACY_TEAM_BY_GROUP).sort()).toEqual(["ATENDIMENTO_GERAL", "FATURAS", "RETENCAO_FIDELIZACAO", "SUPORTE_TECNICO"])
  })

  it("adotados recebem a mesma massa dos gerados: 6 competências, diárias e 10 chamadas, com ids determinísticos", () => {
    const ana = byName("Ana Lima")
    const periods = mass.performance.indicatorRows.filter((row) => row.personId === ana.id).map((row) => row.referencePeriod)
    expect(new Set(periods).size).toBe(6)
    expect(mass.performance.prvRows.filter((row) => row.personId === ana.id)).toHaveLength(6)
    expect(mass.interactionsOf(ana)).toHaveLength(DEMO_STRUCTURE.interactionsPerOperator)
    expect(mass.dailyMeasurementsOf(ana).length).toBeGreaterThan(100)
    const again = buildDemoMass(definitions, 20260915, "2026-09-15", fakeLegacy())
    expect(again.interactionsOf(again.structure.people.find((p) => p.name === "Ana Lima")!).map((row) => row.id)).toEqual(mass.interactionsOf(ana).map((row) => row.id))
  })

  it("pessoa legada ausente ou com papel diferente não é inventada: entra no relatório e a equipe é completada com gerados", () => {
    const legacy = fakeLegacy({ "Bruno Teixeira": { role: "OPERATOR" } }).filter((row) => row.name !== "Luzia Ingrid da Silva Nobre")
    // Homônima gerada pela própria massa base (operator:1262 chama-se Camila Pereira): nunca é confundida com a legada.
    const homonym = base.structure.people.find((person) => person.name === "Camila Pereira")!
    const partial = buildDemoMass(definitions, 20260915, "2026-09-15", [...legacy, { ...legacy.find((row) => row.name === "Camila Pereira")!, id: homonym.id }])
    expect(partial.adoption.missing).toEqual(["Luzia Ingrid da Silva Nobre (OPERATOR)", "Bruno Teixeira (SUPERVISOR)"])
    const mariana = partial.structure.people.find((person) => person.name === "Mariana Costa")!
    // 25 vagas: Luzia ausente → gerada na vaga (fica com Mariana); Ana adotada → Subgrupo de diagnóstico (vaga consumida).
    expect(partial.structure.people.filter((person) => person.reportsToKey === mariana.key)).toHaveLength(24)
    // Sem o supervisor legado, um supervisor GERADO ocupa a vaga e os operadores legados dele entram ali.
    const camila = partial.adoption.adopted.find((person) => person.name === "Camila Pereira")!
    const generatedBoss = partial.structure.byKey.get(camila.reportsToKey!)!
    expect(generatedBoss.adopted).toBeUndefined()
    expect(generatedBoss.role).toBe("SUPERVISOR")
    expect(partial.structure.byKey.get(homonym.key)!.adopted).toBeUndefined()
    expect(partial.structure.people.filter((person) => person.reportsToKey === partial.structure.people.find((p) => p.name === "Roberta Gaspar")!.key)).toHaveLength(5)
    // Gerente legado ausente → Gerente gerado no lugar; a cadeia abaixo continua adotada.
    const withoutRoberta = buildDemoMass(definitions, 20260915, "2026-09-15", fakeLegacy().filter((row) => row.name !== "Roberta Gaspar"))
    const bruno = withoutRoberta.structure.people.find((person) => person.name === "Bruno Teixeira")!
    const generatedManager = withoutRoberta.structure.byKey.get(bruno.reportsToKey!)!
    expect([generatedManager.role, generatedManager.adopted, generatedManager.ordinal]).toEqual(["MANAGER", undefined, 18])
    expect(withoutRoberta.adoption.missing).toEqual(["Roberta Gaspar (MANAGER)"])
    // Vagas fixas: quem é gerado tem o MESMO ordinal/id/nome independentemente de quais legados existem.
    const generatedIn = (candidate: typeof mass) => new Map(candidate.adoption.generated.map((person) => [person.ordinal + person.role, [person.id, person.name]]))
    const full = generatedIn(mass)
    for (const [slot, identity] of generatedIn(withoutRoberta)) if (full.has(slot)) expect(identity).toEqual(full.get(slot))
    for (const [slot, identity] of generatedIn(partial)) if (full.has(slot)) expect(identity).toEqual(full.get(slot))
    expect(partial.adoption.generated.some((person) => person.ordinal === 2002 && person.role === "OPERATOR")).toBe(true)
    // Dois legados com o mesmo nome e papel = ambíguo, não adotado.
    const duplicated = buildDemoMass(definitions, 20260915, "2026-09-15", [...fakeLegacy(), { ...fakeLegacy().find((row) => row.name === "Ana Lima")!, id: "22220000-0000-4000-8000-000000000000" }])
    expect(duplicated.adoption.missing).toEqual(["Ana Lima (OPERATOR, ambíguo)"])
  })
})
