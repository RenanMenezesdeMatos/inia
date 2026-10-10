import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { archiveArgumentScript, createArgumentScript, publishArgumentScript } from "../application/argument-script-service.js"
import { criterionItemsOf, inForceAt, isUnstructuredLegacy, normalizeArgumentScriptContent, publishIssuesOf, scopeAppliesTo } from "./argument-script.js"

describe("conteúdo do argumentário (estrutura preservada)", () => {
  it("chaves estáveis: item editado mantém a chave; item novo ganha uma; chave repetida nunca duplica", () => {
    const content = normalizeArgumentScriptContent({ operatorGuidance: [{ key: "g-1", text: "Indicar o canal.", modality: "MUST" }, { text: "Oferecer o app.", modality: "MAY" }, { key: "g-1", text: "Outro com a mesma chave.", modality: "MUST" }] })
    expect(content.operatorGuidance[0]!.key).toBe("g-1")
    expect(content.operatorGuidance[1]!.key).toMatch(/^[0-9a-f]{12}$/)
    expect(content.operatorGuidance[2]!.key).not.toBe("g-1")
  })

  it("critérios: 'deve' e 'pode' preservados; grupo de ALTERNATIVAS é uma exigência só; item condicional leva a condição; legado sem classificação nunca vira critério", () => {
    const items = criterionItemsOf(normalizeArgumentScriptContent({
      operatorGuidance: [{ key: "g-must", text: "Indicar o Vivo em Dia.", modality: "MUST" }, { key: "g-may", text: "Verificar parcelamento.", modality: "MAY" }, { key: "g-old", text: "Texto antigo.", modality: "UNSPECIFIED" }],
      requiredPoints: [{ key: "all", mode: "ALL", items: [{ key: "p1", text: "Mencionar a consulta de débitos.", condition: null }, { key: "p2", text: "Mencionar o reparo pelo app.", condition: "houver abertura de reparo" }] }, { key: "any", mode: "ANY", items: [{ key: "c", text: "Cartão pelo app", condition: null }, { key: "b", text: "Boleto", condition: null }] }],
      avoid: [{ key: "a1", text: "Não prometer desbloqueio imediato." }],
    }))
    expect(items.map((item) => [item.field, item.modality, item.groupMode, item.condition])).toEqual([
      ["GUIDANCE", "MUST", null, null],
      ["GUIDANCE", "MAY", null, null],
      ["REQUIRED_POINT", null, "ALL", null],
      ["REQUIRED_POINT", null, "ALL", "houver abertura de reparo"],
      ["REQUIRED_POINT", null, "ANY", null],
      ["AVOID", null, null, null],
    ])
    expect(items[4]!.alternatives).toEqual(["Cartão pelo app", "Boleto"])
    expect(isUnstructuredLegacy(normalizeArgumentScriptContent({ operatorGuidance: [{ key: "legacy-1", text: "Informar o protocolo.", modality: "UNSPECIFIED" }], legacyExpectation: "Informar o protocolo." }))).toBe(true)
  })

  it("publicar exige a condição/gatilho quando há algo a avaliar; alternativas precisam de duas opções; legado sem estrutura continua publicável", () => {
    const content = normalizeArgumentScriptContent({ requiredPoints: [{ mode: "ANY", items: [{ text: "Só uma opção", condition: null }] }] })
    expect(publishIssuesOf(content, { name: "Contas", businessDomainId: "d", conversion: "NATIVE" }).map((issue) => issue.code)).toEqual(["ARGUMENT_SCRIPT_TRIGGER_REQUIRED", "ARGUMENT_SCRIPT_ALTERNATIVES_NEED_TWO"])
    expect(publishIssuesOf(normalizeArgumentScriptContent({ operatorGuidance: [{ text: "Texto", modality: "UNSPECIFIED" }], legacyExpectation: "Texto" }), { name: "Antigo", businessDomainId: null, conversion: "LEGACY_UNSTRUCTURED" })).toEqual([])
  })
})

describe("escopo e vigência", () => {
  it("regras gerais (todos os grupos) e específicas (grupo/subgrupo) valem só para quem está no escopo", () => {
    const person = { teamId: "team-a", subteamId: "sub-a1" }
    expect(scopeAppliesTo({ scopeType: "ALL_TEAMS", teamId: null, subteamId: null }, person)).toBe(true)
    expect(scopeAppliesTo({ scopeType: "TEAM", teamId: "team-a", subteamId: null }, person)).toBe(true)
    expect(scopeAppliesTo({ scopeType: "TEAM", teamId: "team-b", subteamId: null }, person)).toBe(false)
    expect(scopeAppliesTo({ scopeType: "SUBTEAM", teamId: "team-a", subteamId: "sub-a1" }, person)).toBe(true)
    expect(scopeAppliesTo({ scopeType: "SUBTEAM", teamId: "team-a", subteamId: "sub-a2" }, person)).toBe(false)
  })

  it("vigência: início ≤ data da chamada < fim — regra publicada depois da chamada nunca vale para ela; encerrada depois continua valendo para ela", () => {
    const version = { effectiveFrom: new Date("2026-09-10T12:00:00Z"), effectiveUntil: new Date("2026-09-20T12:00:00Z") }
    expect(inForceAt(version, new Date("2026-09-09T12:00:00Z"))).toBe(false)
    expect(inForceAt(version, new Date("2026-09-10T12:00:00Z"))).toBe(true)
    expect(inForceAt(version, new Date("2026-09-20T11:59:59Z"))).toBe(true)
    expect(inForceAt(version, new Date("2026-09-20T12:00:00Z"))).toBe(false)
    expect(inForceAt({ effectiveFrom: null, effectiveUntil: null }, new Date())).toBe(false)
  })
})

/** Banco falso mínimo: o escopo é decidido ANTES de qualquer escrita (a restrição é do backend, inclusive para "todos"). */
function fakeDb(rows: Record<string, unknown[]> = {}) {
  const queries: string[] = []
  const db = { query: async (sql: string) => {
    queries.push(sql)
    const match = Object.entries(rows).find(([fragment]) => sql.includes(fragment))
    return { rows: match ? match[1] : [], rowCount: match ? match[1].length : 0 }
  } } as unknown as Database
  return { db, queries }
}
const groupAdmin: ManageableScopes = { unrestricted: false, allTeams: false, teamIds: new Set(["team-a"]), subteamIds: new Set(["sub-a1"]) }
const actor = { organizationId: "org", personId: "admin" }

describe("administração por área (escopo de quem administra)", () => {
  it("administrador de grupo NÃO cria argumentário para 'todos os grupos' — recusa no backend, antes de gravar", async () => {
    const { db, queries } = fakeDb()
    await expect(createArgumentScript(db, actor, groupAdmin, { name: "Contas em atraso", businessDomainId: "00000000-0000-4000-8000-000000000001", scope: { scopeType: "ALL_TEAMS" } })).rejects.toMatchObject({ code: "ARGUMENT_SCRIPT_SCOPE_FORBIDDEN", statusCode: 403 })
    expect(queries.some((sql) => sql.includes("insert"))).toBe(false)
  })

  it("nem para outro grupo; para o próprio grupo, passa da checagem de escopo", async () => {
    const other = fakeDb({ "from teams": [{}] })
    await expect(createArgumentScript(other.db, actor, groupAdmin, { name: "Contas", businessDomainId: "00000000-0000-4000-8000-000000000001", scope: { scopeType: "TEAM", teamId: "00000000-0000-4000-8000-0000000000b2" } })).rejects.toMatchObject({ code: "ARGUMENT_SCRIPT_SCOPE_FORBIDDEN" })
    const own = fakeDb({ "from teams": [{}] })
    const ownAdmin: ManageableScopes = { ...groupAdmin, teamIds: new Set(["00000000-0000-4000-8000-0000000000a1"]) }
    // Passou do escopo: a próxima checagem é a área responsável (domínio inexistente no banco falso).
    await expect(createArgumentScript(own.db, actor, ownAdmin, { name: "Contas", businessDomainId: "00000000-0000-4000-8000-000000000001", scope: { scopeType: "TEAM", teamId: "00000000-0000-4000-8000-0000000000a1" } })).rejects.toMatchObject({ code: "BUSINESS_DOMAIN_NOT_FOUND" })
  })

  it("publicar/encerrar um argumentário de outro escopo: mesmo visível (vem de cima), é somente leitura", async () => {
    const row = { id: "s1", name: "Geral", businessDomainId: null, businessDomainName: null, scopeType: "ALL_TEAMS", teamId: null, teamName: null, subteamId: null, subteamName: null, subjectName: null, status: "ACTIVE", conversion: "NATIVE", currentVersion: 1, currentEffectiveFrom: null, currentEffectiveUntil: null, draftVersion: 2, updatedAt: new Date(), createdAt: new Date() }
    const { db } = fakeDb({ "from argument_scripts s": [row] })
    await expect(publishArgumentScript(db, actor, groupAdmin, "s1", {})).rejects.toMatchObject({ code: "ARGUMENT_SCRIPT_SCOPE_FORBIDDEN", statusCode: 403 })
    await expect(archiveArgumentScript(db, actor, groupAdmin, "s1")).rejects.toMatchObject({ code: "ARGUMENT_SCRIPT_SCOPE_FORBIDDEN" })
  })

  it("publicação nunca é retroativa (regra publicada agora não vale para chamadas anteriores)", async () => {
    const row = { id: "s2", name: "Do grupo", businessDomainId: "d", businessDomainName: "Cobrança", scopeType: "TEAM", teamId: "team-a", teamName: "A", subteamId: null, subteamName: null, subjectName: null, status: "ACTIVE", conversion: "NATIVE", currentVersion: null, currentEffectiveFrom: null, currentEffectiveUntil: null, draftVersion: 1, updatedAt: new Date(), createdAt: new Date() }
    const { db } = fakeDb({ "from argument_scripts s": [row] })
    const now = new Date("2026-10-01T12:00:00Z")
    await expect(publishArgumentScript(db, actor, groupAdmin, "s2", { effectiveFrom: "2026-09-01T00:00:00Z" }, now)).rejects.toMatchObject({ code: "ARGUMENT_SCRIPT_RETROACTIVE" })
  })
})
