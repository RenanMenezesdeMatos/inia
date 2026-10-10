import { describe, expect, it } from "vitest"
import { applyCalendarFilters, CALENDAR_SCHEDULE_NONE, type TeamCalendarPerson } from "./team-calendar.js"

const summary = (patch: Partial<TeamCalendarPerson["summary"]> = {}): TeamCalendarPerson["summary"] => ({ plannedWork: 5, workedObserved: 5, nonWorking: 2, missingProduction: 0, divergences: 0, conflicts: 0, waitingForData: 0, dataSourceDelay: 0, unjustifiedAbsences: 0, ...patch })
const person = (name: string, patch: Partial<TeamCalendarPerson> = {}): TeamCalendarPerson => ({ personId: name, name, teamId: "team-ret", teamName: "B2C · Retenção", subteamId: "sub-ret-a", subteamName: "Retenção A", jobTitle: "Operador de Atendimento", scheduleType: "FIVE_BY_TWO", scheduleTypeLabel: "5x2", days: [], summary: summary(), ...patch })

const PEOPLE = [
  person("Joana Esteves", { summary: summary({ missingProduction: 1 }) }),
  person("Caio Lima", { jobTitle: "Especialista de Atendimento — Contas", scheduleType: "SIX_BY_ONE", scheduleTypeLabel: "6x1", summary: summary({ unjustifiedAbsences: 1, conflicts: 1 }) }),
  person("Ângela Souza", { jobTitle: null, scheduleType: null, scheduleTypeLabel: null, summary: summary({ waitingForData: 2 }) }),
  person("Bruno Teixeira", { subteamId: "sub-ret-b", subteamName: "Retenção B", summary: summary({ divergences: 1, dataSourceDelay: 1 }) }),
  person("Zeca Prado", { teamId: "team-vendas", teamName: "B2C · Vendas", subteamId: null, subteamName: null }),
]
const names = (people: TeamCalendarPerson[]) => people.map((entry) => entry.name)

describe("Calendário da equipe — filtros da lista de colaboradores (mesmo padrão das listagens administrativas)", () => {
  it("sem filtro devolve todo mundo na ordem recebida", () => {
    expect(names(applyCalendarFilters(PEOPLE, {}))).toEqual(["Joana Esteves", "Caio Lima", "Ângela Souza", "Bruno Teixeira", "Zeca Prado"])
  })

  it("busca ignora acento e caixa e também casa o cargo", () => {
    expect(names(applyCalendarFilters(PEOPLE, { search: "angela" }))).toEqual(["Ângela Souza"])
    expect(names(applyCalendarFilters(PEOPLE, { search: "ESPECIALISTA" }))).toEqual(["Caio Lima"])
    expect(names(applyCalendarFilters(PEOPLE, { search: "ninguém" }))).toEqual([])
  })

  it("grupo e subgrupo por id (subgrupo restringe dentro do grupo)", () => {
    expect(names(applyCalendarFilters(PEOPLE, { teamId: "team-vendas" }))).toEqual(["Zeca Prado"])
    expect(names(applyCalendarFilters(PEOPLE, { teamId: "team-ret", subteamId: "sub-ret-b" }))).toEqual(["Bruno Teixeira"])
    expect(names(applyCalendarFilters(PEOPLE, { subteamId: "sub-ret-a" }))).toEqual(["Joana Esteves", "Caio Lima", "Ângela Souza"])
    expect(names(applyCalendarFilters(PEOPLE, { teamId: "team-vendas", subteamId: "sub-ret-a" }))).toEqual([])
  })

  it("cargo = job_title exato (multi); pessoa sem cargo nunca casa um cargo", () => {
    expect(names(applyCalendarFilters(PEOPLE, { jobTitles: ["Operador de Atendimento"] }))).toEqual(["Joana Esteves", "Bruno Teixeira", "Zeca Prado"])
    expect(names(applyCalendarFilters(PEOPLE, { jobTitles: ["Operador de Atendimento", "Especialista de Atendimento — Contas"] }))).toEqual(["Joana Esteves", "Caio Lima", "Bruno Teixeira", "Zeca Prado"])
  })

  it("regime: 5x2 / 6x1 / sem escala configurada (NONE)", () => {
    expect(names(applyCalendarFilters(PEOPLE, { scheduleTypes: ["SIX_BY_ONE"] }))).toEqual(["Caio Lima"])
    expect(names(applyCalendarFilters(PEOPLE, { scheduleTypes: [CALENDAR_SCHEDULE_NONE] }))).toEqual(["Ângela Souza"])
  })

  it("atenção: qualquer um dos marcados (OU) — pendência, aguardando dados, fonte atrasada, falta injustificada, divergência, inconsistência", () => {
    expect(names(applyCalendarFilters(PEOPLE, { attention: ["MISSING_PRODUCTION"] }))).toEqual(["Joana Esteves"])
    expect(names(applyCalendarFilters(PEOPLE, { attention: ["WAITING_FOR_DATA", "DATA_SOURCE_DELAY"] }))).toEqual(["Ângela Souza", "Bruno Teixeira"])
    expect(names(applyCalendarFilters(PEOPLE, { attention: ["UNJUSTIFIED_ABSENCE"] }))).toEqual(["Caio Lima"])
    expect(names(applyCalendarFilters(PEOPLE, { attention: ["CONFLICT"] }))).toEqual(["Caio Lima"])
    expect(names(applyCalendarFilters(PEOPLE, { attention: ["DIVERGENCE"] }))).toEqual(["Bruno Teixeira"])
  })

  it("escalados para hoje: elegibilidade de HOJE por pessoa (sem mapa = ninguém escalado); false = fora hoje", () => {
    const today = new Map([["Joana Esteves", true], ["Caio Lima", false], ["Ângela Souza", true]])
    expect(names(applyCalendarFilters(PEOPLE, { scheduledToday: true }, today))).toEqual(["Joana Esteves", "Ângela Souza"])
    expect(names(applyCalendarFilters(PEOPLE, { scheduledToday: false }, today))).toEqual(["Caio Lima", "Bruno Teixeira", "Zeca Prado"])
    expect(names(applyCalendarFilters(PEOPLE, { scheduledToday: true }))).toEqual([])
    expect(names(applyCalendarFilters(PEOPLE, { scheduledToday: undefined }, today))).toHaveLength(5)
  })

  it("filtros combinam com E entre eles", () => {
    expect(names(applyCalendarFilters(PEOPLE, { jobTitles: ["Operador de Atendimento"], attention: ["DIVERGENCE"] }))).toEqual(["Bruno Teixeira"])
    expect(names(applyCalendarFilters(PEOPLE, { search: "joana", scheduleTypes: ["SIX_BY_ONE"] }))).toEqual([])
  })
})
