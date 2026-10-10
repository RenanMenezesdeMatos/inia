import { describe, expect, it } from "vitest"
import { strategyActiveAt, versionInForceAt } from "./strategy-at-birth.js"

/**
 * `STRATEGY_AT_BIRTH_V1` — a versão da estratégia em vigor no instante em que a execução nasceu (regra pura). Origem: dev 05/10/2026,
 * Workflow "Feedback de indicador" (Manual · Colaborador → diagnóstico do fechamento): a matrícula não tinha pino e o diagnóstico rodou
 * sem a estratégia do TMA, publicada e ativa.
 */
const at = (date: string) => new Date(`${date}T12:00:00Z`)
const versions = [
  { id: "v1", version: 1, publishedAt: at("2026-08-01") },
  { id: "v2", version: 2, publishedAt: at("2026-09-01") },
  { id: "v3", version: 3, publishedAt: null },
]

describe("versionInForceAt — a de publicação mais recente até o instante", () => {
  it("antes de qualquer publicação = nenhuma; entre publicações = a anterior; depois = a mais nova; rascunho nunca", () => {
    expect(versionInForceAt(versions, at("2026-07-31"))).toBeNull()
    expect(versionInForceAt(versions, at("2026-08-20"))?.id).toBe("v1")
    expect(versionInForceAt(versions, at("2026-09-01"))?.id).toBe("v2")
    expect(versionInForceAt(versions, at("2026-10-05"))?.id).toBe("v2")
    expect(versionInForceAt([versions[2]!], at("2026-10-05"))).toBeNull()
  })

  it("a ordem da lista não importa; mesmo instante de publicação = o número maior", () => {
    expect(versionInForceAt([...versions].reverse(), at("2026-08-20"))?.id).toBe("v1")
    expect(versionInForceAt([{ id: "a", version: 1, publishedAt: at("2026-08-01") }, { id: "b", version: 2, publishedAt: at("2026-08-01") }], at("2026-08-01"))?.id).toBe("b")
  })
})

describe("strategyActiveAt — o estado do último evento até o instante", () => {
  const deactivated = { active: false, at: at("2026-09-10") }
  const reactivated = { active: true, at: at("2026-09-20") }

  it("evento até o instante decide; o que veio depois não muda o passado", () => {
    expect(strategyActiveAt({ currentActive: true, events: [deactivated, reactivated], at: at("2026-09-15") })).toBe(false)
    expect(strategyActiveAt({ currentActive: true, events: [reactivated, deactivated], at: at("2026-09-25") })).toBe(true)
    expect(strategyActiveAt({ currentActive: false, events: [deactivated], at: at("2026-09-05") })).toBe(true)
  })

  it("ativar uma já ativa é evento como qualquer outro (nunca 'o contrário do próximo evento')", () => {
    expect(strategyActiveAt({ currentActive: true, events: [{ active: true, at: at("2026-09-10") }], at: at("2026-09-05") })).toBe(true)
  })

  it("sem evento: o estado atual — inativa sem evento (mudança fora da aplicação, sem data) fica sem estratégia", () => {
    expect(strategyActiveAt({ currentActive: true, events: [], at: at("2026-09-05") })).toBe(true)
    expect(strategyActiveAt({ currentActive: false, events: [], at: at("2026-09-05") })).toBe(false)
  })
})
