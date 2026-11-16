import { describe, expect, it } from "vitest"
import { demandOf, type DemandRecord } from "./demand.js"

const record = (patch: Partial<DemandRecord>): DemandRecord => ({
  status: "CLOSED", endCause: "ANJO_CLOSED", hadAttendance: true, anjosInServiceAtEnd: null,
  operatorPersonId: "o1", teamId: "g1", teamName: "Grupo 1", subteamId: "s1", subteamName: "Sub 1",
  hour: 9, day: "2026-11-10", waitSeconds: 30, productivity: "PRODUCTIVE", ...patch,
})
const name = (id: string) => ({ o1: "Ana", o2: "Bruno" })[id] ?? "?"

describe("acionamentos do período", () => {
  it("curva por hora, espera (média, p50, p90 e por dia), quem mais aciona e divisão produtivos × não produtivos", () => {
    const all = [
      record({}),
      record({ hour: 9, waitSeconds: 90 }),
      record({ hour: 14, operatorPersonId: "o2", subteamId: "s2", subteamName: "Sub 2", productivity: "NOT_PRODUCTIVE", day: "2026-11-11", waitSeconds: 60 }),
      record({ hour: 14, status: "EXPIRED", endCause: "QUEUE_EXPIRED", hadAttendance: false, anjosInServiceAtEnd: 0, waitSeconds: null, productivity: "NOT_EVALUATED" }),
    ]
    const demand = demandOf(all, ["2026-11-10", "2026-11-11"], null, name)
    expect(demand.total).toBe(4)
    expect(demand.byHour[9]).toBe(2)
    expect(demand.byHour[14]).toBe(2)
    expect(demand.wait).toMatchObject({ averageSeconds: 60, p50Seconds: 60, p90Seconds: 90, count: 3 })
    expect(demand.wait.byDay).toEqual([{ day: "2026-11-10", averageSeconds: 60, count: 2 }, { day: "2026-11-11", averageSeconds: 60, count: 1 }])
    expect(demand.top.operators[0]).toEqual({ key: "o1", label: "Ana", count: 3, share: 0.75 })
    expect(demand.top.subgroups.map((item) => item.label)).toEqual(["Sub 1", "Sub 2"])
    expect(demand.productivity).toEqual({ PRODUCTIVE: 2, NOT_PRODUCTIVE: 1, NOT_EVALUATED: 1 })
    expect(demand.operation.noAnjoLogged.count).toBe(1)
  })

  it("filtrar por uma parte muda o resto da visão, mas a divisão continua do período inteiro; dia sem espera = nulo, nunca zero", () => {
    const demand = demandOf([record({}), record({ productivity: "NOT_PRODUCTIVE", operatorPersonId: "o2", hour: 20 })], ["2026-11-10", "2026-11-11"], "NOT_PRODUCTIVE", name)
    expect(demand.total).toBe(1)
    expect(demand.byHour[20]).toBe(1)
    expect(demand.byHour[9]).toBe(0)
    expect(demand.top.operators.map((item) => item.label)).toEqual(["Bruno"])
    expect(demand.productivity).toEqual({ PRODUCTIVE: 1, NOT_PRODUCTIVE: 1, NOT_EVALUATED: 0 })
    expect(demand.wait.byDay[1]).toEqual({ day: "2026-11-11", averageSeconds: null, count: 0 })
  })
})
