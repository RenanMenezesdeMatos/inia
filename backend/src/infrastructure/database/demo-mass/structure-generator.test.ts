import { describe, expect, it } from "vitest"
import { DEMO_EMAIL_DOMAIN, DEMO_RANDOM_SEED, DEMO_STRUCTURE } from "./demo-constants.js"
import { CANONICAL_OPERATORS } from "./demo-identities.js"
import { createRandom } from "./random.js"
import { DIAGNOSTIC_SUBGROUP, generateStructure, managerHasCoordinator, type DemoPerson } from "./structure-generator.js"

const structure = generateStructure(createRandom(DEMO_RANDOM_SEED).fork("structure"))
const byRole = (role: DemoPerson["role"]) => structure.people.filter((person) => person.role === role)
const childrenOf = (key: string) => structure.people.filter((person) => person.reportsToKey === key)

describe("estrutura demo — contagens e hierarquia", () => {
  it("tem 1 diretor, 4 gerentes sêniores, 16 gerentes, 8 coordenadores, 80 supervisores e 2.000 operadores", () => {
    expect(byRole("DIRECTOR")).toHaveLength(1)
    expect(byRole("SENIOR_MANAGER")).toHaveLength(4)
    expect(byRole("MANAGER")).toHaveLength(16)
    expect(byRole("COORDINATOR")).toHaveLength(8)
    expect(byRole("SUPERVISOR")).toHaveLength(80)
    expect(byRole("OPERATOR")).toHaveLength(2000)
    expect(structure.people).toHaveLength(2109)
  })

  it("Diretor → 4 Gerentes Sêniores → 4 Gerentes cada", () => {
    const [director] = byRole("DIRECTOR")
    const seniors = childrenOf(director!.key)
    expect(seniors.map((person) => person.role)).toEqual(Array(4).fill("SENIOR_MANAGER"))
    for (const senior of seniors) {
      const managers = childrenOf(senior.key)
      expect(managers).toHaveLength(4)
      expect(managers.every((person) => person.role === "MANAGER")).toBe(true)
    }
  })

  it("8 gerentes têm exatamente 1 coordenador com 5 supervisores; 8 têm 5 supervisores diretos e nenhum coordenador", () => {
    let withCoordinator = 0
    let without = 0
    for (const manager of byRole("MANAGER")) {
      const children = childrenOf(manager.key)
      if (managerHasCoordinator(manager.ordinal)) {
        withCoordinator += 1
        expect(children.map((person) => person.role)).toEqual(["COORDINATOR"])
        const supervisors = childrenOf(children[0]!.key)
        expect(supervisors).toHaveLength(5)
        expect(supervisors.every((person) => person.role === "SUPERVISOR")).toBe(true)
      } else {
        without += 1
        expect(children).toHaveLength(5)
        expect(children.every((person) => person.role === "SUPERVISOR")).toBe(true)
      }
    }
    expect(withCoordinator).toBe(8)
    expect(without).toBe(8)
  })

  it("todo supervisor tem exatamente 25 operadores diretos; coordenador tem 125 na subárvore", () => {
    for (const supervisor of byRole("SUPERVISOR")) {
      const team = childrenOf(supervisor.key)
      expect(team).toHaveLength(DEMO_STRUCTURE.operatorsPerSupervisor)
      expect(team.every((person) => person.role === "OPERATOR")).toBe(true)
    }
    for (const coordinator of byRole("COORDINATOR")) {
      const supervisors = childrenOf(coordinator.key)
      const operators = supervisors.flatMap((supervisor) => childrenOf(supervisor.key))
      expect(operators).toHaveLength(125)
    }
  })

  it("nomes, e-mails e matrículas são únicos; e-mails seguem o padrão determinístico", () => {
    expect(new Set(structure.people.map((person) => person.name)).size).toBe(structure.people.length)
    expect(new Set(structure.people.map((person) => person.email)).size).toBe(structure.people.length)
    expect(new Set(structure.people.map((person) => person.matricula)).size).toBe(structure.people.length)
    expect(structure.byKey.get("director:01")!.email).toBe(`diretor.demo@${DEMO_EMAIL_DOMAIN}`)
    expect(structure.byKey.get("manager:01")!.email).toBe(`gerente01.demo@${DEMO_EMAIL_DOMAIN}`)
    expect(structure.byKey.get("operator:0001")!.email).toBe(`operador0001.demo@${DEMO_EMAIL_DOMAIN}`)
    expect(structure.people.every((person) => !/operador \d+/i.test(person.name))).toBe(true)
  })

  it("divide B2C e B2B em 10 grupos, 19 subgrupos, com um grupo sem subgrupo e operadores sem subgrupo", () => {
    expect(structure.teams).toHaveLength(10)
    expect(structure.teams.filter((team) => team.spec.segment === "B2C")).toHaveLength(5)
    expect(structure.teams.filter((team) => team.spec.segment === "B2B")).toHaveLength(5)
    expect(structure.subteams).toHaveLength(20) // 19 do desenho + "Diagnóstico IA — Operadores com gravações"
    const operators = byRole("OPERATOR")
    const withoutSubteam = operators.filter((person) => person.subteamKey === null)
    expect(withoutSubteam.length).toBeGreaterThan(100)
    expect(operators.filter((person) => person.teamKey === "b2b-retencao").every((person) => person.subteamKey === null)).toBe(true)
  })

  it("há supervisor com um subgrupo, com mais de um subgrupo e com operadores de mais de um grupo", () => {
    const shapes = byRole("SUPERVISOR").map((supervisor) => {
      const team = childrenOf(supervisor.key)
      return { subteams: new Set(team.map((person) => person.subteamKey).filter(Boolean)).size, teams: new Set(team.map((person) => person.teamKey)).size }
    })
    expect(shapes.some((shape) => shape.subteams === 1)).toBe(true)
    expect(shapes.some((shape) => shape.subteams >= 2)).toBe(true)
    expect(shapes.filter((shape) => shape.teams > 1)).toHaveLength(1)
  })

  it("Subgrupo demo de diagnóstico: os 25 operadores do Supervisor 01 (e o próprio) ficam em 'Diagnóstico IA — Operadores com gravações', no mesmo Grupo, com o mesmo gestor; os demais operadores não mudam", () => {
    const supervisor = structure.byKey.get("supervisor:01")!
    const team = childrenOf("supervisor:01")
    const subteamKey = `${DIAGNOSTIC_SUBGROUP.teamKey}/${DIAGNOSTIC_SUBGROUP.name}`
    expect(team).toHaveLength(25)
    expect(team.every((person) => person.subteamKey === subteamKey && person.teamKey === DIAGNOSTIC_SUBGROUP.teamKey && person.reportsToKey === "supervisor:01")).toBe(true)
    expect(supervisor.subteamKey).toBe(subteamKey)
    expect(structure.subteamByKey.get(subteamKey)?.name).toBe(DIAGNOSTIC_SUBGROUP.name)
    expect(byRole("OPERATOR").filter((person) => person.subteamKey === subteamKey)).toHaveLength(25)
    // Determinismo dos demais: o operador 26 (Supervisor 02) continua em Chat/Voz/WhatsApp, nunca no Subgrupo de diagnóstico.
    expect(structure.byKey.get("operator:0026")!.subteamKey).not.toBe(subteamKey)
  })

  it("operadores canônicos ficam na equipe do supervisor 01 com a persona documentada", () => {
    for (const canonical of CANONICAL_OPERATORS.filter((candidate) => candidate.operatorOrdinal <= 10)) {
      const person = structure.byKey.get(`operator:${String(canonical.operatorOrdinal).padStart(4, "0")}`)!
      expect(person.name).toBe(canonical.name)
      expect(person.persona).toBe(canonical.persona)
      expect(person.reportsToKey).toBe("supervisor:01")
      expect(person.lateHire).toBe(false)
    }
    expect(structure.byKey.get("supervisor:01")!.reportsToKey).toBe("coordinator:01")
    expect(structure.byKey.get("coordinator:01")!.reportsToKey).toBe("manager:01")
  })

  it("é reproduzível: gerar de novo produz exatamente os mesmos ids e nomes", () => {
    const again = generateStructure(createRandom(DEMO_RANDOM_SEED).fork("structure"))
    expect(again.people.map((person) => [person.id, person.name, person.reportsToKey])).toEqual(structure.people.map((person) => [person.id, person.name, person.reportsToKey]))
  })
})
