import { describe, expect, it } from "vitest"
import { reviewSchema } from "./pattern-service.js"
import { leveledPracticesFor, phrasingFor } from "./recommendations.js"

/**
 * `BEST_PRACTICE_SELECTION_V1` — escolha pelo recuo, sem banco: o primeiro nível com prática disponível vence em cada assunto,
 * os níveis não se misturam e nada aparece sem prática sustentada (o banco falso devolve as linhas de `loadPracticeRows`).
 */
type Row = { id: string; name: string; team_id: string; subteam_id: string | null; review_status?: string; current_strength?: string; supported_contexts: unknown[]; analysis_id?: string | null; definition_hash?: string | null; how_it_helps?: string | null }
/** `products`: por análise do padrão, as chamadas PRESENTES e os produtos estabelecidos em cada uma (o que a consulta de produto devolve). */
function fakeDb(rows: Row[], products: Record<string, { call_ref: string; names: string[] | null }[]> = {}) {
  return {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("from best_practice_call_codings c") && sql.includes("product_identification")) return { rows: products[String(params[1])] ?? [] }
      if (sql.includes("from best_practice_patterns")) {
        return { rows: rows.map((row) => ({ description: "d", guidance: "g", suggested_phrasing: null, not_applicable_when: null, indicator_definition_id: "ind", indicator_name: "TMA", obligation_status: "OPTIONAL", obligation_confirmed_by_review: false, data_origin: "REAL", analysis_id: null, definition_hash: null, period_start: "2026-09-01", period_end: "2026-09-30", additional_behavior: null, review_status: "APPROVED", current_strength: "MODERATE", ...row })) }
      }
      return { rows: [] }
    },
  } as never
}
const supported = (reason: string, subReason: string | null, level: "REASON" | "SUB_REASON") => ({ cellKey: level === "REASON" ? reason : `${reason} › ${subReason}`, reason, subReason, level, label: subReason ? `${reason} › ${subReason}` : reason, strength: "MODERATE", topRatePercent: 80, referenceRatePercent: 30, topOperators: 4, referenceOperators: 6, topCalls: 12, referenceCalls: 18 })
const placement = { teamId: "g1", teamName: "Atendimento", subteamId: "s1", subteamName: "Célula A" }
const segundaVia = { reason: "Faturamento", subReason: "Segunda via" }
const select = (rows: Row[], subjects = [segundaVia], who = null) => leveledPracticesFor(fakeDb(rows), { organizationId: "org", indicatorId: "ind", placement, subjects, who, limit: 2 })

describe("BEST_PRACTICE_SELECTION_V1 — recuo na escolha das práticas", () => {
  it("subgrupo + submotivo vence; o grupo e o motivo não se misturam no mesmo assunto", async () => {
    const result = await select([
      { id: "grupo-sub", name: "Do grupo", team_id: "g1", subteam_id: null, supported_contexts: [supported("Faturamento", "Segunda via", "SUB_REASON")] },
      { id: "subgrupo-sub", name: "Do subgrupo", team_id: "g1", subteam_id: "s1", supported_contexts: [supported("Faturamento", "Segunda via", "SUB_REASON")] },
      { id: "grupo-motivo", name: "Do motivo", team_id: "g1", subteam_id: null, supported_contexts: [supported("Faturamento", null, "REASON")] },
    ])
    expect(result.map((entry) => entry.row.id)).toEqual(["subgrupo-sub"])
    expect(result[0]!.from).toMatchObject({ population: "SUBGROUP", context: "SUB_REASON", text: "Dos operadores com melhor TMA do seu subgrupo (Célula A), em chamadas de Segunda via." })
  })

  it("sem prática no subgrupo, o grupo no mesmo submotivo; sem submotivo, o motivo (subgrupo antes do grupo)", async () => {
    expect((await select([{ id: "grupo-sub", name: "Do grupo", team_id: "g1", subteam_id: null, supported_contexts: [supported("Faturamento", "Segunda via", "SUB_REASON")] }, { id: "subgrupo-motivo", name: "Motivo do subgrupo", team_id: "g1", subteam_id: "s1", supported_contexts: [supported("Faturamento", null, "REASON")] }]))[0]!.from.population).toBe("GROUP")
    const byReason = await select([{ id: "grupo-motivo", name: "Motivo do grupo", team_id: "g1", subteam_id: null, supported_contexts: [supported("Faturamento", null, "REASON")] }, { id: "subgrupo-motivo", name: "Motivo do subgrupo", team_id: "g1", subteam_id: "s1", supported_contexts: [supported("Faturamento", null, "REASON")] }])
    expect(byReason.map((entry) => entry.row.id)).toEqual(["subgrupo-motivo"])
    expect(byReason[0]!.from.text).toBe("Dos operadores com melhor TMA do seu subgrupo (Célula A), em chamadas de Faturamento.")
  })

  it("nada sustentado → nada: padrão não aprovado, fraco, de outro submotivo, de outro subgrupo ou de outro grupo não entra", async () => {
    expect(await select([
      { id: "pendente", name: "Pendente", team_id: "g1", subteam_id: null, review_status: "PENDING_REVIEW", supported_contexts: [supported("Faturamento", "Segunda via", "SUB_REASON")] },
      { id: "fraco", name: "Fraco", team_id: "g1", subteam_id: null, current_strength: "WEAK", supported_contexts: [supported("Faturamento", "Segunda via", "SUB_REASON")] },
      { id: "outro-sub", name: "Outro submotivo", team_id: "g1", subteam_id: null, supported_contexts: [supported("Faturamento", "Contestação", "SUB_REASON")] },
      { id: "outro-subgrupo", name: "Outro subgrupo", team_id: "g1", subteam_id: "s2", supported_contexts: [supported("Faturamento", "Segunda via", "SUB_REASON")] },
    ])).toEqual([])
  })

  it("vários assuntos: cada um com o próprio nível, na ordem da prioridade, até o limite", async () => {
    const rows: Row[] = [
      { id: "reparo-grupo", name: "Reparo", team_id: "g1", subteam_id: null, supported_contexts: [supported("Reparo", "Sem sinal", "SUB_REASON")] },
      { id: "fatura-subgrupo", name: "Fatura", team_id: "g1", subteam_id: "s1", supported_contexts: [supported("Faturamento", "Segunda via", "SUB_REASON")] },
    ]
    const result = await select(rows, [{ reason: "Reparo", subReason: "Sem sinal" }, segundaVia])
    expect(result.map((entry) => [entry.row.id, entry.from.population])).toEqual([["reparo-grupo", "GROUP"], ["fatura-subgrupo", "SUBGROUP"]])
  })
})

describe("BEST_PRACTICE_GUIDANCE_V3 — força do contexto e fala do assunto certo", () => {
  it("a força mostrada é a do contexto que casou, não a do padrão inteiro", async () => {
    const [entry] = await select([{ id: "p", name: "Prática", team_id: "g1", subteam_id: null, current_strength: "STRONG", supported_contexts: [{ ...supported("Faturamento", "Segunda via", "SUB_REASON"), strength: "MODERATE" }] }])
    expect(entry!.item.strength).toBe("Moderada")
  })

  it("a fala sugerida só aparece no assunto de onde saiu; editada na revisão vale para qualquer um; origem desconhecida só com um assunto", () => {
    const reparo = { cellKey: "Reparo › (sem submotivo)" }
    const segundaVia = { cellKey: "Segunda via › (sem submotivo)" }
    const row = { suggestedPhrasing: "Ficou claro?", phrasingScope: "LISTED" as const, phrasingContexts: [segundaVia.cellKey], supportedContexts: [reparo, segundaVia] as never }
    expect(phrasingFor(row, [segundaVia])).toBe("Ficou claro?")
    expect(phrasingFor(row, [reparo])).toBeNull()
    expect(phrasingFor({ ...row, phrasingScope: "ANY" }, [reparo])).toBe("Ficou claro?")
    expect(phrasingFor({ ...row, phrasingScope: "UNKNOWN", phrasingContexts: [] }, [reparo])).toBeNull()
    expect(phrasingFor({ ...row, phrasingScope: "UNKNOWN", phrasingContexts: [], supportedContexts: [reparo] as never }, [reparo])).toBe("Ficou claro?")
  })
})

describe("BEST_PRACTICE_SELECTION_V2 — prática por produto no feedback", () => {
  const reparo = { reason: "Reparo", subReason: null }
  const pattern = (id: string, analysis: string): Row => ({ id, name: id, team_id: "g1", subteam_id: null, analysis_id: analysis, definition_hash: "h", supported_contexts: [supported("Reparo", null, "REASON")] })
  const calls = (product: string | null, total: number) => Array.from({ length: total }, (_, index) => ({ call_ref: `${product ?? "sem"}-${index}`, names: product ? [product] : null }))
  const evidence = { "a-bl": calls("Banda Larga", 4), "a-mix": [...calls("Banda Larga", 2), ...calls("IP Dedicado", 2)], "a-pouco": [...calls("Banda Larga", 1), ...calls(null, 5)] }
  const rows = [pattern("so-banda-larga", "a-bl"), pattern("varios-produtos", "a-mix"), pattern("pouco-produto", "a-pouco")]
  const pick = (products?: string[]) => leveledPracticesFor(fakeDb(rows, evidence), { organizationId: "org", indicatorId: "ind", placement, subjects: [reparo], who: null, limit: 3, ...(products ? { products } : {}) })

  it("vista só em Banda Larga: entra no feedback de Banda Larga e fica fora do de IP Dedicado e do sem produto estabelecido", async () => {
    expect((await pick(["Banda Larga"])).map((entry) => [entry.row.id, entry.product])).toEqual([["so-banda-larga", "Banda Larga"], ["varios-produtos", null], ["pouco-produto", null]])
    expect((await pick(["IP Dedicado"])).map((entry) => entry.row.id)).toEqual(["varios-produtos", "pouco-produto"])
    expect((await pick([])).map((entry) => entry.row.id)).toEqual(["varios-produtos", "pouco-produto"])
  })

  it("vista em mais de um produto, ou sem produto estabelecido na maior parte das chamadas, é geral; sem `products` (chat, voz), nada muda", async () => {
    const all = await pick()
    expect(all.map((entry) => entry.row.id)).toEqual(["so-banda-larga", "varios-produtos", "pouco-produto"])
    expect(all.every((entry) => !("product" in entry))).toBe(true)
  })
})

describe("BEST_PRACTICE_HOW_IT_HELPS_V1 — o campo na revisão", () => {
  it("quem revisa pode escrever, corrigir ou apagar o 'como ajuda no resultado'; texto curto demais é recusado", () => {
    expect(reviewSchema.parse({ action: "EDIT", changes: { howItHelps: "O cliente não precisa anotar o protocolo na linha." } }).changes?.howItHelps).toBe("O cliente não precisa anotar o protocolo na linha.")
    expect(reviewSchema.parse({ action: "EDIT", changes: { howItHelps: "" } }).changes?.howItHelps).toBe("")
    expect(reviewSchema.parse({ action: "EDIT", changes: { howItHelps: null } }).changes?.howItHelps).toBeNull()
    expect(() => reviewSchema.parse({ action: "EDIT", changes: { howItHelps: "ok" } })).toThrow()
    expect(() => reviewSchema.parse({ action: "EDIT", changes: { howItHelps: "x".repeat(1001) } })).toThrow()
  })

  it("o texto vigente do padrão chega à prática escolhida para o feedback", async () => {
    const [entry] = await select([{ id: "p", name: "Prática", team_id: "g1", subteam_id: null, how_it_helps: "O cliente não precisa anotar o protocolo na linha.", supported_contexts: [supported("Faturamento", "Segunda via", "SUB_REASON")] } as Row])
    expect(entry!.item.howItHelps).toBe("O cliente não precisa anotar o protocolo na linha.")
  })
})
