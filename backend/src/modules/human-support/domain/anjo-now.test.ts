import { describe, expect, it } from "vitest"
import { operationalStatusOf } from "./anjo-now.js"

const at = (hhmm: string) => new Date(`2026-11-10T${hhmm}:00.000Z`)
const available = { status: "AVAILABLE" as const, pauseReason: null, statusSince: at("08:00") }

describe("operationalStatusOf", () => {
  it("indisponível (ou sem registro de presença): sem tempo, nunca um contador", () => {
    expect(operationalStatusOf(null, [])).toEqual({ status: "UNAVAILABLE", pauseReason: null, since: null })
    expect(operationalStatusOf({ status: "OFFLINE", pauseReason: null, statusSince: at("09:00") }, [])).toEqual({ status: "UNAVAILABLE", pauseReason: null, since: null })
  })

  it("em pausa: o motivo e a última troca de estado ou de motivo, mesmo com atendimento aberto", () => {
    expect(operationalStatusOf({ status: "PAUSED", pauseReason: "LUNCH", statusSince: at("12:00") }, [{ startedAt: at("11:50"), endedAt: null }])).toEqual({ status: "PAUSED", pauseReason: "LUNCH", since: at("12:00") })
  })

  it("disponível e livre: desde o fim do último atendimento (ou desde que ficou disponível)", () => {
    expect(operationalStatusOf(available, [])).toEqual({ status: "AVAILABLE", pauseReason: null, since: at("08:00") })
    expect(operationalStatusOf(available, [{ startedAt: at("09:00"), endedAt: at("09:20") }, { startedAt: at("10:00"), endedAt: at("10:05") }]).since).toEqual(at("10:05"))
    // Atendimento que terminou ANTES de ficar disponível não conta.
    expect(operationalStatusOf({ ...available, statusSince: at("11:00") }, [{ startedAt: at("09:00"), endedAt: at("10:30") }]).since).toEqual(at("11:00"))
  })

  it("em atendimento: o início da sequência sem intervalo livre, com sobreposição", () => {
    // A 10:00–10:30 e B 10:20–(aberto): ocupado desde 10:00, sem instante livre.
    expect(operationalStatusOf(available, [{ startedAt: at("10:00"), endedAt: at("10:30") }, { startedAt: at("10:20"), endedAt: null }])).toEqual({ status: "IN_ATTENDANCE", pauseReason: null, since: at("10:00") })
    // Houve intervalo livre (10:30–10:40): a sequência atual começa em 10:40.
    expect(operationalStatusOf(available, [{ startedAt: at("10:00"), endedAt: at("10:30") }, { startedAt: at("10:40"), endedAt: null }]).since).toEqual(at("10:40"))
    // Nunca antes de ficar disponível (voltou da pausa com o atendimento aberto às 12:30).
    expect(operationalStatusOf({ ...available, statusSince: at("12:30") }, [{ startedAt: at("11:50"), endedAt: null }]).since).toEqual(at("12:30"))
  })
})
